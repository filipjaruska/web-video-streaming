using Microsoft.AspNetCore.Mvc;

namespace WebWVideoStreamingAPI.Api.UploadSessions;

public sealed class UpdateUploadSessionVideoRequest {
    public string? Title { get; set; }
    public string? Description { get; set; }
}

public sealed class UploadSessionStateDto {
    /// <summary>PascalCase enum name — the frontend compares these literally.</summary>
    public required string Status { get; init; }

    public int ProgressPercent { get; init; }
    public string? CurrentStep { get; init; }
    public DateTime CreatedAtUtc { get; init; }
    public DateTime UpdatedAtUtc { get; init; }
    public DateTime ExpiresAtUtc { get; init; }
    public DateTime? UploadedAtUtc { get; init; }
    public DateTime? CompletedAtUtc { get; init; }
    public DateTime? ProcessingStartedAtUtc { get; init; }
    public int? EstimatedRemainingSeconds { get; init; }
}

public sealed class UploadSessionVideoDto {
    public required string RouteId { get; init; }
    public string? Title { get; init; }
    public string? Description { get; init; }
    public string? ThumbnailUrl { get; init; }
    public string? OriginalFileName { get; init; }
    public string? StorageKey { get; init; }
    public DateTime CreatedAtUtc { get; init; }
    public DateTime UpdatedAtUtc { get; init; }
    public DateTime? PublishedAtUtc { get; init; }
}

public sealed class UploadSessionResponse {
    public Guid SessionId { get; init; }
    public required string RedirectUrl { get; init; }
    public required UploadSessionStateDto Session { get; init; }
    public required UploadSessionVideoDto Video { get; init; }
}

[ApiController]
[Route("api/uploadSessions")]
public class UploadSessionsController : ControllerBase {
    private readonly UploadSessionService _sessions;
    private readonly ProcessingQueue _queue;

    public UploadSessionsController(UploadSessionService sessions, ProcessingQueue queue) {
        _sessions = sessions;
        _queue = queue;
    }

    [HttpPost]
    [ProducesResponseType<UploadSessionResponse>(StatusCodes.Status201Created)]
    public async Task<IActionResult> CreateSession(CancellationToken cancellationToken) {
        var session = await _sessions.CreateSessionAsync(cancellationToken);
        return CreatedAtAction(nameof(GetSession), new { sessionId = session.Id }, ToResponse(session));
    }

    [HttpGet("{sessionId:guid}")]
    [ProducesResponseType<UploadSessionResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetSession(Guid sessionId, CancellationToken cancellationToken) {
        var session = await _sessions.GetSessionAsync(sessionId, cancellationToken);
        return session == null
            ? NotFound(new { message = "Upload session not found" })
            : Ok(ToResponse(session));
    }

    [HttpPatch("{sessionId:guid}/video")]
    [ProducesResponseType<UploadSessionResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateVideo(
        Guid sessionId,
        [FromBody] UpdateUploadSessionVideoRequest request,
        CancellationToken cancellationToken) {
        var session = await _sessions.UpdateVideoMetadataAsync(
            sessionId,
            request.Title,
            request.Description,
            cancellationToken);

        return session == null
            ? NotFound(new { message = "Upload session not found" })
            : Ok(ToResponse(session));
    }

    [HttpPost("{sessionId:guid}/upload")]
    [ProducesResponseType<UploadSessionResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
    [RequestSizeLimit(UploadOptions.MaxBytes)]
    public async Task<IActionResult> UploadFile(Guid sessionId, IFormFile file, CancellationToken cancellationToken) {
        if (file == null) {
            return BadRequest(new { message = "No file uploaded" });
        }

        await using var stream = file.OpenReadStream();
        var result = await _sessions.UploadFileAsync(
            sessionId,
            stream,
            file.FileName,
            file.Length,
            file.ContentType,
            cancellationToken);

        if (!result.Success) {
            return result.ErrorCode switch {
                "NotFound" => NotFound(new { message = result.Message }),
                "TooLarge" => StatusCode(StatusCodes.Status413PayloadTooLarge, new { message = result.Message }),
                "InvalidType" => BadRequest(new { message = result.Message, allowedTypes = result.AllowedExtensions }),
                _ => BadRequest(new { message = result.Message })
            };
        }

        if (result.VideoId.HasValue) {
            _queue.Enqueue(result.VideoId.Value);
        }

        return Ok(ToResponse(result.Session!));
    }

    private static UploadSessionResponse ToResponse(UploadSession session) {
        return new UploadSessionResponse {
            SessionId = session.Id,
            RedirectUrl = $"/upload/{session.Id}",
            Session = new UploadSessionStateDto {
                Status = session.Status.ToString(),
                ProgressPercent = session.ProgressPercent,
                CurrentStep = session.CurrentStep,
                CreatedAtUtc = session.CreatedAtUtc,
                UpdatedAtUtc = session.UpdatedAtUtc,
                ExpiresAtUtc = session.ExpiresAtUtc,
                UploadedAtUtc = session.UploadedAtUtc,
                CompletedAtUtc = session.CompletedAtUtc,
                ProcessingStartedAtUtc = session.ProcessingStartedAtUtc,
                EstimatedRemainingSeconds = session.EstimatedRemainingSeconds
            },
            Video = new UploadSessionVideoDto {
                RouteId = session.Video.RouteId,
                Title = session.Video.Title,
                Description = session.Video.Description,
                ThumbnailUrl = session.Video.ThumbnailUrl,
                OriginalFileName = session.Video.OriginalFileName,
                // Always equal to the route id; kept on the wire for the frontend's existing shape.
                StorageKey = session.Video.RouteId,
                CreatedAtUtc = session.Video.CreatedAtUtc,
                UpdatedAtUtc = session.Video.UpdatedAtUtc,
                PublishedAtUtc = session.Video.PublishedAtUtc
            }
        };
    }
}
