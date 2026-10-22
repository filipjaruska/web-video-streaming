using System.Collections.Concurrent;
using System.Diagnostics;

namespace WebWVideoStreamingAPI.Api.Streaming;

/// <summary>
/// A network a benchmark run is played under: a bandwidth cap, a round-trip delay and a packet loss
/// rate, in percent of packets.
/// </summary>
public sealed record NetworkShape(long BitsPerSecond, int RoundTripMs, double LossPercent);

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
/// The variable profile is a schedule, not a shape, and the server runs it: every chunk is sent at the
/// shape in force at the moment it goes out, timed from when the run started (see
/// <see cref="NetworkLinks.StartClock"/>). A change of network therefore reaches a segment already
/// downloading, and the progressive source — one long response for the whole run — as much as the
/// requests made after it.
/// </para>
/// <para>
/// Packet loss is emulated by its cost rather than by dropping anything: an application cannot drop
/// a TCP segment, and a dropped segment would be retransmitted by the kernel in any case. Each
/// response body is cut into maximum-segment-sized packets, and the configured share of them is
/// marked lost. A lost packet crosses the link twice, so the link is charged for it twice. TCP also
/// delivers in order, so the data behind a lost packet is held back until its retransmission lands one
/// round trip later — but the sender keeps transmitting meanwhile, so that wait delays the response
/// without idling the link. A profile therefore delivers its declared rate less only the retransmitted
/// share, which is what makes its label a description of the run.
/// </para>
/// <para>
/// What this leaves out is TCP's own reaction: a real sender halves its congestion window on loss
/// and climbs back slowly, so a real link delivers less under loss than this emulation does. The
/// throughput measured under a lossy profile is therefore an upper bound, and the profiles stay
/// exact and repeatable — the declared numbers are what every run gets, with no external tool to
/// configure, or misconfigure.
/// </para>
/// <para>
/// The table must match <c>NETWORK_PROFILE_RATE_BPS</c> and the labels in the frontend's
/// <c>lib/benchmark/types.ts</c>, and <see cref="VariableSchedule"/> its
/// <c>VARIABLE_NETWORK_SCHEDULE</c>. A profile not listed here — the unshaped one — is served as is.
/// </para>
/// </remarks>
public sealed class NetworkShapingMiddleware {
    public const string RunParam = "bench";
    public const string ProfileParam = "net";
    public const string VariableProfile = "variable";

    private static readonly IReadOnlyDictionary<string, NetworkShape> Shapes =
        new Dictionary<string, NetworkShape>(StringComparer.OrdinalIgnoreCase) {
            // Carries the static top rung (7.8 Mb/s, peaks up to 1.5× that, plus audio) with margin.
            ["fourG"] = new(20_000_000, 40, 1.0),
            // Below all but the three lowest rungs, so every adaptive rule has to adapt.
            ["threeG"] = new(2_000_000, 100, 5.0),
        };

    /// <summary>The variable profile's timeline, from the moment the run starts.</summary>
    private static readonly (TimeSpan From, string Profile)[] VariableSchedule = [
        (TimeSpan.Zero, "fourG"),
        (TimeSpan.FromSeconds(5), "threeG"),
        (TimeSpan.FromSeconds(18), "fourG"),
    ];

    private static readonly string[] ShapedPaths = ["/api/hls/", "/api/dash/", "/api/httprange/"];

    private readonly RequestDelegate _next;
    private readonly NetworkLinks _links;

    public NetworkShapingMiddleware(RequestDelegate next, NetworkLinks links) {
        _next = next;
        _links = links;
    }

    public async Task InvokeAsync(HttpContext context) {
        var profile = ResolveProfile(context.Request, out var runToken);
        if (profile == null) {
            await _next(context);
            return;
        }

        var link = _links.Get(runToken);

        try {
            // One round trip before the response starts: the request going out, the first byte back.
            await Task.Delay(link.ShapeNow(profile).RoundTripMs, context.RequestAborted);
        } catch (OperationCanceledException) {
            return;
        }

        var original = context.Response.Body;
        context.Response.Body = new ShapedStream(original, link, profile, context.RequestAborted);
        try {
            await _next(context);
        } finally {
            context.Response.Body = original;
        }
    }

