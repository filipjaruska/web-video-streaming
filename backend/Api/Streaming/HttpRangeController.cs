using System.Collections.Concurrent;
using Microsoft.AspNetCore.Mvc;

namespace WebWVideoStreamingAPI.Api.Streaming;

[ApiController]
[Route("api/httprange")]
public class HttpRangeController : ControllerBase {
    /// <summary>
    /// Codec of the source's video stream, on the HEAD response. The browser does not expose the codec
    /// of a progressive file, so the player page used to print a guess — "H.264" for every source.
    /// Must be listed among the CORS exposed headers for the page to read it.
    /// </summary>
    public const string VideoCodecHeader = "X-Video-Codec";

    /// <summary>ffprobe once per source file version, not once per HEAD — a benchmark sends one per run.</summary>
    private static readonly ConcurrentDictionary<string, string> CodecCache = new();

    private readonly VideoCatalogService _catalog;
    private readonly MediaPaths _paths;
    private readonly MediaProbe _probe;
    private readonly ILogger<HttpRangeController> _logger;

    public HttpRangeController(
        VideoCatalogService catalog,
        MediaPaths paths,
        MediaProbe probe,
        ILogger<HttpRangeController> logger) {
        _catalog = catalog;
        _paths = paths;
        _probe = probe;
        _logger = logger;
    }

    [HttpGet("{routeId}")]
    [HttpHead("{routeId}")]
    public async Task<IActionResult> StreamVideo(string routeId, CancellationToken cancellationToken) {
        try {
            var video = await _catalog.GetByRouteIdAsync(routeId, cancellationToken);
            if (video == null || video.PublishedAtUtc == null) {
                _logger.LogWarning("Video not found for {RouteId}", routeId);
                return NotFound(new { message = "Video not found" });
            }

            var videoPath = _paths.ResolveSource(routeId);
            if (videoPath == null) {
                _logger.LogWarning("Source file missing for {RouteId}", routeId);
                return NotFound(new { message = "Video not found" });
            }

            // Expose transferSize to cross-origin Resource Timing (stats panel).
            Response.Headers["Timing-Allow-Origin"] = "*";

            var contentType = string.IsNullOrWhiteSpace(video.SourceContentType)
                ? "video/mp4"
                : video.SourceContentType;

            if (HttpMethods.IsHead(Request.Method)) {
                var file = new FileInfo(videoPath);
                if (await ReadVideoCodecAsync(file, cancellationToken) is { } codec) {
                    Response.Headers[VideoCodecHeader] = codec;
                }

                Response.ContentType = contentType;
                Response.ContentLength = file.Length;
                Response.Headers.AcceptRanges = "bytes";
                return Ok();
            }

            return File(System.IO.File.OpenRead(videoPath), contentType, enableRangeProcessing: true);
        } catch (Exception ex) {
            _logger.LogError(ex, "Error streaming video {RouteId}", routeId);
            return StatusCode(500, new { message = "Error streaming video", error = ex.Message });
        }
    }

    /// <summary>The first video stream's <c>codec_name</c> (h264, hevc, av1…), or null when unreadable.</summary>
    private async Task<string?> ReadVideoCodecAsync(FileInfo file, CancellationToken cancellationToken) {
        var key = $"{file.FullName}|{file.Length}|{file.LastWriteTimeUtc.Ticks}";
        if (CodecCache.TryGetValue(key, out var cached)) {
            return cached;
        }

        var probe = await _probe.ProbeAsync(file.FullName, cancellationToken);
        using var document = probe.ProbeData;
        if (document == null || !document.RootElement.TryGetProperty("streams", out var streams)) {
            return null;
        }

        foreach (var stream in streams.EnumerateArray()) {
            if (stream.TryGetProperty("codec_type", out var type) && type.GetString() == "video" &&
                stream.TryGetProperty("codec_name", out var name) && name.GetString() is { Length: > 0 } codec) {
                CodecCache[key] = codec;
                return codec;
            }
        }

        return null;
    }
}
