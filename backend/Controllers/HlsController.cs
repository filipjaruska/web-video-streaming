using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Services;

namespace WebWVideoStreamingAPI.Controllers;

/// <summary>
/// HLS (HTTP Live Streaming) Controller
/// Supports multiple ABR (Adaptive Bitrate) algorithms configured client-side:
/// 
/// 1. Hybrid (Dynamic) - Default: Combines bandwidth estimation and buffer occupancy
///    for balanced quality adaptation. Modern standard approach.
/// 
/// 2. Throughput-Based (Legacy): Makes quality decisions primarily based on network
///    speed estimation. Can be aggressive in quality changes.
/// 
/// 3. Buffer-Based (BOLA): Buffer Occupancy based Lyapunov Algorithm. Makes decisions
///    based on current buffer level to optimize quality while avoiding rebuffering.
/// 
/// 4. Baseline (Non-Adaptive): Locks to highest quality available. Will cause stalls
///    if network bandwidth is insufficient. Similar to HTTP Range progressive download.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class HlsController : ControllerBase {
    private readonly IWebHostEnvironment _environment;
    private readonly IVideoTranscodingService _transcodingService;
    private readonly ILogger<HlsController> _logger;

    public HlsController(
        IWebHostEnvironment environment,
        IVideoTranscodingService transcodingService,
        ILogger<HlsController> logger) {
        _environment = environment;
        _transcodingService = transcodingService;
        _logger = logger;
    }

    [HttpPost("generate/{videoId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GenerateHls(string videoId) {
        try {
            var inputPath = Path.Combine(_environment.WebRootPath, "httprange", videoId, $"{videoId}.mp4");
            if (!System.IO.File.Exists(inputPath)) {
                inputPath = Path.Combine(_environment.WebRootPath, "httprange", $"{videoId}.mp4");
            }

            if (!System.IO.File.Exists(inputPath)) {
                return NotFound(new { message = "Source video not found" });
            }

            var hlsOutputDir = Path.Combine(_environment.WebRootPath, "hls", videoId);

            if (Directory.Exists(hlsOutputDir) && System.IO.File.Exists(Path.Combine(hlsOutputDir, "master.m3u8"))) {
                return Ok(new { message = "HLS already generated", manifestUrl = $"/api/hls/{videoId}/master.m3u8" });
            }

            Directory.CreateDirectory(hlsOutputDir);

            var result = await _transcodingService.GenerateHlsAsync(inputPath, hlsOutputDir);

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
        var filePath = Path.Combine(_environment.WebRootPath, "hls", videoId, "master.m3u8");

        if (!System.IO.File.Exists(filePath)) {
            return NotFound();
        }

        return PhysicalFile(filePath, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{videoId}/{quality}.m3u8")]
    public IActionResult GetQualityPlaylist(string videoId, string quality) {
        var filePath = Path.Combine(_environment.WebRootPath, "hls", videoId, $"{quality}.m3u8");

        if (!System.IO.File.Exists(filePath)) {
            return NotFound();
        }

        return PhysicalFile(filePath, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{videoId}/{segment}")]
    public IActionResult GetSegment(string videoId, string segment) {
        if (!segment.EndsWith(".ts")) {
            return BadRequest("Invalid segment");
        }

        var filePath = Path.Combine(_environment.WebRootPath, "hls", videoId, segment);

        if (!System.IO.File.Exists(filePath)) {
            return NotFound();
        }

        return PhysicalFile(filePath, "video/mp2t");
    }
}
