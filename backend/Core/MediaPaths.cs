namespace WebWVideoStreamingAPI.Core;

/// <summary>
/// File-naming conventions shared by the producer (<see cref="Transcoder"/>, which passes these to
/// ffmpeg) and the consumers (<see cref="MediaPaths"/> when serving, the analysis collector when
/// reassembling renditions). Changing a name here changes it everywhere.
/// </summary>
public static class MediaNames {
    public const string SourceFile = "source.mp4";
    public const string Thumbnail = "thumb.webp";
    public const string LegacyThumbnail = "thumb.jpg";
    public const string HlsMaster = "master.m3u8";
    public const string DashManifest = "manifest.mpd";
    public const string SubsManifest = "manifest.json";

    /// <summary>The shared audio track, encoded once per video.</summary>
    public const string SharedAudio = "audio.mp4";

    public static string RenditionFile(string label) => $"{label}.mp4";

    public static string HlsPlaylist(string label) => $"{label}.m3u8";

    /// <summary>ffmpeg-side HLS templates — `%v` is expanded per variant stream by ffmpeg itself.</summary>
    public const string HlsVariantTemplate = "%v.m3u8";
    public const string HlsInitTemplate = "%v_init.mp4";
    public const string HlsSegmentTemplate = "%v_%03d.m4s";

    /// <summary>Name the audio rendition group's stream is given, and so the name of its playlist.</summary>
    public const string HlsAudioName = "audio";
    public const string HlsAudioPlaylist = "audio.m3u8";

    /// <summary>Reader-side equivalent of <see cref="HlsInitTemplate"/> for a known variant.</summary>
    public static string HlsInit(string label) => $"{label}_init.mp4";

    /// <summary>ffmpeg-side templates — `$RepresentationID$` is expanded by ffmpeg itself.</summary>
    public const string DashInitTemplate = "init-$RepresentationID$.m4s";
    public const string DashSegmentTemplate = "chunk-$RepresentationID$-$Number%05d$.m4s";

    /// <summary>Reader-side equivalents of the templates above, for a known representation id.</summary>
    public static string DashInit(string representationId) => $"init-{representationId}.m4s";
    public static string DashChunkGlob(string representationId) => $"chunk-{representationId}-*.m4s";
}

public sealed class StorageOptions {
    public const string SectionName = "Storage";

    /// <summary>
    /// Absolute path to the media root. Resolved at startup from env VIDEO_STORAGE_ROOT, then
    /// config, then {ContentRoot}/App_Data/media.
    /// </summary>
    public string RootPath { get; set; } = string.Empty;
}

public sealed class UploadOptions {
    public const string SectionName = "UploadSessions";

    /// <summary>Maximum accepted upload size in bytes. Also the Kestrel and form-body limit.</summary>
    public const long MaxBytes = 500L * 1024 * 1024;

    /// <summary>How long a session may sit in AwaitingUpload before it is reaped.</summary>
    public int AwaitingUploadTtlMinutes { get; set; } = 120;
}

/// <summary>
/// Every path under the media root. Pure path arithmetic plus existence checks — the `Get*` methods
/// build a path, the `Resolve*` methods return null when the file is not there.
/// </summary>
public sealed class MediaPaths {
    /// <summary>
    /// Segment files a packaged format may serve. HLS accepts <c>.ts</c> as well so runs packaged
    /// before the switch to fMP4 keep playing.
    /// </summary>
    private static readonly string[] HlsSegmentExtensions = [".ts", ".m4s", ".mp4"];
    private static readonly string[] DashSegmentExtensions = [".m4s", ".mp4"];

    private readonly string _root;
    private readonly ILogger<MediaPaths> _logger;

    public MediaPaths(IOptions<StorageOptions> options, ILogger<MediaPaths> logger) {
        _root = options.Value.RootPath;
        _logger = logger;
    }

    public string RootPath => _root;

    public string VideoRoot(string routeId) => Path.Combine(_root, Sanitize(routeId));

    public string SourceDir(string routeId) => Path.Combine(VideoRoot(routeId), "source");

    public string SourceFile(string routeId) => Path.Combine(SourceDir(routeId), MediaNames.SourceFile);

    public string ThumbnailFile(string routeId) => Path.Combine(SourceDir(routeId), MediaNames.Thumbnail);

    public string LegacyThumbnailFile(string routeId) => Path.Combine(SourceDir(routeId), MediaNames.LegacyThumbnail);

    /// <summary>Artefacts shared by every ladder of one video — the audio track.</summary>
    public string SharedDir(string routeId) => Path.Combine(VideoRoot(routeId), "shared");

    public string SharedAudioFile(string routeId) => Path.Combine(SharedDir(routeId), MediaNames.SharedAudio);

    public string TranscodeDir(string routeId, Guid transcodeId) =>
        Path.Combine(VideoRoot(routeId), transcodeId.ToString("N"));

    /// <summary>The encoded rungs of one packaging run — the exact bitstreams HLS and DASH carry.</summary>
    public string RenditionsDir(string routeId, Guid transcodeId) =>
        Path.Combine(TranscodeDir(routeId, transcodeId), "renditions");

    public string RenditionFile(string routeId, Guid transcodeId, string label) =>
        Path.Combine(RenditionsDir(routeId, transcodeId), MediaNames.RenditionFile(label));

