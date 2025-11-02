using Microsoft.AspNetCore.Mvc;

namespace WebWVideoStreamingAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class VideoController : ControllerBase
{
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<VideoController> _logger;

    public VideoController(IWebHostEnvironment environment, ILogger<VideoController> logger)
    {
        _environment = environment;
        _logger = logger;
    }

    [HttpGet("{fileName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public IActionResult StreamVideo(string fileName)
    {
        try
        {
            var videoPath = Path.Combine(_environment.WebRootPath, "videos", fileName);

            if (!System.IO.File.Exists(videoPath))
            {
                _logger.LogWarning($"Video file not found at {videoPath}");
                return NotFound(new { message = "Video not found" });
            }

            var fileStream = System.IO.File.OpenRead(videoPath);
            return File(fileStream, "video/mp4", enableRangeProcessing: true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"Error streaming video at {fileName}");
            return StatusCode(500, new { message = "Error streaming video" });
        }
    }
}
