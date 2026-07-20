using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Services;

namespace WebWVideoStreamingAPI.Api.VideoUpload;

[ApiController]
[Route("api/videoUpload")]
public class VideoUploadController : ControllerBase {
    private const long MaxFileSize = 500 * 1024 * 1024;

    private readonly IVideoStorageService _videoStorageService;
    private readonly ILogger<VideoUploadController> _logger;

    public VideoUploadController(IVideoStorageService videoStorageService, ILogger<VideoUploadController> logger) {
        _videoStorageService = videoStorageService;
        _logger = logger;
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
    [RequestSizeLimit(MaxFileSize)]
    public async Task<IActionResult> UploadVideo(IFormFile file, [FromForm] string? videoId = null, CancellationToken cancellationToken = default) {
        try {
            if (file == null) {
                return BadRequest(new { message = "No file uploaded" });
            }

            await using var stream = file.OpenReadStream();
            var result = await _videoStorageService.UploadAsync(stream, file.FileName, file.Length, videoId, cancellationToken);

            if (!result.Success) {
                return result.ErrorCode switch {
                    "TooLarge" => StatusCode(StatusCodes.Status413PayloadTooLarge, new { message = result.Message }),
                    "InvalidType" => BadRequest(new { message = result.Message, allowedTypes = result.AllowedExtensions }),
                    "DuplicateId" => BadRequest(new { message = result.Message, videoId = result.VideoId }),
                    _ => BadRequest(new { message = result.Message })
                };
            }

            return Ok(new {
                message = "Video uploaded successfully",
                videoId = result.VideoId,
                fileName = result.FileName,
                size = result.Size,
                uploadedAt = result.UploadedAtUtc
            });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to upload video");
            return StatusCode(500, new { message = "Failed to upload video", error = ex.Message });
        }
    }

    [HttpGet("list")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> ListVideos(CancellationToken cancellationToken) {
        try {
            var videos = await _videoStorageService.ListAsync(cancellationToken);

            return Ok(new {
                count = videos.Count,
                videos = videos.Select(video => new {
                    videoId = video.VideoId,
                    fileName = video.FileName,
                    size = video.Size,
                    createdAt = video.CreatedAtUtc,
                    hasHls = video.HasHls,
                    hasDash = video.HasDash
                })
            });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to list videos");
            return StatusCode(500, new { message = "Failed to list videos" });
        }
    }

    [HttpDelete("{videoId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteVideo(string videoId, CancellationToken cancellationToken) {
        try {
            var deleted = await _videoStorageService.DeleteAsync(videoId, cancellationToken);
            if (!deleted) {
                return NotFound(new { message = "Video not found" });
            }

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
