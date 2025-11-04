using Microsoft.AspNetCore.Mvc;
using System.Diagnostics;

namespace WebWVideoStreamingAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HlsController : ControllerBase {
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<HlsController> _logger;

    public HlsController(IWebHostEnvironment environment, ILogger<HlsController> logger) {
        _environment = environment;
        _logger = logger;
    }

    [HttpPost("generate/{videoId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GenerateHls(string videoId) {
        try {
            var inputPath = Path.Combine(_environment.WebRootPath, "videos", $"{videoId}.mp4");

            if (!System.IO.File.Exists(inputPath)) {
                return NotFound(new { message = "Source video not found" });
            }

            var hlsOutputDir = Path.Combine(_environment.WebRootPath, "hls", videoId);

            if (Directory.Exists(hlsOutputDir) && System.IO.File.Exists(Path.Combine(hlsOutputDir, "master.m3u8"))) {
                return Ok(new { message = "HLS already generated", manifestUrl = $"/api/hls/{videoId}/master.m3u8" });
            }

            Directory.CreateDirectory(hlsOutputDir);

            await GenerateHlsVariants(inputPath, hlsOutputDir);

            return Ok(new { message = "HLS generation started", manifestUrl = $"/api/hls/{videoId}/master.m3u8" });
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

    private async Task GenerateHlsVariants(string inputPath, string outputDir) {
        var variants = new[]
        {
            ("1920:1080", "5000k", "1080p"),
            ("640:360", "800k", "360p")
        };

        var tasks = variants.Select(variant =>
            GenerateHlsVariant(inputPath, outputDir, variant.Item1, variant.Item2, variant.Item3)
        ).ToList();

        await Task.WhenAll(tasks);

        await GenerateMasterPlaylist(outputDir, variants);
    }

    private async Task GenerateHlsVariant(string inputPath, string outputDir, string scale, string bitrate, string name) {
        var segmentPattern = Path.Combine(outputDir, $"{name}_%03d.ts");
        var playlistPath = Path.Combine(outputDir, $"{name}.m3u8");

        // -y to overwrite files without asking
        // https://gist.github.com/tayvano/6e2d456a9897f55025e25035478a3a50
        var ffmpegArgs = $@"-y -i ""{inputPath}"" " +
            $@"-vf scale={scale} " +
            $@"-c:v libx264 -b:v {bitrate} -maxrate {bitrate} -bufsize {int.Parse(bitrate.TrimEnd('k')) * 2}k " +
            $@"-c:a aac -b:a 128k -ac 2 " +
            $@"-f hls " +
            $@"-hls_time 6 " +
            $@"-hls_list_size 0 " +
            $@"-hls_segment_filename ""{segmentPattern}"" " +
            $@"""{playlistPath}""";

        _logger.LogInformation("Starting FFmpeg for {Name}: ffmpeg {Args}", name, ffmpegArgs);

        var processInfo = new ProcessStartInfo {
            FileName = "ffmpeg",
            Arguments = ffmpegArgs,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };

        using var process = Process.Start(processInfo);
        if (process != null) {
            var outputTask = process.StandardOutput.ReadToEndAsync();
            var errorTask = process.StandardError.ReadToEndAsync();

            await process.WaitForExitAsync();

            var output = await outputTask;
            var error = await errorTask;

            if (process.ExitCode != 0) {
                _logger.LogError("FFmpeg error for {Name} (exit code {ExitCode}): {Error}", name, process.ExitCode, error);
            } else {
                _logger.LogInformation("FFmpeg completed successfully for {Name}", name);
            }
        }
    }

    private async Task GenerateMasterPlaylist(string outputDir, (string scale, string bitrate, string name)[] variants) {
        var masterPlaylistPath = Path.Combine(outputDir, "master.m3u8");

        var lines = new List<string> { "#EXTM3U", "#EXT-X-VERSION:3" };

        foreach (var variant in variants) {
            var bitrate = int.Parse(variant.bitrate.TrimEnd('k')) * 1000;
            var resolution = variant.scale.Replace(":", "x");

            lines.Add($"#EXT-X-STREAM-INF:BANDWIDTH={bitrate},RESOLUTION={resolution}");
            lines.Add($"{variant.name}.m3u8");
        }

        await System.IO.File.WriteAllLinesAsync(masterPlaylistPath, lines);
    }
}
