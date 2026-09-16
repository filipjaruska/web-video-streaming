using System.Collections.Concurrent;
using System.Diagnostics;

namespace WebWVideoStreamingAPI.Api.Streaming;

/// <summary>A network a benchmark run is played under: a bandwidth cap and a round-trip delay.</summary>
public sealed record NetworkShape(long BitsPerSecond, int RoundTripMs);

/// <summary>
/// Holds the media a benchmark run fetches to the network profile the run names, so the profile in
/// the benchmark panel is applied rather than merely recorded.
/// </summary>
/// <remarks>
/// <para>
/// A run tags every request with its token and profile (<c>?bench=…&amp;net=threeG</c>). Each such
/// response starts one round trip late and its body is released at the profile's rate. The pacing is
/// shared by all requests carrying the same token, so an audio and a video segment fetched together
/// split the link between them the way they would on a real one, instead of each getting the full
/// rate. It applies alike to HLS, DASH and the progressive source, which all come from this API — the
/// protocols are compared under exactly the same conditions.
/// </para>
/// <para>
/// Packet loss is not emulated. An application can slow data down and delay it but cannot drop
/// packets, and real loss changes how TCP itself behaves. Without it the profiles are exact and
/// repeatable: the declared rate is the rate, with no external tool to configure — or misconfigure.
/// </para>
/// <para>
/// The table must match <c>NETWORK_PROFILE_RATE_BPS</c> and the labels in the frontend's
/// <c>lib/benchmark/types.ts</c>. A profile not listed here — the unshaped one — is served as is.
/// </para>
/// </remarks>
public sealed class NetworkShapingMiddleware {
    public const string RunParam = "bench";
    public const string ProfileParam = "net";

    private static readonly IReadOnlyDictionary<string, NetworkShape> Profiles =
        new Dictionary<string, NetworkShape>(StringComparer.OrdinalIgnoreCase) {
            // Carries the static top rung (7.8 Mb/s, peaks up to 1.5× that, plus audio) with margin.
            ["fourG"] = new(20_000_000, 40),
            // Below all but the three lowest rungs, so every adaptive rule has to adapt.
            ["threeG"] = new(2_000_000, 100),
        };

    private static readonly string[] ShapedPaths = ["/api/hls/", "/api/dash/", "/api/httprange/"];

    /// <summary>A run's link is forgotten once nothing has used it for this long.</summary>
    private static readonly TimeSpan IdleLinkLifetime = TimeSpan.FromMinutes(10);

    private readonly ConcurrentDictionary<string, SharedLink> _links = new();
    private readonly RequestDelegate _next;

    public NetworkShapingMiddleware(RequestDelegate next) {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context) {
        var shape = ResolveShape(context.Request, out var runToken);
        if (shape == null) {
            await _next(context);
            return;
        }

        try {
            // One round trip before the response starts: the request going out, the first byte back.
            await Task.Delay(shape.RoundTripMs, context.RequestAborted);
        } catch (OperationCanceledException) {
            return;
        }

        var link = _links.GetOrAdd(runToken, _ => new SharedLink());
        ForgetIdleLinks();

        var original = context.Response.Body;
        context.Response.Body = new ShapedStream(original, link, shape.BitsPerSecond / 8.0, context.RequestAborted);
        try {
            await _next(context);
        } finally {
            context.Response.Body = original;
        }
    }

    private static NetworkShape? ResolveShape(HttpRequest request, out string runToken) {
        runToken = request.Query[RunParam].ToString();
        if (runToken.Length == 0 ||
            !(HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)) ||
            !ShapedPaths.Any(path => request.Path.StartsWithSegments(path.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))) {
            return null;
        }

        return Profiles.GetValueOrDefault(request.Query[ProfileParam].ToString());
    }

    private void ForgetIdleLinks() {
        if (_links.Count < 32) {
            return;
        }

        foreach (var (token, link) in _links) {
            if (link.IdleFor() > IdleLinkLifetime) {
                _links.TryRemove(token, out _);
            }
        }
    }

    /// <summary>
    /// The link one run's requests share, as a schedule: each chunk is sent when the link would have
    /// finished transmitting everything queued before it. An idle link builds up no credit, so there
    /// are no bursts above the rate for a throughput estimate to be fooled by.
    /// </summary>
    private sealed class SharedLink {
        private readonly object _gate = new();
        private long _idleFrom = Stopwatch.GetTimestamp();
        private long _lastUsed = Stopwatch.GetTimestamp();

        /// <summary>How long to wait before sending <paramref name="bytes"/> at <paramref name="bytesPerSecond"/>.</summary>
        public TimeSpan Reserve(int bytes, double bytesPerSecond) {
            var now = Stopwatch.GetTimestamp();
            lock (_gate) {
                var start = Math.Max(now, _idleFrom);
                _idleFrom = start + (long)(bytes / bytesPerSecond * Stopwatch.Frequency);
                _lastUsed = now;
                return Stopwatch.GetElapsedTime(now, _idleFrom);
            }
        }

        public TimeSpan IdleFor() => Stopwatch.GetElapsedTime(Interlocked.Read(ref _lastUsed));
    }

    /// <summary>
    /// Response body that releases what is written to it in small chunks on the link's schedule,
    /// flushing each so it leaves when scheduled rather than when a buffer happens to fill. File
    /// results, range requests included, write through it once it replaces the response body.
    /// </summary>
    private sealed class ShapedStream : Stream {
        private const int ChunkBytes = 16 * 1024;

        private readonly Stream _inner;
        private readonly SharedLink _link;
        private readonly double _bytesPerSecond;
        private readonly CancellationToken _aborted;

        public ShapedStream(Stream inner, SharedLink link, double bytesPerSecond, CancellationToken aborted) {
            _inner = inner;
            _link = link;
            _bytesPerSecond = bytesPerSecond;
            _aborted = aborted;
        }

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();

        public override long Position {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public override async ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken cancellationToken = default) {
            for (var offset = 0; offset < buffer.Length; offset += ChunkBytes) {
                var chunk = buffer.Slice(offset, Math.Min(ChunkBytes, buffer.Length - offset));
                var wait = _link.Reserve(chunk.Length, _bytesPerSecond);
                if (wait > TimeSpan.Zero) {
                    await Task.Delay(wait, _aborted);
                }

                await _inner.WriteAsync(chunk, cancellationToken);
                await _inner.FlushAsync(cancellationToken);
            }
        }

        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) =>
            WriteAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        public override void Write(byte[] buffer, int offset, int count) =>
            WriteAsync(buffer, offset, count, CancellationToken.None).GetAwaiter().GetResult();

        public override Task FlushAsync(CancellationToken cancellationToken) => _inner.FlushAsync(cancellationToken);
        public override void Flush() => _inner.Flush();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
    }
}
