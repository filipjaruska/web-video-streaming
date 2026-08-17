using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Analysis;

namespace WebWVideoStreamingAPI.Api.Videos;

public sealed class SubtitleTrackDto {
    public required string Id { get; init; }
    public required string Language { get; init; }
    public required string Label { get; init; }
    public required string Url { get; init; }
}

public sealed class SkippedSubtitleDto {
    public required string Id { get; init; }
    public required string Language { get; init; }
    public required string Label { get; init; }
    public required string Reason { get; init; }
}

public sealed class VideoSubtitlesResponse {
    public required string RouteId { get; init; }
    public required IReadOnlyList<SubtitleTrackDto> Tracks { get; init; }
    public required IReadOnlyList<SkippedSubtitleDto> Skipped { get; init; }
}

[ApiController]
[Route("api/videos")]
public class VideosController : ControllerBase {
    private static readonly JsonSerializerOptions ManifestJson = new() { PropertyNameCaseInsensitive = true };

    private readonly VideoCatalogService _catalog;
    private readonly AnalysisStore _analysis;
    private readonly MediaPaths _paths;
    private readonly ILogger<VideosController> _logger;

    public VideosController(
        VideoCatalogService catalog,
        AnalysisStore analysis,
        MediaPaths paths,
        ILogger<VideosController> logger) {
        _catalog = catalog;
        _analysis = analysis;
        _paths = paths;
        _logger = logger;
    }

    [HttpGet]
    [ProducesResponseType<ListVideosResponse>(StatusCodes.Status200OK)]
    public async Task<IActionResult> ListVideos(CancellationToken cancellationToken) {
        return Ok(await _catalog.ListPublishedAsync(cancellationToken));
    }

    [HttpGet("{routeId}/transcodes")]
    [ProducesResponseType<VideoTranscodesResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ListTranscodes(string routeId, CancellationToken cancellationToken) {
        var response = await _catalog.ListTranscodesAsync(routeId, cancellationToken);
        return response == null ? NotFound(new { message = "Video not found" }) : Ok(response);
    }

    [HttpGet("{routeId}/analysis")]
    [ProducesResponseType<VideoAnalysisResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetAnalysis(string routeId, CancellationToken cancellationToken) {
        var response = await _analysis.GetByRouteIdAsync(routeId, cancellationToken);
        return response == null ? NotFound(new { message = "Video not found" }) : Ok(response);
    }

    [HttpGet("{routeId}/subs")]
    [ProducesResponseType<VideoSubtitlesResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> ListSubtitles(string routeId, CancellationToken cancellationToken) {
        var video = await _catalog.GetByRouteIdAsync(routeId, cancellationToken);
        if (video == null) {
            return NotFound(new { message = "Video not found" });
        }

        var manifestPath = _paths.ResolveSubsManifest(routeId);
        if (manifestPath == null) {
            return Ok(new VideoSubtitlesResponse { RouteId = routeId, Tracks = [], Skipped = [] });
        }

        SubtitleManifest manifest;
        await using (var stream = System.IO.File.OpenRead(manifestPath)) {
            manifest = await JsonSerializer.DeserializeAsync<SubtitleManifest>(stream, ManifestJson, cancellationToken)
                ?? new SubtitleManifest();
        }

        return Ok(new VideoSubtitlesResponse {
            RouteId = routeId,
            // The URL is derived from the route, not stored, so it is built here.
            Tracks = manifest.Tracks.Select(track => new SubtitleTrackDto {
                Id = track.Id,
                Language = track.Language,
                Label = track.Label,
                Url = $"/api/videos/{routeId}/subs/{track.FileName}"
            }).ToList(),
            Skipped = manifest.Skipped.Select(item => new SkippedSubtitleDto {
                Id = item.Id,
                Language = item.Language,
                Label = item.Label,
                Reason = item.Reason
            }).ToList()
        });
    }

    [HttpGet("{routeId}/subs/{fileName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetSubtitleFile(
        string routeId,
        string fileName,
        CancellationToken cancellationToken) {
        var video = await _catalog.GetByRouteIdAsync(routeId, cancellationToken);
        if (video == null) {
            return NotFound();
        }

        var path = _paths.ResolveSubtitle(routeId, fileName);
        if (path == null) {
            return NotFound();
        }

        Response.Headers.CacheControl = "public, max-age=3600";
        return PhysicalFile(path, "text/vtt; charset=utf-8");
    }

    [HttpGet("{routeId}/thumbnail")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetThumbnail(string routeId, CancellationToken cancellationToken) {
        var video = await _catalog.GetByRouteIdAsync(routeId, cancellationToken);
        if (video == null) {
            return NotFound();
        }

        var path = _paths.ResolveThumbnail(routeId);
        if (path == null) {
            return NotFound();
        }

        var contentType = path.EndsWith(".webp", StringComparison.OrdinalIgnoreCase)
            ? "image/webp"
            : "image/jpeg";
        return PhysicalFile(path, contentType);
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

            return Ok(new { message = "Video and transcoded versions deleted successfully", routeId });
        } catch (Exception ex) {
            _logger.LogError(ex, "Failed to delete video: {RouteId}", routeId);
            return StatusCode(500, new { message = "Failed to delete video" });
        }
    }
}
