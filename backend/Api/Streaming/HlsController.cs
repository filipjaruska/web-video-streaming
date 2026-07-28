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

    [HttpGet("{routeId}/master.m3u8")]
    public async Task<IActionResult> GetMasterPlaylist(string routeId, CancellationToken cancellationToken) {
        var transcodeId = await ResolveActiveTranscodeIdAsync(routeId, requireHls: true, cancellationToken);
        if (transcodeId == null) {
            return NotFound();
        }

        var filePath = _storage.GetHlsManifestPath(routeId, transcodeId.Value);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{routeId}/{quality}.m3u8")]
    public async Task<IActionResult> GetQualityPlaylist(string routeId, string quality, CancellationToken cancellationToken) {
        var transcodeId = await ResolveActiveTranscodeIdAsync(routeId, requireHls: true, cancellationToken);
        if (transcodeId == null) {
            return NotFound();
        }

        var filePath = _storage.GetHlsQualityPlaylistPath(routeId, transcodeId.Value, quality);
        return filePath == null ? NotFound() : PhysicalFile(filePath, "application/vnd.apple.mpegurl");
    }

    [HttpGet("{routeId}/{segment}")]
    public async Task<IActionResult> GetSegment(string routeId, string segment, CancellationToken cancellationToken) {
        var transcodeId = await ResolveActiveTranscodeIdAsync(routeId, requireHls: true, cancellationToken);
        if (transcodeId == null) {
            return segment.EndsWith(".ts") ? NotFound() : BadRequest("Invalid segment");
        }

        var filePath = _storage.GetHlsSegmentPath(routeId, transcodeId.Value, segment);
        if (filePath == null) {
            return segment.EndsWith(".ts") ? NotFound() : BadRequest("Invalid segment");
        }

        return PhysicalFile(filePath, "video/mp2t");
    }

    private async Task<Guid?> ResolveActiveTranscodeIdAsync(string routeId, bool requireHls, CancellationToken cancellationToken) {
        var video = await _catalog.GetByRouteIdAsync(routeId, cancellationToken);
        if (video?.ActiveTranscodeId == null) {
            return null;
        }

        if (requireHls && video.ActiveTranscode?.HasHls != true) {
            return null;
        }

        return video.ActiveTranscodeId;
    }
}
