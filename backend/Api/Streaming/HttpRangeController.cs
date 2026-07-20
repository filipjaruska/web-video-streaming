using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Services;

namespace WebWVideoStreamingAPI.Api.Streaming;

[ApiController]
[Route("api/httprange")]
public class HttpRangeController : ControllerBase {
    private readonly IVideoStorageService _videoStorageService;
    private readonly ILogger<HttpRangeController> _logger;

    public HttpRangeController(IVideoStorageService videoStorageService, ILogger<HttpRangeController> logger) {
        _videoStorageService = videoStorageService;
        _logger = logger;
    }

    [HttpGet("{videoId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult StreamVideo(string videoId) {
        try {
            var videoPath = _videoStorageService.ResolveSourcePath(videoId);
            if (videoPath == null) {
                _logger.LogWarning("Video file not found for {VideoId}", videoId);
                return NotFound(new { message = "Video not found" });
            }

            var fileStream = System.IO.File.OpenRead(videoPath);
            return File(fileStream, "video/mp4", enableRangeProcessing: true);
        } catch (Exception ex) {
            _logger.LogError(ex, "Error streaming video {VideoId}", videoId);
            return StatusCode(500, new { message = "Error streaming video" });
        }
    }
}
