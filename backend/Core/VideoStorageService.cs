using Microsoft.Extensions.Options;

namespace WebWVideoStreamingAPI.Core;

public class StorageOptions {
    public const string SectionName = "Storage";

    /// <summary>
    /// Absolute path to the media root. When empty, defaults to {ContentRoot}/App_Data/media.
    /// Override with env VIDEO_STORAGE_ROOT (e.g. /data/media on Railway).
    /// </summary>
    public string RootPath { get; set; } = string.Empty;
}

public interface IVideoStorageService {
    string RootPath { get; }
    string GetVideoRoot(string routeId);
    string GetSourcePath(string routeId);
    string GetSourceDir(string routeId);
    string GetThumbnailPath(string routeId);
    string? ResolveThumbnailPath(string routeId);
    string GetTranscodeDir(string routeId, Guid transcodeId);
    string GetHlsDir(string routeId, Guid transcodeId);
    string GetDashDir(string routeId, Guid transcodeId);
    string GetSubsDir(string routeId);
    string GetSubsManifestPath(string routeId);
    string? ResolveSubsManifestPath(string routeId);
    string? ResolveSubtitlePath(string routeId, string fileName);
    string? ResolveSourcePath(string routeId);
    string? GetHlsManifestPath(string routeId, Guid transcodeId);
    string? GetHlsQualityPlaylistPath(string routeId, Guid transcodeId, string quality);
    string? GetHlsSegmentPath(string routeId, Guid transcodeId, string segment);
    string? GetDashManifestPath(string routeId, Guid transcodeId);
    string? GetDashSegmentPath(string routeId, Guid transcodeId, string segment);
    void EnsureSourceDir(string routeId);
    void EnsureHlsDir(string routeId, Guid transcodeId);
    void EnsureDashDir(string routeId, Guid transcodeId);
    void EnsureSubsDir(string routeId);
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
        return Path.Combine(GetSourceDir(routeId), "thumb.webp");
    }

    public string? ResolveThumbnailPath(string routeId) {
        var webp = GetThumbnailPath(routeId);
        if (File.Exists(webp)) {
            return webp;
        }

        var legacyJpg = Path.Combine(GetSourceDir(routeId), "thumb.jpg");
        return File.Exists(legacyJpg) ? legacyJpg : null;
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

    public string GetSubsDir(string routeId) {
        return Path.Combine(GetVideoRoot(routeId), "subs");
    }

    public string GetSubsManifestPath(string routeId) {
        return Path.Combine(GetSubsDir(routeId), "manifest.json");
    }

    public string? ResolveSubsManifestPath(string routeId) {
        var path = GetSubsManifestPath(routeId);
        return File.Exists(path) ? path : null;
    }

    public string? ResolveSubtitlePath(string routeId, string fileName) {
        if (string.IsNullOrWhiteSpace(fileName) ||
            fileName.Contains('/') ||
            fileName.Contains('\\') ||
            fileName.Contains("..", StringComparison.Ordinal) ||
            !fileName.EndsWith(".vtt", StringComparison.OrdinalIgnoreCase)) {
            return null;
        }

        var filePath = Path.Combine(GetSubsDir(routeId), fileName);
        var fullPath = Path.GetFullPath(filePath);
        var subsRoot = Path.GetFullPath(GetSubsDir(routeId));
        if (!fullPath.StartsWith(subsRoot, StringComparison.OrdinalIgnoreCase)) {
            return null;
        }

        return File.Exists(fullPath) ? fullPath : null;
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

    public void EnsureSubsDir(string routeId) {
        Directory.CreateDirectory(GetSubsDir(routeId));
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
