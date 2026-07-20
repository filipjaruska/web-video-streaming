using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Services;

namespace WebWVideoStreamingAPI.Api.Streaming;

[ApiController]
[Route("api/dash")]
public class DashController : ControllerBase {
    private readonly IVideoStorageService _videoStorageService;
    private readonly IVideoTranscodingService _transcodingService;
    private readonly ILogger<DashController> _logger;

    public DashController(
        IVideoStorageService videoStorageService,
        IVideoTranscodingService transcodingService,
        ILogger<DashController> logger) {
        _videoStorageService = videoStorageService;
        _transcodingService = transcodingService;
        _logger = logger;
    }

    [HttpPost("generate/{videoId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status501NotImplemented)]
    public async Task<IActionResult> GenerateDash(string videoId, CancellationToken cancellationToken) {
        try {
            var inputPath = _videoStorageService.ResolveSourcePath(videoId);
            if (inputPath == null) {
                return NotFound(new { message = "Source video not found" });
            }

            if (_videoStorageService.HasDashGenerated(videoId)) {
                return Ok(new { message = "DASH already generated", manifestUrl = $"/api/dash/{videoId}/manifest.mpd" });
            }

            var dashOutputDir = _videoStorageService.GetDashOutputDir(videoId);
            _videoStorageService.EnsureDashOutputDir(videoId);

            var result = await _transcodingService.GenerateDashAsync(inputPath, dashOutputDir, cancellationToken: cancellationToken);

            if (!result.Success) {
                return StatusCode(501, new { error = "DASH generation not yet implemented", details = result.ErrorMessage });
            }

            return Ok(new {
                message = "DASH generation completed",
                manifestUrl = $"/api/dash/{videoId}/manifest.mpd",
                filesGenerated = result.GeneratedFiles.Count
            });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to generate DASH for video: {VideoId}", videoId);
            return StatusCode(500, new { error = "Failed to generate DASH streams" });
        }
    }

    [HttpGet("{videoId}/manifest.mpd")]
    public IActionResult GetManifest(string videoId) {
        var filePath = _videoStorageService.GetDashManifestPath(videoId);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/dash+xml");
    }

    [HttpGet("{videoId}/{segment}")]
    public IActionResult GetSegment(string videoId, string segment) {
        var filePath = _videoStorageService.GetDashSegmentPath(videoId, segment);
        if (filePath == null) {
            return segment.EndsWith(".m4s") || segment.EndsWith(".mp4")
                ? NotFound()
                : BadRequest("Invalid segment");
        }

        return PhysicalFile(filePath, "video/mp4");
    }
}
