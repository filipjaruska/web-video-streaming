using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Core;

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

    [HttpGet("{routeId}/t/{transcodeId}/manifest.mpd")]
    public async Task<IActionResult> GetManifestForTranscode(
        string routeId,
        string transcodeId,
        CancellationToken cancellationToken) {
        var id = await ResolveTranscodeIdAsync(routeId, transcodeId, cancellationToken);
        if (id == null) {
            return NotFound();
        }

        var filePath = _storage.GetDashManifestPath(routeId, id.Value);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/dash+xml");
    }

    [HttpGet("{routeId}/t/{transcodeId}/{segment}")]
    public async Task<IActionResult> GetSegmentForTranscode(
        string routeId,
        string transcodeId,
        string segment,
        CancellationToken cancellationToken) {
        var id = await ResolveTranscodeIdAsync(routeId, transcodeId, cancellationToken);
        if (id == null) {
            return segment.EndsWith(".m4s") || segment.EndsWith(".mp4")
                ? NotFound()
                : BadRequest("Invalid segment");
        }

        var filePath = _storage.GetDashSegmentPath(routeId, id.Value, segment);
        if (filePath == null) {
            return segment.EndsWith(".m4s") || segment.EndsWith(".mp4")
                ? NotFound()
                : BadRequest("Invalid segment");
        }

        return PhysicalFile(filePath, "video/mp4");
    }

    [HttpGet("{routeId}/manifest.mpd")]
    public async Task<IActionResult> GetManifest(string routeId, CancellationToken cancellationToken) {
        var transcodeId = await ResolveTranscodeIdAsync(routeId, requestedTranscodeId: null, cancellationToken);
        if (transcodeId == null) {
            return NotFound();
        }

        var filePath = _storage.GetDashManifestPath(routeId, transcodeId.Value);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/dash+xml");
    }

    [HttpGet("{routeId}/{segment}")]
    public async Task<IActionResult> GetSegment(string routeId, string segment, CancellationToken cancellationToken) {
        var transcodeId = await ResolveTranscodeIdAsync(routeId, requestedTranscodeId: null, cancellationToken);
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

    private async Task<Guid?> ResolveTranscodeIdAsync(
        string routeId,
        string? requestedTranscodeId,
        CancellationToken cancellationToken) {
        Guid? parsed = null;
        if (!string.IsNullOrWhiteSpace(requestedTranscodeId)) {
            if (!Guid.TryParse(requestedTranscodeId, out var guid)) {
                return null;
            }

            parsed = guid;
        }

        return await _catalog.ResolveStreamTranscodeIdAsync(
            routeId,
            parsed,
            requireHls: false,
            requireDash: true,
            cancellationToken);
    }
}
