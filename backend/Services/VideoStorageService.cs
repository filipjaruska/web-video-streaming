namespace WebWVideoStreamingAPI.Services;

public sealed class VideoUploadResult {
    public bool Success { get; init; }
    public string? ErrorCode { get; init; }
    public string? Message { get; init; }
    public string? VideoId { get; init; }
    public string? FileName { get; init; }
    public long Size { get; init; }
    public DateTime UploadedAtUtc { get; init; }
    public string[]? AllowedExtensions { get; init; }
}

public sealed class VideoListItem {
    public required string VideoId { get; init; }
    public required string FileName { get; init; }
    public long Size { get; init; }
    public DateTime CreatedAtUtc { get; init; }
    public bool HasHls { get; init; }
    public bool HasDash { get; init; }
}

public interface IVideoStorageService {
    string? ResolveSourcePath(string videoId);
    Task<VideoUploadResult> UploadAsync(Stream content, string fileName, long fileSize, string? videoId, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<VideoListItem>> ListAsync(CancellationToken cancellationToken = default);
    Task<bool> DeleteAsync(string videoId, CancellationToken cancellationToken = default);
    string? GetHlsManifestPath(string videoId);
    string? GetHlsQualityPlaylistPath(string videoId, string quality);
    string? GetHlsSegmentPath(string videoId, string segment);
    string? GetDashManifestPath(string videoId);
    string? GetDashSegmentPath(string videoId, string segment);
    string GetHlsOutputDir(string videoId);
    string GetDashOutputDir(string videoId);
    void EnsureHlsOutputDir(string videoId);
    void EnsureDashOutputDir(string videoId);
    bool HasHlsGenerated(string videoId);
    bool HasDashGenerated(string videoId);
}

public class VideoStorageService : IVideoStorageService {
    private const long MaxFileSize = 500 * 1024 * 1024;
    private static readonly string[] AllowedExtensions = { ".mp4", ".mov", ".avi", ".mkv", ".webm" };

    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<VideoStorageService> _logger;

    public VideoStorageService(IWebHostEnvironment environment, ILogger<VideoStorageService> logger) {
        _environment = environment;
        _logger = logger;
    }

    public string? ResolveSourcePath(string videoId) {
        var nestedPath = Path.Combine(_environment.WebRootPath, "httprange", videoId, $"{videoId}.mp4");
        if (File.Exists(nestedPath)) {
            return nestedPath;
        }

        var flatPath = Path.Combine(_environment.WebRootPath, "httprange", $"{videoId}.mp4");
        return File.Exists(flatPath) ? flatPath : null;
    }

    public async Task<VideoUploadResult> UploadAsync(
        Stream content,
        string fileName,
        long fileSize,
        string? videoId,
        CancellationToken cancellationToken = default) {
        if (fileSize == 0) {
            return Fail("NoFile", "No file uploaded");
        }

        if (fileSize > MaxFileSize) {
            return Fail("TooLarge", $"File size exceeds maximum limit of {MaxFileSize / (1024 * 1024)} MB");
        }

        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        if (!AllowedExtensions.Contains(extension)) {
            return new VideoUploadResult {
                Success = false,
                ErrorCode = "InvalidType",
                Message = "Invalid file type",
                AllowedExtensions = AllowedExtensions
            };
        }

        videoId = SanitizeVideoId(videoId, fileName);
        var uploadDir = Path.Combine(_environment.WebRootPath, "httprange", videoId);

        if (Directory.Exists(uploadDir)) {
            return Fail("DuplicateId", "A video with this ID already exists", videoId);
        }

        Directory.CreateDirectory(uploadDir);
        var filePath = Path.Combine(uploadDir, $"{videoId}.mp4");

        await using (var stream = new FileStream(filePath, FileMode.Create)) {
            await content.CopyToAsync(stream, cancellationToken);
        }

        _logger.LogInformation("Video uploaded successfully: {VideoId}, Size: {Size} bytes", videoId, fileSize);

        return new VideoUploadResult {
            Success = true,
            VideoId = videoId,
            FileName = $"{videoId}.mp4",
            Size = fileSize,
            UploadedAtUtc = DateTime.UtcNow
        };
    }

