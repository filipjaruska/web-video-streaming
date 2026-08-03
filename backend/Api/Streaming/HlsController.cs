using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Core;

namespace WebWVideoStreamingAPI.Api.Streaming;

[ApiController]
[Route("api/hls")]
public class HlsController : ControllerBase {
    private readonly IVideoCatalogService _catalog;
    private readonly IVideoStorageService _storage;

    public HlsController(
        IVideoCatalogService catalog,
        IVideoStorageService storage) {
        _catalog = catalog;
        _storage = storage;
    }

    [HttpGet("{routeId}/t/{transcodeId}/master.m3u8")]
    public async Task<IActionResult> GetMasterPlaylistForTranscode(
        string routeId,
        string transcodeId,
        CancellationToken cancellationToken) {
        var id = await ResolveTranscodeIdAsync(routeId, transcodeId, requireHls: true, cancellationToken);
        if (id == null) {
            return NotFound();
        }

        var filePath = _storage.GetHlsManifestPath(routeId, id.Value);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{routeId}/t/{transcodeId}/{quality}.m3u8")]
    public async Task<IActionResult> GetQualityPlaylistForTranscode(
        string routeId,
        string transcodeId,
        string quality,
        CancellationToken cancellationToken) {
        var id = await ResolveTranscodeIdAsync(routeId, transcodeId, requireHls: true, cancellationToken);
        if (id == null) {
            return NotFound();
        }

        var filePath = _storage.GetHlsQualityPlaylistPath(routeId, id.Value, quality);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{routeId}/t/{transcodeId}/{segment}")]
    public async Task<IActionResult> GetSegmentForTranscode(
        string routeId,
        string transcodeId,
        string segment,
        CancellationToken cancellationToken) {
        var id = await ResolveTranscodeIdAsync(routeId, transcodeId, requireHls: true, cancellationToken);
        if (id == null) {
            return segment.EndsWith(".ts") ? NotFound() : BadRequest("Invalid segment");
        }

        var filePath = _storage.GetHlsSegmentPath(routeId, id.Value, segment);
        if (filePath == null) {
            return segment.EndsWith(".ts") ? NotFound() : BadRequest("Invalid segment");
        }

        return PhysicalFile(filePath, "video/mp2t");
    }

    [HttpGet("{routeId}/master.m3u8")]
    public async Task<IActionResult> GetMasterPlaylist(string routeId, CancellationToken cancellationToken) {
        var transcodeId = await ResolveTranscodeIdAsync(routeId, requestedTranscodeId: null, requireHls: true, cancellationToken);
        if (transcodeId == null) {
            return NotFound();
        }

        var filePath = _storage.GetHlsManifestPath(routeId, transcodeId.Value);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{routeId}/{quality}.m3u8")]
    public async Task<IActionResult> GetQualityPlaylist(string routeId, string quality, CancellationToken cancellationToken) {
        var transcodeId = await ResolveTranscodeIdAsync(routeId, requestedTranscodeId: null, requireHls: true, cancellationToken);
        if (transcodeId == null) {
            return NotFound();
        }

        var filePath = _storage.GetHlsQualityPlaylistPath(routeId, transcodeId.Value, quality);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{routeId}/{segment}")]
    public async Task<IActionResult> GetSegment(string routeId, string segment, CancellationToken cancellationToken) {
        var transcodeId = await ResolveTranscodeIdAsync(routeId, requestedTranscodeId: null, requireHls: true, cancellationToken);
        if (transcodeId == null) {
            return segment.EndsWith(".ts") ? NotFound() : BadRequest("Invalid segment");
        }

        var filePath = _storage.GetHlsSegmentPath(routeId, transcodeId.Value, segment);
        if (filePath == null) {
            return segment.EndsWith(".ts") ? NotFound() : BadRequest("Invalid segment");
        }

        return PhysicalFile(filePath, "video/mp2t");
    }

    private async Task<Guid?> ResolveTranscodeIdAsync(
        string routeId,
        string? requestedTranscodeId,
        bool requireHls,
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
            requireHls: requireHls,
            requireDash: false,
            cancellationToken);
    }
}