    /// <summary>The shape a profile has <paramref name="sinceStart"/> into its run.</summary>
    internal static NetworkShape ShapeAt(string profile, TimeSpan sinceStart) {
        if (!string.Equals(profile, VariableProfile, StringComparison.OrdinalIgnoreCase)) {
            return Shapes[profile];
        }

        var current = VariableSchedule[0].Profile;
        foreach (var (from, phase) in VariableSchedule) {
            if (sinceStart >= from) {
                current = phase;
            }
        }

        return Shapes[current];
    }

    private static string? ResolveProfile(HttpRequest request, out string runToken) {
        runToken = request.Query[RunParam].ToString();
        if (runToken.Length == 0 ||
            !(HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)) ||
            !ShapedPaths.Any(path => request.Path.StartsWithSegments(path.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))) {
            return null;
        }

        var profile = request.Query[ProfileParam].ToString();
        return Shapes.ContainsKey(profile) || string.Equals(profile, VariableProfile, StringComparison.OrdinalIgnoreCase)
            ? profile
            : null;
    }

    /// <summary>
    /// Response body that releases what is written to it in small chunks on the link's schedule,
    /// flushing each so it leaves when scheduled rather than when a buffer happens to fill. File
    /// results, range requests included, write through it once it replaces the response body.
    /// </summary>
    private sealed class ShapedStream : Stream {
        private const int ChunkBytes = 16 * 1024;

        /// <summary>
        /// Waits shorter than this are not slept through. A sleep cannot be shorter than the platform's
        /// timer tick — about 15 ms on Windows — so sleeping for every chunk would hold a fast link far
        /// below its rate. The schedule is absolute, so a skipped wait is not lost: it is carried into
        /// the following chunks until it is worth sleeping, which makes the data leave in small bursts
        /// at the right average rate, as it would on a real link.
        /// </summary>
        private static readonly TimeSpan MinSleep = TimeSpan.FromMilliseconds(16);

        private readonly Stream _inner;
        private readonly NetworkLinks.SharedLink _link;
        private readonly string _profile;
        private readonly CancellationToken _aborted;

        /// <summary>When the link finished sending the previous chunk.</summary>
        private long _sentAt;

        /// <summary>When the latest lost packet's retransmission lands; nothing behind it is released before.</summary>
        private long _heldUntil;

        public ShapedStream(Stream inner, NetworkLinks.SharedLink link, string profile, CancellationToken aborted) {
            _inner = inner;
            _link = link;
            _profile = profile;
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

                // While a lost packet held this response back the sender kept transmitting it, so the
                // next chunk follows on from the previous one rather than from now.
                var continueFrom = _heldUntil > _sentAt ? _sentAt : long.MaxValue;
                var (sentAt, shape, lost) = _link.Send(chunk.Length, _profile, continueFrom);
                _sentAt = sentAt;

                if (lost > 0) {
                    _heldUntil = Math.Max(_heldUntil, sentAt + (long)(shape.RoundTripMs / 1000.0 * Stopwatch.Frequency));
                }

                var wait = Stopwatch.GetElapsedTime(Stopwatch.GetTimestamp(), Math.Max(_sentAt, _heldUntil));
                if (wait > MinSleep) {
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

/// <summary>
/// The shaped links of benchmark runs, one per run token. Shared between the shaping middleware,
/// which sends through them, and the benchmarks API, which starts a run's clock.
/// </summary>
public sealed class NetworkLinks {
    /// <summary>A run's link is forgotten once nothing has used it for this long.</summary>
    private static readonly TimeSpan IdleLinkLifetime = TimeSpan.FromMinutes(10);

    private readonly ConcurrentDictionary<string, SharedLink> _links = new();

    internal SharedLink Get(string runToken) {
        var link = _links.GetOrAdd(runToken, _ => new SharedLink());
        ForgetIdleLinks();
        return link;
    }

    /// <summary>
    /// Marks the moment a run starts, which the variable profile's schedule is timed from. Until it is
    /// called the clock runs from the run's first request.
    /// </summary>
    /// <remarks>
    /// The client's own record of each network change is timed from the same moment, so the two agree
    /// to within one request's latency. The first request is not a usable start on its own: the
    /// progressive source begins loading when the player mounts, before the run starts.
    /// </remarks>
    public void StartClock(string runToken) => Get(runToken).RestartClock();

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
    internal sealed class SharedLink {
        /// <summary>
        /// How far the schedule may lag real time and still be caught up on. A sleep overshoots its
        /// deadline by up to the platform's timer tick, and without catching that up a fast link drifts
        /// permanently behind its rate. The window is kept small — well under one segment of data — so
        /// the catch-up is a short burst rather than the credit an idle link would otherwise build up.
        /// </summary>
        private static readonly TimeSpan CatchUp = TimeSpan.FromMilliseconds(25);

        /// <summary>Ethernet's maximum segment size for IPv4 TCP — the unit loss is counted in.</summary>
        private const int PacketBytes = 1448;

        private readonly object _gate = new();
        private readonly Random _loss = new();
        private long _idleFrom = Stopwatch.GetTimestamp();
        private long _lastUsed = Stopwatch.GetTimestamp();
        private long _clockStart = Stopwatch.GetTimestamp();

        public void RestartClock() => Interlocked.Exchange(ref _clockStart, Stopwatch.GetTimestamp());

        /// <summary>The shape <paramref name="profile"/> has right now in this run.</summary>
        public NetworkShape ShapeNow(string profile) =>
            NetworkShapingMiddleware.ShapeAt(profile, Stopwatch.GetElapsedTime(Interlocked.Read(ref _clockStart)));

        /// <summary>
        /// Schedules <paramref name="bytes"/> on the link at the shape in force when they go out, lost
        /// packets sent twice. Returns when the link finishes sending them, the shape used and how many
        /// packets were lost.
        /// </summary>
        /// <param name="continueFrom">
        /// For a response that was held back while the link went on sending it: when its previous chunk
        /// finished, which this one follows on from even though that is more than <see cref="CatchUp"/> ago.
        /// </param>
        public (long SentAt, NetworkShape Shape, int Lost) Send(int bytes, string profile, long continueFrom) {
            var now = Stopwatch.GetTimestamp();
            lock (_gate) {
                var earliest = Math.Min(now - (long)(CatchUp.TotalSeconds * Stopwatch.Frequency), continueFrom);
                var start = Math.Max(earliest, _idleFrom);
                var shape = NetworkShapingMiddleware.ShapeAt(profile, Stopwatch.GetElapsedTime(_clockStart, start));

                var lost = CountLosses((bytes + PacketBytes - 1) / PacketBytes, shape.LossPercent);
                var bytesPerSecond = shape.BitsPerSecond / 8.0;
                _idleFrom = start + (long)((bytes + lost * PacketBytes) / bytesPerSecond * Stopwatch.Frequency);
                _lastUsed = now;
                return (_idleFrom, shape, lost);
            }
        }

        /// <summary>
        /// How many of <paramref name="packets"/> are lost at <paramref name="lossPercent"/>, drawn one
        /// packet at a time. Shared across the run's requests so the whole link loses at one rate.
        /// </summary>
        private int CountLosses(int packets, double lossPercent) {
            if (lossPercent <= 0) {
                return 0;
            }

            var probability = lossPercent / 100.0;
            var lost = 0;
            for (var i = 0; i < packets; i++) {
                if (_loss.NextDouble() < probability) {
                    lost++;
                }
            }

            return lost;
        }

        public TimeSpan IdleFor() => Stopwatch.GetElapsedTime(Interlocked.Read(ref _lastUsed));
    }
}