    /// <summary>Scratch space for the 2-pass statistics of every rung; removed once the ladder is encoded.</summary>
    public string WorkRoot(string routeId, Guid transcodeId) =>
        Path.Combine(TranscodeDir(routeId, transcodeId), "work");

    public string WorkDir(string routeId, Guid transcodeId, string label) =>
        Path.Combine(WorkRoot(routeId, transcodeId), label);

    public string HlsDir(string routeId, Guid transcodeId) =>
        Path.Combine(TranscodeDir(routeId, transcodeId), "hls");

    public string DashDir(string routeId, Guid transcodeId) =>
        Path.Combine(TranscodeDir(routeId, transcodeId), "dash");

    public string SubsDir(string routeId) => Path.Combine(VideoRoot(routeId), "subs");

    public string SubsManifestFile(string routeId) => Path.Combine(SubsDir(routeId), MediaNames.SubsManifest);

    public string? ResolveSource(string routeId) => Existing(SourceFile(routeId));

    public string? ResolveSubsManifest(string routeId) => Existing(SubsManifestFile(routeId));

    public string? ResolveThumbnail(string routeId) =>
        Existing(ThumbnailFile(routeId)) ?? Existing(LegacyThumbnailFile(routeId));

    public string? ResolveHlsManifest(string routeId, Guid transcodeId) =>
        Existing(Path.Combine(HlsDir(routeId, transcodeId), MediaNames.HlsMaster));

    public string? ResolveHlsPlaylist(string routeId, Guid transcodeId, string quality) =>
        ResolveWithin(HlsDir(routeId, transcodeId), MediaNames.HlsPlaylist(quality), [".m3u8"]);

    public string? ResolveHlsSegment(string routeId, Guid transcodeId, string segment) =>
        ResolveWithin(HlsDir(routeId, transcodeId), segment, HlsSegmentExtensions);

    public string? ResolveDashManifest(string routeId, Guid transcodeId) =>
        Existing(Path.Combine(DashDir(routeId, transcodeId), MediaNames.DashManifest));

    public string? ResolveDashSegment(string routeId, Guid transcodeId, string segment) =>
        ResolveWithin(DashDir(routeId, transcodeId), segment, DashSegmentExtensions);

    /// <summary>Resolves a subtitle side-car, rejecting anything that escapes the subs directory.</summary>
    public string? ResolveSubtitle(string routeId, string fileName) =>
        ResolveWithin(SubsDir(routeId), fileName, [".vtt"]);

    public static bool IsHlsSegmentName(string name) => HasExtension(name, HlsSegmentExtensions);

    public static bool IsDashSegmentName(string name) => HasExtension(name, DashSegmentExtensions);

    /// <summary>
    /// A file inside <paramref name="directory"/>, or null. Rejects separators and <c>..</c> outright
    /// and then checks the resolved path is still inside the directory — on Windows an encoded
    /// backslash in a URL segment is a path separator, so extension checks alone are not enough.
    /// </summary>
    private static string? ResolveWithin(string directory, string fileName, string[] extensions) {
        if (string.IsNullOrWhiteSpace(fileName) ||
            fileName.Contains('/') ||
            fileName.Contains('\\') ||
            fileName.Contains("..", StringComparison.Ordinal) ||
            !HasExtension(fileName, extensions)) {
            return null;
        }

        var root = Path.GetFullPath(directory);
        var fullPath = Path.GetFullPath(Path.Combine(directory, fileName));
        var rootWithSeparator = root.EndsWith(Path.DirectorySeparatorChar) ? root : root + Path.DirectorySeparatorChar;
        if (!fullPath.StartsWith(rootWithSeparator, StringComparison.OrdinalIgnoreCase)) {
            return null;
        }

        return Existing(fullPath);
    }

    private static bool HasExtension(string name, string[] extensions) =>
        extensions.Any(extension => name.EndsWith(extension, StringComparison.OrdinalIgnoreCase));

    public void EnsureSourceDir(string routeId) => Directory.CreateDirectory(SourceDir(routeId));

    public void EnsureHlsDir(string routeId, Guid transcodeId) => Directory.CreateDirectory(HlsDir(routeId, transcodeId));

    public void EnsureDashDir(string routeId, Guid transcodeId) => Directory.CreateDirectory(DashDir(routeId, transcodeId));

    public void EnsureSubsDir(string routeId) => Directory.CreateDirectory(SubsDir(routeId));

    public async Task SaveSourceAsync(string routeId, Stream content, CancellationToken cancellationToken = default) {
        EnsureSourceDir(routeId);
        var filePath = SourceFile(routeId);
        await using var stream = new FileStream(filePath, FileMode.Create, FileAccess.Write, FileShare.None);
        await content.CopyToAsync(stream, cancellationToken);
        _logger.LogInformation("Saved source for {RouteId} to {Path}", routeId, filePath);
    }

    public bool DeleteVideoTree(string routeId) {
        var videoRoot = VideoRoot(routeId);
        if (!Directory.Exists(videoRoot)) {
            return false;
        }

        Directory.Delete(videoRoot, recursive: true);
        _logger.LogInformation("Deleted video tree for {RouteId}", routeId);
        return true;
    }

    private static string? Existing(string path) => File.Exists(path) ? path : null;

    private static string Sanitize(string segment) =>
        string.Join("_", segment.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
}
