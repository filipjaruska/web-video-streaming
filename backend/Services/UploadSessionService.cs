using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Services;

public interface IUploadSessionService {
    Task<UploadSession> CreateSessionAsync(CancellationToken cancellationToken = default);
    Task<UploadSession?> GetSessionAsync(Guid sessionId, CancellationToken cancellationToken = default);
    Task<UploadSession?> UpdateVideoMetadataAsync(Guid sessionId, string? title, string? description, CancellationToken cancellationToken = default);
}

public class UploadSessionService : IUploadSessionService {
    private readonly AppDbContext _dbContext;
    private readonly ILogger<UploadSessionService> _logger;
    private readonly TimeSpan _awaitingUploadTtl;

    public UploadSessionService(AppDbContext dbContext, ILogger<UploadSessionService> logger, IConfiguration configuration) {
        _dbContext = dbContext;
        _logger = logger;

        var ttlMinutes = configuration.GetValue<int?>("UploadSessions:AwaitingUploadTtlMinutes") ?? 120;
        _awaitingUploadTtl = TimeSpan.FromMinutes(Math.Max(ttlMinutes, 1));
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

        _logger.LogInformation("Created upload session {SessionId} for draft video {VideoId}", session.Id, video.Id);
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
}
