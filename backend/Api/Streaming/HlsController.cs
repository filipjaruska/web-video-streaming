using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Services;

namespace WebWVideoStreamingAPI.Api.Streaming;

[ApiController]
[Route("api/hls")]
public class HlsController : ControllerBase {
    private readonly IVideoStorageService _videoStorageService;
    private readonly IVideoTranscodingService _transcodingService;
    private readonly ILogger<HlsController> _logger;

    public HlsController(
        IVideoStorageService videoStorageService,
        IVideoTranscodingService transcodingService,
        ILogger<HlsController> logger) {
        _videoStorageService = videoStorageService;
        _transcodingService = transcodingService;
        _logger = logger;
    }

    [HttpPost("generate/{videoId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GenerateHls(string videoId, CancellationToken cancellationToken) {
        try {
            var inputPath = _videoStorageService.ResolveSourcePath(videoId);
            if (inputPath == null) {
                return NotFound(new { message = "Source video not found" });
            }

            if (_videoStorageService.HasHlsGenerated(videoId)) {
                return Ok(new { message = "HLS already generated", manifestUrl = $"/api/hls/{videoId}/master.m3u8" });
            }

            var hlsOutputDir = _videoStorageService.GetHlsOutputDir(videoId);
            _videoStorageService.EnsureHlsOutputDir(videoId);

            var result = await _transcodingService.GenerateHlsAsync(inputPath, hlsOutputDir, cancellationToken: cancellationToken);

            if (!result.Success) {
                return StatusCode(500, new { error = "HLS generation failed", details = result.ErrorMessage });
            }

            return Ok(new {
                message = "HLS generation completed",
                manifestUrl = $"/api/hls/{videoId}/master.m3u8",
                filesGenerated = result.GeneratedFiles.Count
            });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to generate HLS for video: {VideoId}", videoId);
            return StatusCode(500, new { error = "Failed to generate HLS streams" });
        }
    }

    [HttpGet("{videoId}/master.m3u8")]
    public IActionResult GetMasterPlaylist(string videoId) {
        var filePath = _videoStorageService.GetHlsManifestPath(videoId);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{videoId}/{quality}.m3u8")]
    public IActionResult GetQualityPlaylist(string videoId, string quality) {
        var filePath = _videoStorageService.GetHlsQualityPlaylistPath(videoId, quality);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{videoId}/{segment}")]
    public IActionResult GetSegment(string videoId, string segment) {
        var filePath = _videoStorageService.GetHlsSegmentPath(videoId, segment);
        if (filePath == null) {
            return segment.EndsWith(".ts") ? NotFound() : BadRequest("Invalid segment");
        }

        return PhysicalFile(filePath, "video/mp2t");
    }
}
