using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Services;

namespace WebWVideoStreamingAPI.Controllers;

/// <summary>
/// DASH (Dynamic Adaptive Streaming over HTTP) Controller
/// Supports multiple ABR (Adaptive Bitrate) algorithms configured client-side via dash.js:
/// 
/// 1. Dynamic (Hybrid) - Default: Modern ABR strategy combining multiple factors including
///    bandwidth, buffer, and latency. Most robust for varying network conditions.
/// 
/// 2. Throughput-Based (abrThroughput): Legacy approach focusing solely on network
///    throughput measurements for quality selection.
/// 
/// 3. BOLA (abrBola): Buffer Occupancy based Lyapunov Algorithm. Mathematically proven
///    approach that optimizes QoE based on buffer state. Reduces rebuffering events.
/// 
/// 4. Baseline (Non-Adaptive): Disables ABR and locks to highest quality. Mimics
///    traditional progressive download. May cause rebuffering on insufficient bandwidth.
/// 
/// DASH is the MPEG industry standard used by Netflix, YouTube, and major streaming platforms.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class DashController : ControllerBase {
    private readonly IWebHostEnvironment _environment;
    private readonly IVideoTranscodingService _transcodingService;
    private readonly ILogger<DashController> _logger;

    public DashController(
        IWebHostEnvironment environment,
        IVideoTranscodingService transcodingService,
        ILogger<DashController> logger) {
        _environment = environment;
        _transcodingService = transcodingService;
        _logger = logger;
    }

    [HttpPost("generate/{videoId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status501NotImplemented)]
    public async Task<IActionResult> GenerateDash(string videoId) {
        try {
            var inputPath = Path.Combine(_environment.WebRootPath, "httprange", $"{videoId}.mp4");

            if (!System.IO.File.Exists(inputPath)) {
                return NotFound(new { message = "Source video not found" });
            }

            var dashOutputDir = Path.Combine(_environment.WebRootPath, "dash", videoId);

            if (Directory.Exists(dashOutputDir) && System.IO.File.Exists(Path.Combine(dashOutputDir, "manifest.mpd"))) {
                return Ok(new { message = "DASH already generated", manifestUrl = $"/api/dash/{videoId}/manifest.mpd" });
            }

            Directory.CreateDirectory(dashOutputDir);

            var result = await _transcodingService.GenerateDashAsync(inputPath, dashOutputDir);

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
        var filePath = Path.Combine(_environment.WebRootPath, "dash", videoId, "manifest.mpd");

        if (!System.IO.File.Exists(filePath)) {
            return NotFound();
        }

        return PhysicalFile(filePath, "application/dash+xml");
    }

    [HttpGet("{videoId}/{segment}")]
    public IActionResult GetSegment(string videoId, string segment) {
        if (!segment.EndsWith(".m4s") && !segment.EndsWith(".mp4")) {
            return BadRequest("Invalid segment");
        }

        var filePath = Path.Combine(_environment.WebRootPath, "dash", videoId, segment);

        if (!System.IO.File.Exists(filePath)) {
            return NotFound();
        }

        return PhysicalFile(filePath, "video/mp4");
    }
}
