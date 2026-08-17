using Microsoft.AspNetCore.Mvc;

namespace WebWVideoStreamingAPI.Api.Streaming;

[ApiController]
[Route("api/httprange")]
public class HttpRangeController : ControllerBase {
    private readonly VideoCatalogService _catalog;
    private readonly MediaPaths _paths;
    private readonly ILogger<HttpRangeController> _logger;

    public HttpRangeController(
        VideoCatalogService catalog,
        MediaPaths paths,
        ILogger<HttpRangeController> logger) {
        _catalog = catalog;
        _paths = paths;
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
                Response.ContentType = contentType;
                Response.ContentLength = new FileInfo(videoPath).Length;
                Response.Headers.AcceptRanges = "bytes";
                return Ok();
            }

            return File(System.IO.File.OpenRead(videoPath), contentType, enableRangeProcessing: true);
        } catch (Exception ex) {
            _logger.LogError(ex, "Error streaming video {RouteId}", routeId);
            return StatusCode(500, new { message = "Error streaming video", error = ex.Message });
        }
    }
}
