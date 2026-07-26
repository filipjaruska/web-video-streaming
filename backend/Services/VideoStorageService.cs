using Microsoft.Extensions.Options;
using WebWVideoStreamingAPI.Storage;

namespace WebWVideoStreamingAPI.Services;

public interface IVideoStorageService {
    string RootPath { get; }
    string GetVideoRoot(string routeId);
    string GetSourcePath(string routeId);
    string GetSourceDir(string routeId);
    string GetThumbnailPath(string routeId);
    string GetTranscodeDir(string routeId, Guid transcodeId);
    string GetHlsDir(string routeId, Guid transcodeId);
    string GetDashDir(string routeId, Guid transcodeId);
    string? ResolveSourcePath(string routeId);
    string? GetHlsManifestPath(string routeId, Guid transcodeId);
    string? GetHlsQualityPlaylistPath(string routeId, Guid transcodeId, string quality);
    string? GetHlsSegmentPath(string routeId, Guid transcodeId, string segment);
    string? GetDashManifestPath(string routeId, Guid transcodeId);
    string? GetDashSegmentPath(string routeId, Guid transcodeId, string segment);
    void EnsureSourceDir(string routeId);
    void EnsureHlsDir(string routeId, Guid transcodeId);
    void EnsureDashDir(string routeId, Guid transcodeId);
    Task SaveSourceAsync(string routeId, Stream content, CancellationToken cancellationToken = default);
    bool DeleteVideoTree(string routeId);
}

public class VideoStorageService : IVideoStorageService {
    private readonly string _rootPath;
    private readonly ILogger<VideoStorageService> _logger;

    public VideoStorageService(IOptions<StorageOptions> options, ILogger<VideoStorageService> logger) {
        _rootPath = options.Value.RootPath;
        _logger = logger;
        Directory.CreateDirectory(_rootPath);
    }

    public string RootPath => _rootPath;

    public string GetVideoRoot(string routeId) {
        return Path.Combine(_rootPath, SanitizeSegment(routeId));
    }

    public string GetSourceDir(string routeId) {
        return Path.Combine(GetVideoRoot(routeId), "source");
    }

    public string GetSourcePath(string routeId) {
        return Path.Combine(GetSourceDir(routeId), "source.mp4");
    }

    public string GetThumbnailPath(string routeId) {
        return Path.Combine(GetSourceDir(routeId), "thumb.jpg");
    }

    public string GetTranscodeDir(string routeId, Guid transcodeId) {
        return Path.Combine(GetVideoRoot(routeId), transcodeId.ToString("N"));
    }

    public string GetHlsDir(string routeId, Guid transcodeId) {
        return Path.Combine(GetTranscodeDir(routeId, transcodeId), "hls");
    }

    public string GetDashDir(string routeId, Guid transcodeId) {
        return Path.Combine(GetTranscodeDir(routeId, transcodeId), "dash");
    }

    public string? ResolveSourcePath(string routeId) {
        var path = GetSourcePath(routeId);
        return File.Exists(path) ? path : null;
    }

    public string? GetHlsManifestPath(string routeId, Guid transcodeId) {
        var filePath = Path.Combine(GetHlsDir(routeId, transcodeId), "master.m3u8");
        return File.Exists(filePath) ? filePath : null;
    }

    public string? GetHlsQualityPlaylistPath(string routeId, Guid transcodeId, string quality) {
        var filePath = Path.Combine(GetHlsDir(routeId, transcodeId), $"{quality}.m3u8");
        return File.Exists(filePath) ? filePath : null;
    }

    public string? GetHlsSegmentPath(string routeId, Guid transcodeId, string segment) {
        if (!segment.EndsWith(".ts", StringComparison.OrdinalIgnoreCase)) {
            return null;
        }

        var filePath = Path.Combine(GetHlsDir(routeId, transcodeId), segment);
        return File.Exists(filePath) ? filePath : null;
    }

    public string? GetDashManifestPath(string routeId, Guid transcodeId) {
        var filePath = Path.Combine(GetDashDir(routeId, transcodeId), "manifest.mpd");
        return File.Exists(filePath) ? filePath : null;
    }

    public string? GetDashSegmentPath(string routeId, Guid transcodeId, string segment) {
        if (!segment.EndsWith(".m4s", StringComparison.OrdinalIgnoreCase) &&
            !segment.EndsWith(".mp4", StringComparison.OrdinalIgnoreCase)) {
            return null;
        }

        var filePath = Path.Combine(GetDashDir(routeId, transcodeId), segment);
        return File.Exists(filePath) ? filePath : null;
    }

    public void EnsureSourceDir(string routeId) {
        Directory.CreateDirectory(GetSourceDir(routeId));
    }

    public void EnsureHlsDir(string routeId, Guid transcodeId) {
        Directory.CreateDirectory(GetHlsDir(routeId, transcodeId));
    }

    public void EnsureDashDir(string routeId, Guid transcodeId) {
        Directory.CreateDirectory(GetDashDir(routeId, transcodeId));
    }

    public async Task SaveSourceAsync(string routeId, Stream content, CancellationToken cancellationToken = default) {
        EnsureSourceDir(routeId);
        var filePath = GetSourcePath(routeId);
        await using var stream = new FileStream(filePath, FileMode.Create, FileAccess.Write, FileShare.None);
        await content.CopyToAsync(stream, cancellationToken);
        _logger.LogInformation("Saved source for {RouteId} to {Path}", routeId, filePath);
    }

    public bool DeleteVideoTree(string routeId) {
        var videoRoot = GetVideoRoot(routeId);
        if (!Directory.Exists(videoRoot)) {
            return false;
        }

        Directory.Delete(videoRoot, recursive: true);
        _logger.LogInformation("Deleted video tree for {RouteId}", routeId);
        return true;
    }

    private static string SanitizeSegment(string segment) {
        return string.Join("_", segment.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
    }
}
