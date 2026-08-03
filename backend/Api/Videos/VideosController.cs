using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Core;

namespace WebWVideoStreamingAPI.Api.Videos;

[ApiController]
[Route("api/videos")]
public class VideosController : ControllerBase {
    private readonly IVideoCatalogService _catalog;
    private readonly IVideoStorageService _storage;
    private readonly ILogger<VideosController> _logger;

    public VideosController(
        IVideoCatalogService catalog,
        IVideoStorageService storage,
        ILogger<VideosController> logger) {
        _catalog = catalog;
        _storage = storage;
        _logger = logger;
    }

    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> ListVideos(CancellationToken cancellationToken) {
        var videos = await _catalog.ListPublishedAsync(cancellationToken);
        return Ok(new {
            count = videos.Count,
            videos = videos.Select(video => new {
                routeId = video.RouteId,
                title = video.Title,
                fileName = video.FileName,
                thumbnailUrl = video.ThumbnailUrl,
                size = video.Size,
                createdAt = video.CreatedAtUtc,
                publishedAt = video.PublishedAtUtc,
                hasHls = video.HasHls,
                hasDash = video.HasDash
            })
        });
    }

    [HttpGet("{routeId}/transcodes")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ListTranscodes(string routeId, CancellationToken cancellationToken) {
        var response = await _catalog.ListTranscodesAsync(routeId, cancellationToken);
        if (response == null) {
            return NotFound(new { message = "Video not found" });
        }

        return Ok(new {
            activeTranscodeId = response.ActiveTranscodeId,
            transcodes = response.Transcodes.Select(item => new {
                id = item.Id,
                ladderKind = item.LadderKind,
                label = item.Label,
                hasHls = item.HasHls,
                hasDash = item.HasDash,
                isActive = item.IsActive,
                status = item.Status,
                createdAtUtc = item.CreatedAtUtc
            })
        });
    }

    [HttpDelete("{routeId}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> DeleteVideo(string routeId, CancellationToken cancellationToken) {
        try {
            var deleted = await _catalog.DeleteByRouteIdAsync(routeId, cancellationToken);
            if (!deleted) {
                return NotFound(new { message = "Video not found" });
            }

            return Ok(new {
                message = "Video and transcoded versions deleted successfully",
                routeId
            });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to delete video: {RouteId}", routeId);
            return StatusCode(500, new { message = "Failed to delete video" });
        }
    }

    [HttpGet("{routeId}/thumbnail")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetThumbnail(string routeId, CancellationToken cancellationToken) {
        var video = await _catalog.GetByRouteIdAsync(routeId, cancellationToken);
        if (video == null) {
            return NotFound();
        }

        var path = _storage.ResolveThumbnailPath(routeId);
        if (path == null) {
            return NotFound();
        }

        var contentType = path.EndsWith(".webp", StringComparison.OrdinalIgnoreCase)
            ? "image/webp"
            : "image/jpeg";
        return PhysicalFile(path, contentType);
    }
}
