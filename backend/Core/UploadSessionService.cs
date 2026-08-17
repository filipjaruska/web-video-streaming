using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Analysis;

namespace WebWVideoStreamingAPI.Core;

public sealed class SessionUploadResult {
    public bool Success { get; init; }
    public string? ErrorCode { get; init; }
    public string? Message { get; init; }
    public string[]? AllowedExtensions { get; init; }
    public UploadSession? Session { get; init; }
    public Guid? VideoId { get; init; }
}

public sealed class UploadSessionService {
    private static readonly string[] AllowedExtensions = [".mp4", ".mov", ".avi", ".mkv", ".webm"];

    private readonly AppDbContext _dbContext;
    private readonly MediaPaths _paths;
    private readonly AnalysisStore _analysis;
    private readonly ILogger<UploadSessionService> _logger;
    private readonly TimeSpan _awaitingUploadTtl;

    public UploadSessionService(
        AppDbContext dbContext,
        MediaPaths paths,
        AnalysisStore analysis,
        IOptions<UploadOptions> options,
        ILogger<UploadSessionService> logger) {
        _dbContext = dbContext;
        _paths = paths;
        _analysis = analysis;
        _logger = logger;
        _awaitingUploadTtl = TimeSpan.FromMinutes(Math.Max(options.Value.AwaitingUploadTtlMinutes, 1));
    }

    public async Task<UploadSession> CreateSessionAsync(CancellationToken cancellationToken = default) {
        await ExpireAbandonedSessionsAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var video = new Video {
            Id = Guid.NewGuid(),
            RouteId = await GenerateUniqueRouteIdAsync(cancellationToken),
            CreatedAtUtc = now,
            UpdatedAtUtc = now
        };

        var session = new UploadSession {
            Id = Guid.NewGuid(),
            VideoId = video.Id,
            Video = video,
            Status = UploadSessionStatus.AwaitingUpload,
            ProgressPercent = 0,
            CreatedAtUtc = now,
            UpdatedAtUtc = now,
            ExpiresAtUtc = now.Add(_awaitingUploadTtl)
        };

        _dbContext.Videos.Add(video);
        _dbContext.UploadSessions.Add(session);
        await _dbContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation(
            "Created upload session {SessionId} for draft video {VideoId} ({RouteId})",
            session.Id,
            video.Id,
            video.RouteId);
        return session;
    }

    public async Task<UploadSession?> GetSessionAsync(Guid sessionId, CancellationToken cancellationToken = default) {
        await ExpireAbandonedSessionsAsync(cancellationToken);
        return await FindLiveSessionAsync(sessionId, cancellationToken);
    }

    public async Task<UploadSession?> UpdateVideoMetadataAsync(
        Guid sessionId,
        string? title,
        string? description,
        CancellationToken cancellationToken = default) {
        await ExpireAbandonedSessionsAsync(cancellationToken);

        var session = await FindLiveSessionAsync(sessionId, cancellationToken);
        if (session == null) {
            return null;
        }

        var now = DateTime.UtcNow;
        session.Video.Title = Trim(title, 200);
        session.Video.Description = Trim(description, 4000);
        session.Video.UpdatedAtUtc = now;
        session.UpdatedAtUtc = now;

        await _dbContext.SaveChangesAsync(cancellationToken);
        return session;
    }

    public async Task<SessionUploadResult> UploadFileAsync(
        Guid sessionId,
        Stream content,
        string fileName,
        long fileSize,
        string? contentType,
        CancellationToken cancellationToken = default) {
        await ExpireAbandonedSessionsAsync(cancellationToken);

        var session = await FindLiveSessionAsync(sessionId, cancellationToken);
        if (session == null) {
            return Fail("NotFound", "Upload session not found");
        }

        if (session.Status is not (UploadSessionStatus.AwaitingUpload or UploadSessionStatus.Failed)) {
            return Fail("InvalidState", $"Session cannot accept uploads in status {session.Status}", session);
        }

        if (fileSize == 0) {
            return Fail("NoFile", "No file uploaded", session);
        }

        if (fileSize > UploadOptions.MaxBytes) {
            return Fail(
                "TooLarge",
                $"File size exceeds maximum limit of {UploadOptions.MaxBytes / (1024 * 1024)} MB",
                session);
        }

        if (!AllowedExtensions.Contains(Path.GetExtension(fileName).ToLowerInvariant())) {
            return new SessionUploadResult {
                Success = false,
                ErrorCode = "InvalidType",
                Message = "Invalid file type",
                AllowedExtensions = AllowedExtensions,
                Session = session
            };
        }

        session.Status = UploadSessionStatus.Uploading;
        session.ProgressPercent = 5;
        session.CurrentStep = "Uploading file";
        session.UpdatedAtUtc = DateTime.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);