    public Task<IReadOnlyList<VideoListItem>> ListAsync(CancellationToken cancellationToken = default) {
        var uploadDir = Path.Combine(_environment.WebRootPath, "httprange");
        Directory.CreateDirectory(uploadDir);

        var videos = Directory.GetDirectories(uploadDir)
            .Select(dir => {
                var videoId = Path.GetFileName(dir);
                var videoPath = Path.Combine(dir, $"{videoId}.mp4");
                if (!File.Exists(videoPath)) {
                    return null;
                }

                var fileInfo = new FileInfo(videoPath);
                return new VideoListItem {
                    VideoId = videoId,
                    FileName = fileInfo.Name,
                    Size = fileInfo.Length,
                    CreatedAtUtc = fileInfo.CreationTimeUtc,
                    HasHls = HasHlsGenerated(videoId),
                    HasDash = HasDashGenerated(videoId)
                };
            })
            .Where(item => item != null)
            .Cast<VideoListItem>()
            .OrderByDescending(item => item.CreatedAtUtc)
            .ToList();

        return Task.FromResult<IReadOnlyList<VideoListItem>>(videos);
    }

    public Task<bool> DeleteAsync(string videoId, CancellationToken cancellationToken = default) {
        var videoDir = Path.Combine(_environment.WebRootPath, "httprange", videoId);
        if (!Directory.Exists(videoDir)) {
            return Task.FromResult(false);
        }

        Directory.Delete(videoDir, true);

        var hlsDir = Path.Combine(_environment.WebRootPath, "hls", videoId);
        if (Directory.Exists(hlsDir)) {
            Directory.Delete(hlsDir, true);
        }

        var dashDir = Path.Combine(_environment.WebRootPath, "dash", videoId);
        if (Directory.Exists(dashDir)) {
            Directory.Delete(dashDir, true);
        }

        _logger.LogInformation("Video deleted: {VideoId}", videoId);
        return Task.FromResult(true);
    }

    public string? GetHlsManifestPath(string videoId) {
        var filePath = Path.Combine(_environment.WebRootPath, "hls", videoId, "master.m3u8");
        return File.Exists(filePath) ? filePath : null;
    }

    public string? GetHlsQualityPlaylistPath(string videoId, string quality) {
        var filePath = Path.Combine(_environment.WebRootPath, "hls", videoId, $"{quality}.m3u8");
        return File.Exists(filePath) ? filePath : null;
    }

    public string? GetHlsSegmentPath(string videoId, string segment) {
        if (!segment.EndsWith(".ts")) {
            return null;
        }

        var filePath = Path.Combine(_environment.WebRootPath, "hls", videoId, segment);
        return File.Exists(filePath) ? filePath : null;
    }

    public string? GetDashManifestPath(string videoId) {
        var filePath = Path.Combine(_environment.WebRootPath, "dash", videoId, "manifest.mpd");
        return File.Exists(filePath) ? filePath : null;
    }

    public string? GetDashSegmentPath(string videoId, string segment) {
        if (!segment.EndsWith(".m4s") && !segment.EndsWith(".mp4")) {
            return null;
        }

        var filePath = Path.Combine(_environment.WebRootPath, "dash", videoId, segment);
        return File.Exists(filePath) ? filePath : null;
    }

    public string GetHlsOutputDir(string videoId) {
        return Path.Combine(_environment.WebRootPath, "hls", videoId);
    }

    public string GetDashOutputDir(string videoId) {
        return Path.Combine(_environment.WebRootPath, "dash", videoId);
    }

    public void EnsureHlsOutputDir(string videoId) {
        Directory.CreateDirectory(GetHlsOutputDir(videoId));
    }

    public void EnsureDashOutputDir(string videoId) {
        Directory.CreateDirectory(GetDashOutputDir(videoId));
    }

    public bool HasHlsGenerated(string videoId) {
        return GetHlsManifestPath(videoId) != null;
    }

    public bool HasDashGenerated(string videoId) {
        return GetDashManifestPath(videoId) != null;
    }

    private static string SanitizeVideoId(string? videoId, string fileName) {
        if (string.IsNullOrWhiteSpace(videoId)) {
            videoId = Path.GetFileNameWithoutExtension(fileName);
            videoId = string.Join("_", videoId.Split(Path.GetInvalidFileNameChars()));
            return $"{videoId}_{DateTime.UtcNow:yyyyMMddHHmmss}";
        }

        return string.Join("_", videoId.Split(Path.GetInvalidFileNameChars()));
    }

    private static VideoUploadResult Fail(string errorCode, string message, string? videoId = null) {
        return new VideoUploadResult {
            Success = false,
            ErrorCode = errorCode,
            Message = message,
            VideoId = videoId
        };
    }
}
