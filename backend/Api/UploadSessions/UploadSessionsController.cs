using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Models;
using WebWVideoStreamingAPI.Services;

namespace WebWVideoStreamingAPI.Api.UploadSessions;

[ApiController]
[Route("api/uploadSessions")]
public class UploadSessionsController : ControllerBase {
    private readonly IUploadSessionService _uploadSessionService;

    public UploadSessionsController(IUploadSessionService uploadSessionService) {
        _uploadSessionService = uploadSessionService;
    }

    [HttpPost]
    [ProducesResponseType(StatusCodes.Status201Created)]
    public async Task<IActionResult> CreateSession(CancellationToken cancellationToken) {
        var session = await _uploadSessionService.CreateSessionAsync(cancellationToken);
        var payload = ToResponse(session);

        return CreatedAtAction(nameof(GetSession), new { sessionId = session.Id }, payload);
    }

    [HttpGet("{sessionId:guid}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetSession(Guid sessionId, CancellationToken cancellationToken) {
        var session = await _uploadSessionService.GetSessionAsync(sessionId, cancellationToken);
        if (session == null) {
            return NotFound(new { message = "Upload session not found" });
        }

        return Ok(ToResponse(session));
    }

    [HttpPatch("{sessionId:guid}/video")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> UpdateVideo(Guid sessionId, [FromBody] UpdateUploadSessionVideoRequest request, CancellationToken cancellationToken) {
        var session = await _uploadSessionService.UpdateVideoMetadataAsync(sessionId, request.Title, request.Description, cancellationToken);
        if (session == null) {
            return NotFound(new { message = "Upload session not found" });
        }

        return Ok(ToResponse(session));
    }

    private static object ToResponse(UploadSession session) {
        return new {
            sessionId = session.Id,
            redirectUrl = $"/upload/{session.Id}",
            session = new {
                status = session.Status.ToString(),
                progressPercent = session.ProgressPercent,
                createdAtUtc = session.CreatedAtUtc,
                updatedAtUtc = session.UpdatedAtUtc,
                expiresAtUtc = session.ExpiresAtUtc,
                uploadedAtUtc = session.UploadedAtUtc,
                completedAtUtc = session.CompletedAtUtc
            },
            video = new {
                routeId = session.Video.RouteId,
                title = session.Video.Title,
                description = session.Video.Description,
                thumbnailUrl = session.Video.ThumbnailUrl,
                originalFileName = session.Video.OriginalFileName,
                storageKey = session.Video.StorageKey,
                createdAtUtc = session.Video.CreatedAtUtc,
                updatedAtUtc = session.Video.UpdatedAtUtc,
                publishedAtUtc = session.Video.PublishedAtUtc
            }
        };
    }

    public sealed class UpdateUploadSessionVideoRequest {
        public string? Title { get; set; }
        public string? Description { get; set; }
    }
}
