namespace WebWVideoStreamingAPI.Services;

public record TranscodeVariant(string Resolution, string Bitrate, string Label);

public class TranscodeProfile {
    public string Name { get; init; } = "default";
    public IReadOnlyList<TranscodeVariant> Variants { get; init; } = Array.Empty<TranscodeVariant>();
    public string VideoCodec { get; init; } = "libx264";
    public string AudioCodec { get; init; } = "aac";
    public string AudioBitrate { get; init; } = "128k";
    public int SegmentDurationSeconds { get; init; } = 6;

    public static TranscodeProfile Default { get; } = new() {
        Name = "default",
        Variants = new[] {
            new TranscodeVariant("1920:1080", "5000k", "1080p"),
            new TranscodeVariant("640:360", "800k", "360p")
        }
    };

    public static int ParseBitrateKbps(string bitrate) =>
        int.Parse(bitrate.TrimEnd('k', 'K'));
}
