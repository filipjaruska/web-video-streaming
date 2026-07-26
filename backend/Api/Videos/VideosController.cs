using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Services;

namespace WebWVideoStreamingAPI.Api.Videos;

[ApiController]
[Route("api/videos")]
public class VideosController : ControllerBase {
    private readonly IVideoCatalogService _catalog;
    private readonly IVideoStorageService _storage;
    private readonly IVideoTranscodeJobService _transcodeJobs;
    private readonly ILogger<VideosController> _logger;

    public VideosController(
        IVideoCatalogService catalog,
        IVideoStorageService storage,
        IVideoTranscodeJobService transcodeJobs,
        ILogger<VideosController> logger) {
        _catalog = catalog;
        _storage = storage;
        _transcodeJobs = transcodeJobs;
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
                size = video.Size,
                createdAt = video.CreatedAtUtc,
                publishedAt = video.PublishedAtUtc,
                hasHls = video.HasHls,
                hasDash = video.HasDash
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

    [HttpPost("{routeId}/transcode")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> Transcode(string routeId, CancellationToken cancellationToken) {
        try {
            var result = await _transcodeJobs.TranscodeByRouteIdAsync(routeId, cancellationToken);
            if (!result.Success && result.ErrorMessage == "Video not found") {
                return NotFound(new { message = "Video not found" });
            }

            if (!result.Success && result.ErrorMessage == "Source video not found") {
                return NotFound(new { message = "Source video not found" });
            }

            if (!result.Success) {
                return StatusCode(500, new {
                    error = "Transcode failed",
                    details = result.ErrorMessage,
                    transcodeId = result.TranscodeId,
                    hasHls = result.HasHls,
                    hasDash = result.HasDash
                });
            }

            return Ok(new {
                message = "Transcode completed",
                routeId,
                transcodeId = result.TranscodeId,
                hasHls = result.HasHls,
                hasDash = result.HasDash,
                hlsManifestUrl = $"/api/hls/{routeId}/master.m3u8",
                dashManifestUrl = $"/api/dash/{routeId}/manifest.mpd"
            });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to transcode video: {RouteId}", routeId);
            return StatusCode(500, new { error = "Failed to transcode video" });
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

        var path = _storage.GetThumbnailPath(routeId);
        if (!System.IO.File.Exists(path)) {
            return NotFound();
        }

        return PhysicalFile(path, "image/jpeg");
    }
}