        try {
            await _paths.SaveSourceAsync(session.Video.RouteId, content, cancellationToken);

            var uploadedAt = DateTime.UtcNow;
            session.Status = UploadSessionStatus.Processing;
            session.ProgressPercent = ProcessingEta.PercentFor(PipelineStep.Starting);
            session.CurrentStep = "Queued for processing";
            session.UploadedAtUtc = uploadedAt;
            session.UpdatedAtUtc = uploadedAt;
            session.Video.OriginalFileName = Path.GetFileName(fileName);
            session.Video.SourceContentType = string.IsNullOrWhiteSpace(contentType) ? "video/mp4" : contentType;
            session.Video.SourceSizeBytes = fileSize;
            session.Video.PublishedAtUtc = uploadedAt;
            session.Video.UpdatedAtUtc = uploadedAt;

            await _dbContext.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Uploaded source for session {SessionId} route {RouteId} ({Size} bytes)",
                session.Id,
                session.Video.RouteId,
                fileSize);

            return new SessionUploadResult {
                Success = true,
                Session = session,
                VideoId = session.Video.Id
            };
        } catch (Exception ex) {
            _logger.LogError(ex, "Upload failed for session {SessionId}", sessionId);
            session.Status = UploadSessionStatus.Failed;
            session.CurrentStep = null;
            session.EstimatedRemainingSeconds = null;
            session.UpdatedAtUtc = DateTime.UtcNow;
            await _dbContext.SaveChangesAsync(cancellationToken);
            return Fail("UploadFailed", ex.Message, session);
        }
    }

    private Task<UploadSession?> FindLiveSessionAsync(Guid sessionId, CancellationToken cancellationToken) {
        return _dbContext.UploadSessions
            .Include(session => session.Video)
            .FirstOrDefaultAsync(
                session => session.Id == sessionId && session.Status != UploadSessionStatus.Expired,
                cancellationToken);
    }

    /// <summary>Reaps sessions that were created but never uploaded to, deleting their draft video.</summary>
    private async Task ExpireAbandonedSessionsAsync(CancellationToken cancellationToken) {
        var now = DateTime.UtcNow;
        var stale = await _dbContext.UploadSessions
            .Include(session => session.Video)
            .Where(session =>
                session.Status == UploadSessionStatus.AwaitingUpload &&
                session.ExpiresAtUtc <= now)
            .ToListAsync(cancellationToken);

        if (stale.Count == 0) {
            return;
        }

        foreach (var session in stale) {
            _paths.DeleteVideoTree(session.Video.RouteId);
        }

        // Analysis reports have no FK, so they are removed explicitly before the cascade. A draft
        // that was never uploaded to should have none, but a crashed run could have left one.
        await _analysis.DeleteForVideosAsync(
            stale.Select(session => session.VideoId),
            [],
            cancellationToken);

        _dbContext.UploadSessions.RemoveRange(stale);
        _dbContext.Videos.RemoveRange(stale.Select(session => session.Video));
        await _dbContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Expired {Count} abandoned upload sessions", stale.Count);
    }

    private async Task<string> GenerateUniqueRouteIdAsync(CancellationToken cancellationToken) {
        for (var attempt = 0; attempt < 10; attempt++) {
            var candidate = CreateRouteId();
            if (!await _dbContext.Videos.AnyAsync(video => video.RouteId == candidate, cancellationToken)) {
                return candidate;
            }
        }

        throw new InvalidOperationException("Failed to generate a unique video route ID.");
    }

    /// <summary>11-character URL-safe base64 id, the shape route ids have always had.</summary>
    private static string CreateRouteId() {
        Span<byte> bytes = stackalloc byte[8];
        RandomNumberGenerator.Fill(bytes);

        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    private static string? Trim(string? value, int maxLength) {
        if (string.IsNullOrWhiteSpace(value)) {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    private static SessionUploadResult Fail(string errorCode, string message, UploadSession? session = null) {
        return new SessionUploadResult {
            Success = false,
            ErrorCode = errorCode,
            Message = message,
            Session = session
        };
    }
}
