using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Core;

public sealed class SessionUploadResult {
    public bool Success { get; init; }
    public string? ErrorCode { get; init; }
    public string? Message { get; init; }
    public string[]? AllowedExtensions { get; init; }
    public UploadSession? Session { get; init; }
    public Guid? VideoId { get; init; }
}

public interface IUploadSessionService {
    Task<UploadSession> CreateSessionAsync(CancellationToken cancellationToken = default);
    Task<UploadSession?> GetSessionAsync(Guid sessionId, CancellationToken cancellationToken = default);
    Task<UploadSession?> UpdateVideoMetadataAsync(Guid sessionId, string? title, string? description, CancellationToken cancellationToken = default);
    Task<SessionUploadResult> UploadFileAsync(
        Guid sessionId,
        Stream content,
        string fileName,
        long fileSize,
        string? contentType,
        CancellationToken cancellationToken = default);
}

public class UploadSessionService : IUploadSessionService {
    private const long MaxFileSize = 500 * 1024 * 1024;
    private static readonly string[] AllowedExtensions = { ".mp4", ".mov", ".avi", ".mkv", ".webm" };

    private readonly AppDbContext _dbContext;
    private readonly IVideoStorageService _storage;
    private readonly ILogger<UploadSessionService> _logger;
    private readonly TimeSpan _awaitingUploadTtl;

    public UploadSessionService(
        AppDbContext dbContext,
        IVideoStorageService storage,
        ILogger<UploadSessionService> logger,
        IConfiguration configuration) {
        _dbContext = dbContext;
        _storage = storage;
        _logger = logger;

        var ttlMinutes = configuration.GetValue<int?>("UploadSessions:AwaitingUploadTtlMinutes") ?? 120;
        _awaitingUploadTtl = TimeSpan.FromMinutes(Math.Max(ttlMinutes, 1));
    }

    public async Task<UploadSession> CreateSessionAsync(CancellationToken cancellationToken = default) {
        await ExpireAbandonedSessionsAsync(cancellationToken);

        var now = DateTime.UtcNow;
        var routeId = await GenerateUniqueRouteIdAsync(cancellationToken);
        var video = new Video {
            Id = Guid.NewGuid(),
            RouteId = routeId,
            StorageKey = routeId,
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

        _logger.LogInformation("Created upload session {SessionId} for draft video {VideoId} ({RouteId})", session.Id, video.Id, routeId);
        return session;
    }

    public async Task<UploadSession?> GetSessionAsync(Guid sessionId, CancellationToken cancellationToken = default) {
        await ExpireAbandonedSessionsAsync(cancellationToken);

        return await _dbContext.UploadSessions
            .Include(session => session.Video)
            .FirstOrDefaultAsync(session => session.Id == sessionId && session.Status != UploadSessionStatus.Expired, cancellationToken);
    }

    public async Task<UploadSession?> UpdateVideoMetadataAsync(Guid sessionId, string? title, string? description, CancellationToken cancellationToken = default) {
        await ExpireAbandonedSessionsAsync(cancellationToken);

        var session = await _dbContext.UploadSessions
            .Include(existingSession => existingSession.Video)
            .FirstOrDefaultAsync(existingSession => existingSession.Id == sessionId && existingSession.Status != UploadSessionStatus.Expired, cancellationToken);

        if (session == null) {
            return null;
        }

        session.Video.Title = Normalize(title, 200);
        session.Video.Description = Normalize(description, 4000);
        session.Video.UpdatedAtUtc = DateTime.UtcNow;
        session.UpdatedAtUtc = DateTime.UtcNow;

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

        var session = await _dbContext.UploadSessions
            .Include(item => item.Video)
            .FirstOrDefaultAsync(item => item.Id == sessionId && item.Status != UploadSessionStatus.Expired, cancellationToken);

        if (session == null) {
            return Fail("NotFound", "Upload session not found");
        }

        if (session.Status is not (UploadSessionStatus.AwaitingUpload or UploadSessionStatus.Failed)) {
            return Fail("InvalidState", $"Session cannot accept uploads in status {session.Status}", session);
        }

        if (fileSize == 0) {
            return Fail("NoFile", "No file uploaded", session);
        }

        if (fileSize > MaxFileSize) {
            return Fail("TooLarge", $"File size exceeds maximum limit of {MaxFileSize / (1024 * 1024)} MB", session);
        }

        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        if (!AllowedExtensions.Contains(extension)) {
            return new SessionUploadResult {
                Success = false,
                ErrorCode = "InvalidType",
                Message = "Invalid file type",
                AllowedExtensions = AllowedExtensions,
                Session = session
            };
        }

        var now = DateTime.UtcNow;
        session.Status = UploadSessionStatus.Uploading;
        session.ProgressPercent = 5;
        session.CurrentStep = "Uploading file";
        session.UpdatedAtUtc = now;
        await _dbContext.SaveChangesAsync(cancellationToken);

        try {
            await _storage.SaveSourceAsync(session.Video.RouteId, content, cancellationToken);

            var uploadedAt = DateTime.UtcNow;
            session.Status = UploadSessionStatus.Processing;
            session.ProgressPercent = 8;
            session.CurrentStep = "Queued for processing";
            session.UploadedAtUtc = uploadedAt;
            session.UpdatedAtUtc = uploadedAt;
            session.Video.OriginalFileName = Path.GetFileName(fileName);
            session.Video.StorageKey = session.Video.RouteId;
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

    private async Task ExpireAbandonedSessionsAsync(CancellationToken cancellationToken) {
        var now = DateTime.UtcNow;
        var staleSessions = await _dbContext.UploadSessions
            .Include(session => session.Video)
            .Where(session =>
                session.Status == UploadSessionStatus.AwaitingUpload &&
                session.ExpiresAtUtc <= now)
            .ToListAsync(cancellationToken);

        if (staleSessions.Count == 0) {
            return;
        }

        foreach (var session in staleSessions) {
            session.Status = UploadSessionStatus.Expired;
            session.UpdatedAtUtc = now;
            _storage.DeleteVideoTree(session.Video.RouteId);
        }

        _dbContext.UploadSessions.RemoveRange(staleSessions);
        _dbContext.Videos.RemoveRange(staleSessions.Select(session => session.Video));

        await _dbContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Expired {Count} abandoned upload sessions", staleSessions.Count);
    }

    private static string? Normalize(string? value, int maxLength) {
        if (string.IsNullOrWhiteSpace(value)) {
            return null;
        }

        var normalized = value.Trim();
        return normalized.Length <= maxLength ? normalized : normalized[..maxLength];
    }

    private async Task<string> GenerateUniqueRouteIdAsync(CancellationToken cancellationToken) {
        for (var attempt = 0; attempt < 10; attempt++) {
            var candidate = CreateRouteId();
            var exists = await _dbContext.Videos.AnyAsync(video => video.RouteId == candidate, cancellationToken);
            if (!exists) {
                return candidate;
            }
        }

        throw new InvalidOperationException("Failed to generate a unique video route ID.");
    }

    private static string CreateRouteId() {
        Span<byte> bytes = stackalloc byte[8];
        RandomNumberGenerator.Fill(bytes);

        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
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
