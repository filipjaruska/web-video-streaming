using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace WebWVideoStreamingAPI.Api.Benchmarks;

public sealed class SubmitBenchmarkRequest {
    public string? RouteId { get; set; }
    public string? TranscodeId { get; set; }
    public string? Mode { get; set; }
    public string? NetworkProfile { get; set; }
    public string? LadderKind { get; set; }
    public string? Protocol { get; set; }
    public string? AbrAlgorithm { get; set; }
    public int? Repetition { get; set; }
    public double? StartupMs { get; set; }
    public double? BufferingRatio { get; set; }
    public int? RebufferCount { get; set; }
    public double? RebufferMs { get; set; }
    public int? QualitySwitches { get; set; }
    public int? Oscillations { get; set; }
    public double? TimeWeightedBitrateBps { get; set; }
    public double? DroppedFrameRatio { get; set; }
    public double? RecoveryMs { get; set; }
    public bool? Failed { get; set; }
    public string? ErrorMessage { get; set; }

    /// <summary>Samples and event log, stored verbatim as one document.</summary>
    public JsonElement? Trace { get; set; }
}

[ApiController]
[Route("api/benchmarks")]
public class BenchmarksController : ControllerBase {
    private readonly PlaybackBenchmarkStore _benchmarks;

    public BenchmarksController(PlaybackBenchmarkStore benchmarks) {
        _benchmarks = benchmarks;
    }

    [HttpPost]
    [ProducesResponseType<BenchmarkRunDto>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Submit(
        [FromBody] SubmitBenchmarkRequest request,
        CancellationToken cancellationToken) {
        if (string.IsNullOrWhiteSpace(request.RouteId)) {
            return BadRequest(new { message = "routeId is required" });
        }

        var benchmark = new PlaybackBenchmark {
            TranscodeId = Guid.TryParse(request.TranscodeId, out var transcodeId) ? transcodeId : null,
            Mode = ParseEnum(request.Mode, BenchmarkMode.Matrix),
            NetworkProfile = ParseEnum(request.NetworkProfile, Data.NetworkProfile.Standard),
            LadderKind = request.LadderKind ?? "",
            Protocol = request.Protocol ?? "",
            AbrAlgorithm = request.AbrAlgorithm ?? "",
            Repetition = request.Repetition ?? 1,
            StartupMs = request.StartupMs,
            BufferingRatio = request.BufferingRatio ?? 0,
            RebufferCount = request.RebufferCount ?? 0,
            RebufferMs = request.RebufferMs ?? 0,
            QualitySwitches = request.QualitySwitches ?? 0,
            Oscillations = request.Oscillations ?? 0,
            TimeWeightedBitrateBps = request.TimeWeightedBitrateBps ?? 0,
            DroppedFrameRatio = request.DroppedFrameRatio ?? 0,
            RecoveryMs = request.RecoveryMs,
            Failed = request.Failed ?? false,
            ErrorMessage = request.ErrorMessage,
            TraceJson = request.Trace is { } trace
                ? JsonSerializer.Serialize(trace, BenchmarkSchema.Json)
                : null
        };

        var result = await _benchmarks.SaveAsync(request.RouteId, benchmark, cancellationToken);
        if (!result.Success) {
            return result.ErrorCode switch {
                "NotFound" => NotFound(new { message = result.Message }),
                _ => BadRequest(new { message = result.Message })
            };
        }

        return StatusCode(StatusCodes.Status201Created, new { id = result.Benchmark!.Id.ToString("N") });
    }

    /// <summary>Enum values arrive as client strings, so an unknown one falls back rather than throwing.</summary>
    private static TEnum ParseEnum<TEnum>(string? value, TEnum fallback) where TEnum : struct, Enum =>
        Enum.TryParse<TEnum>(value, ignoreCase: true, out var parsed) ? parsed : fallback;
}
