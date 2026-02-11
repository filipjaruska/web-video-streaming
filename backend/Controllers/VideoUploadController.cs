using Microsoft.AspNetCore.Mvc;

namespace WebWVideoStreamingAPI.Controllers;

/// <summary>
/// Video Upload Controller
/// Handles uploading video files to the server storage
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class VideoUploadController : ControllerBase {
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<VideoUploadController> _logger;
    private const long MaxFileSize = 500 * 1024 * 1024; // 500 MB
    private static readonly string[] AllowedExtensions = { ".mp4", ".mov", ".avi", ".mkv", ".webm" };

    public VideoUploadController(IWebHostEnvironment environment, ILogger<VideoUploadController> logger) {
        _environment = environment;
        _logger = logger;
    }

    /// <summary>
    /// Upload a video file
    /// </summary>
    /// <param name="file">Video file to upload</param>
    /// <param name="videoId">Optional custom video ID. If not provided, a unique ID will be generated.</param>
    /// <returns>Upload result with video ID</returns>
    [HttpPost]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
    [RequestSizeLimit(MaxFileSize)]
    public async Task<IActionResult> UploadVideo(IFormFile file, [FromForm] string? videoId = null) {
        try {
            if (file == null || file.Length == 0) {
                return BadRequest(new { message = "No file uploaded" });
            }

            if (file.Length > MaxFileSize) {
                return StatusCode(StatusCodes.Status413PayloadTooLarge, 
                    new { message = $"File size exceeds maximum limit of {MaxFileSize / (1024 * 1024)} MB" });
            }

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!AllowedExtensions.Contains(extension)) {
                return BadRequest(new { 
                    message = "Invalid file type", 
                    allowedTypes = AllowedExtensions 
                });
            }

            // Generate video ID if not provided
            if (string.IsNullOrWhiteSpace(videoId)) {
                videoId = Path.GetFileNameWithoutExtension(file.FileName);
                // Sanitize the filename
                videoId = string.Join("_", videoId.Split(Path.GetInvalidFileNameChars()));
                // Add timestamp to make it unique
                videoId = $"{videoId}_{DateTime.UtcNow:yyyyMMddHHmmss}";
            } else {
                // Sanitize the provided video ID
                videoId = string.Join("_", videoId.Split(Path.GetInvalidFileNameChars()));
            }

            var uploadDir = Path.Combine(_environment.WebRootPath, "httprange", videoId);
            
            // Check if directory already exists
            if (Directory.Exists(uploadDir)) {
                return BadRequest(new { 
                    message = "A video with this ID already exists", 
                    videoId 
                });
            }
            
            Directory.CreateDirectory(uploadDir);
            var filePath = Path.Combine(uploadDir, $"{videoId}.mp4");

            using (var stream = new FileStream(filePath, FileMode.Create)) {
                await file.CopyToAsync(stream);
            }

            _logger.LogInformation("Video uploaded successfully: {VideoId}, Size: {Size} bytes", videoId, file.Length);

            return Ok(new {
                message = "Video uploaded successfully",
                videoId = videoId,
                fileName = $"{videoId}.mp4",
                size = file.Length,
                uploadedAt = DateTime.UtcNow
            });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to upload video");
            return StatusCode(500, new { message = "Failed to upload video", error = ex.Message });
        }
    }

    /// <summary>
    /// List all uploaded videos
    /// </summary>
    [HttpGet("list")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public IActionResult ListVideos() {
        try {
            var uploadDir = Path.Combine(_environment.WebRootPath, "httprange");
            Directory.CreateDirectory(uploadDir);

            var videos = Directory.GetDirectories(uploadDir)
                .Select(dir => {
                    var videoId = Path.GetFileName(dir);
                    var videoPath = Path.Combine(dir, $"{videoId}.mp4");
                    if (!System.IO.File.Exists(videoPath)) return null;
                    
                    var fileInfo = new FileInfo(videoPath);
                    
                    return new {
                        videoId = videoId,
                        fileName = fileInfo.Name,
                        size = fileInfo.Length,
                        createdAt = fileInfo.CreationTimeUtc,
                        hasHls = Directory.Exists(Path.Combine(_environment.WebRootPath, "hls", videoId)) &&
                                 System.IO.File.Exists(Path.Combine(_environment.WebRootPath, "hls", videoId, "master.m3u8")),
                        hasDash = Directory.Exists(Path.Combine(_environment.WebRootPath, "dash", videoId)) &&
                                  System.IO.File.Exists(Path.Combine(_environment.WebRootPath, "dash", videoId, "manifest.mpd"))
                    };
                })
                .Where(v => v != null)
                .OrderByDescending(v => v.createdAt)
                .ToList();

            return Ok(new {
                count = videos.Count,
                videos = videos
            });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to list videos");
            return StatusCode(500, new { message = "Failed to list videos" });
        }
    }

    /// <summary>
    /// Delete a video and its transcoded versions
    /// </summary>
    [HttpDelete("{videoId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult DeleteVideo(string videoId) {
        try {
            var videoDir = Path.Combine(_environment.WebRootPath, "httprange", videoId);
            
            if (!Directory.Exists(videoDir)) {
                return NotFound(new { message = "Video not found" });
            }

            // Delete source video directory
            Directory.Delete(videoDir, true);

            // Delete HLS directory if exists
            var hlsDir = Path.Combine(_environment.WebRootPath, "hls", videoId);
            if (Directory.Exists(hlsDir)) {
                Directory.Delete(hlsDir, true);
            }

            // Delete DASH directory if exists
            var dashDir = Path.Combine(_environment.WebRootPath, "dash", videoId);
            if (Directory.Exists(dashDir)) {
                Directory.Delete(dashDir, true);
            }

            _logger.LogInformation("Video deleted: {VideoId}", videoId);

            return Ok(new { 
                message = "Video and transcoded versions deleted successfully", 
                videoId 
            });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to delete video: {VideoId}", videoId);
            return StatusCode(500, new { message = "Failed to delete video" });
        }
    }
}
