using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Core;

namespace WebWVideoStreamingAPI.Api.Streaming;

[ApiController]
[Route("api/httprange")]
public class HttpRangeController : ControllerBase {
    private readonly IVideoCatalogService _catalog;
    private readonly IVideoStorageService _storage;
    private readonly ILogger<HttpRangeController> _logger;

    public HttpRangeController(
        IVideoCatalogService catalog,
        IVideoStorageService storage,
        ILogger<HttpRangeController> logger) {
        _catalog = catalog;
        _storage = storage;
        _logger = logger;
    }

    [HttpGet("{routeId}")]
    public async Task<IActionResult> StreamVideo(string routeId, CancellationToken cancellationToken) {
        try {
            var video = await _catalog.GetByRouteIdAsync(routeId, cancellationToken);
            if (video == null || video.PublishedAtUtc == null) {
                _logger.LogWarning("Video not found for {RouteId}", routeId);
                return NotFound(new { message = "Video not found" });
            }

            var videoPath = _storage.ResolveSourcePath(routeId);
            if (videoPath == null) {
                _logger.LogWarning("Source file missing for {RouteId}", routeId);
                return NotFound(new { message = "Video not found" });
            }

            var contentType = string.IsNullOrWhiteSpace(video.SourceContentType)
                ? "video/mp4"
                : video.SourceContentType;

            var fileStream = System.IO.File.OpenRead(videoPath);
            return File(fileStream, contentType, enableRangeProcessing: true);
        } catch (Exception ex) {
            _logger.LogError(ex, "Error streaming video {RouteId}", routeId);
            return StatusCode(500, new { message = "Error streaming video", error = ex.Message });
        }
    }
}
