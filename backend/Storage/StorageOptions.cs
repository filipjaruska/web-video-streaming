namespace WebWVideoStreamingAPI.Storage;

public class StorageOptions {
    public const string SectionName = "Storage";

    /// <summary>
    /// Absolute path to the media root. When empty, defaults to {ContentRoot}/App_Data/media.
    /// Override with env VIDEO_STORAGE_ROOT (e.g. /data/media on Railway).
    /// </summary>
    public string RootPath { get; set; } = string.Empty;
}
