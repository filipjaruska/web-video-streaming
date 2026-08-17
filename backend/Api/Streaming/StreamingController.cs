using Microsoft.AspNetCore.Mvc;

namespace WebWVideoStreamingAPI.Api.Streaming;

/// <summary>
/// Serves packaged HLS and DASH. Both formats answer the same four questions — with or without an
/// explicit transcode id, manifest or segment — so they share one implementation and differ only
/// in which file the request resolves to.
/// </summary>
[ApiController]
[Route("api")]
public class StreamingController : ControllerBase {
    private const string HlsPlaylistType = "application/vnd.apple.mpegurl";
    private const string DashManifestType = "application/dash+xml";

    private readonly VideoCatalogService _catalog;
    private readonly MediaPaths _paths;

    public StreamingController(VideoCatalogService catalog, MediaPaths paths) {
        _catalog = catalog;
        _paths = paths;
    }

    // —— HLS ——————————————————————————————————————————————————————————————

    [HttpGet("hls/{routeId}/master.m3u8")]
    public Task<IActionResult> GetHlsMaster(string routeId, CancellationToken cancellationToken) =>
        ServeAsync(routeId, null, id => _paths.ResolveHlsManifest(routeId, id), HlsPlaylistType, requireHls: true, cancellationToken);

    [HttpGet("hls/{routeId}/t/{transcodeId}/master.m3u8")]
    public Task<IActionResult> GetHlsMasterForTranscode(string routeId, string transcodeId, CancellationToken cancellationToken) =>
        ServeAsync(routeId, transcodeId, id => _paths.ResolveHlsManifest(routeId, id), HlsPlaylistType, requireHls: true, cancellationToken);

    [HttpGet("hls/{routeId}/{quality}.m3u8")]
    public Task<IActionResult> GetHlsPlaylist(string routeId, string quality, CancellationToken cancellationToken) =>
        ServeAsync(routeId, null, id => _paths.ResolveHlsPlaylist(routeId, id, quality), HlsPlaylistType, requireHls: true, cancellationToken);

    [HttpGet("hls/{routeId}/t/{transcodeId}/{quality}.m3u8")]
    public Task<IActionResult> GetHlsPlaylistForTranscode(string routeId, string transcodeId, string quality, CancellationToken cancellationToken) =>
        ServeAsync(routeId, transcodeId, id => _paths.ResolveHlsPlaylist(routeId, id, quality), HlsPlaylistType, requireHls: true, cancellationToken);

    [HttpGet("hls/{routeId}/{segment}")]
    public Task<IActionResult> GetHlsSegment(string routeId, string segment, CancellationToken cancellationToken) =>
        ServeSegmentAsync(routeId, null, id => _paths.ResolveHlsSegment(routeId, id, segment), segment, IsHlsSegment, "video/mp2t", requireHls: true, cancellationToken);

    [HttpGet("hls/{routeId}/t/{transcodeId}/{segment}")]
    public Task<IActionResult> GetHlsSegmentForTranscode(string routeId, string transcodeId, string segment, CancellationToken cancellationToken) =>
        ServeSegmentAsync(routeId, transcodeId, id => _paths.ResolveHlsSegment(routeId, id, segment), segment, IsHlsSegment, "video/mp2t", requireHls: true, cancellationToken);

    // —— DASH —————————————————————————————————————————————————————————————

    [HttpGet("dash/{routeId}/manifest.mpd")]
    public Task<IActionResult> GetDashManifest(string routeId, CancellationToken cancellationToken) =>
        ServeAsync(routeId, null, id => _paths.ResolveDashManifest(routeId, id), DashManifestType, requireHls: false, cancellationToken);

    [HttpGet("dash/{routeId}/t/{transcodeId}/manifest.mpd")]
    public Task<IActionResult> GetDashManifestForTranscode(string routeId, string transcodeId, CancellationToken cancellationToken) =>
        ServeAsync(routeId, transcodeId, id => _paths.ResolveDashManifest(routeId, id), DashManifestType, requireHls: false, cancellationToken);

    [HttpGet("dash/{routeId}/{segment}")]
    public Task<IActionResult> GetDashSegment(string routeId, string segment, CancellationToken cancellationToken) =>
        ServeSegmentAsync(routeId, null, id => _paths.ResolveDashSegment(routeId, id, segment), segment, IsDashSegment, "video/mp4", requireHls: false, cancellationToken);

    [HttpGet("dash/{routeId}/t/{transcodeId}/{segment}")]
    public Task<IActionResult> GetDashSegmentForTranscode(string routeId, string transcodeId, string segment, CancellationToken cancellationToken) =>
        ServeSegmentAsync(routeId, transcodeId, id => _paths.ResolveDashSegment(routeId, id, segment), segment, IsDashSegment, "video/mp4", requireHls: false, cancellationToken);

    // —— Shared ———————————————————————————————————————————————————————————

    private async Task<IActionResult> ServeAsync(
        string routeId,
        string? transcodeId,
        Func<Guid, string?> resolveFile,
        string contentType,
        bool requireHls,
        CancellationToken cancellationToken) {
        var resolved = await ResolveTranscodeIdAsync(routeId, transcodeId, requireHls, cancellationToken);
        if (resolved == null) {
            return NotFound();
        }

        var filePath = resolveFile(resolved.Value);
        return filePath == null ? NotFound() : PhysicalFile(filePath, contentType);
    }

    /// <summary>
    /// Segments answer 400 rather than 404 when the name is not a segment at all — this route is
    /// the catch-all for its prefix, so a bad path lands here.
    /// </summary>
    private async Task<IActionResult> ServeSegmentAsync(
        string routeId,
        string? transcodeId,
        Func<Guid, string?> resolveFile,
        string segment,
        Func<string, bool> isSegmentName,
        string contentType,
        bool requireHls,
        CancellationToken cancellationToken) {
        var resolved = await ResolveTranscodeIdAsync(routeId, transcodeId, requireHls, cancellationToken);
        var filePath = resolved == null ? null : resolveFile(resolved.Value);

        if (filePath == null) {
            return isSegmentName(segment) ? NotFound() : BadRequest("Invalid segment");
        }

        return PhysicalFile(filePath, contentType);
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
            requireDash: !requireHls,
            cancellationToken);
    }

    private static bool IsHlsSegment(string segment) =>
        segment.EndsWith(".ts", StringComparison.OrdinalIgnoreCase);

    private static bool IsDashSegment(string segment) =>
        segment.EndsWith(".m4s", StringComparison.OrdinalIgnoreCase) ||
        segment.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase);
}
