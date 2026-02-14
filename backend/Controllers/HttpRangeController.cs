using Microsoft.AspNetCore.Mvc;

namespace WebWVideoStreamingAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HttpRangeController : ControllerBase {
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<HttpRangeController> _logger;

    public HttpRangeController(IWebHostEnvironment environment, ILogger<HttpRangeController> logger) {
        _environment = environment;
        _logger = logger;
    }

    [HttpGet("{videoId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult StreamVideo(string videoId) {
        try {
            var videoPath = Path.Combine(_environment.WebRootPath, "httprange", videoId, $"{videoId}.mp4");
            
            if (!System.IO.File.Exists(videoPath)) {
                videoPath = Path.Combine(_environment.WebRootPath, "httprange", videoId);
            }

            if (!System.IO.File.Exists(videoPath)) {
                _logger.LogWarning($"Video file not found at {videoPath}");
                return NotFound(new { message = "Video not found" });
            }

            var fileStream = System.IO.File.OpenRead(videoPath);
            return File(fileStream, "video/mp4", enableRangeProcessing: true);
        } catch (Exception ex) {
            _logger.LogError(ex, $"Error streaming video {videoId}");
            return StatusCode(500, new { message = "Error streaming video" });
        }
    }
}
