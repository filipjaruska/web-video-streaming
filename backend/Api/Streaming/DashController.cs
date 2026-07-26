using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Services;

namespace WebWVideoStreamingAPI.Api.Streaming;

[ApiController]
[Route("api/dash")]
public class DashController : ControllerBase {
    private readonly IVideoCatalogService _catalog;
    private readonly IVideoStorageService _storage;

    public DashController(
        IVideoCatalogService catalog,
        IVideoStorageService storage) {
        _catalog = catalog;
        _storage = storage;
    }

    [HttpGet("{routeId}/manifest.mpd")]
    public async Task<IActionResult> GetManifest(string routeId, CancellationToken cancellationToken) {
        var transcodeId = await ResolveActiveTranscodeIdAsync(routeId, requireDash: true, cancellationToken);
        if (transcodeId == null) {
            return NotFound();
        }

        var filePath = _storage.GetDashManifestPath(routeId, transcodeId.Value);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/dash+xml");
    }

    [HttpGet("{routeId}/{segment}")]
    public async Task<IActionResult> GetSegment(string routeId, string segment, CancellationToken cancellationToken) {
        var transcodeId = await ResolveActiveTranscodeIdAsync(routeId, requireDash: true, cancellationToken);
        if (transcodeId == null) {
            return segment.EndsWith(".m4s") || segment.EndsWith(".mp4")
                ? NotFound()
                : BadRequest("Invalid segment");
        }

        var filePath = _storage.GetDashSegmentPath(routeId, transcodeId.Value, segment);
        if (filePath == null) {
            return segment.EndsWith(".m4s") || segment.EndsWith(".mp4")
                ? NotFound()
                : BadRequest("Invalid segment");
        }

        return PhysicalFile(filePath, "video/mp4");
    }

    private async Task<Guid?> ResolveActiveTranscodeIdAsync(string routeId, bool requireDash, CancellationToken cancellationToken) {
        var video = await _catalog.GetByRouteIdAsync(routeId, cancellationToken);
        if (video?.ActiveTranscodeId == null) {
            return null;
        }

        if (requireDash && video.ActiveTranscode?.HasDash != true) {
            return null;
        }

        return video.ActiveTranscodeId;
    }
}
