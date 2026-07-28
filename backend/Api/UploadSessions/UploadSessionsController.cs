using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Core;
using WebWVideoStreamingAPI.Infrastructure;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Api.UploadSessions;

[ApiController]
[Route("api/uploadSessions")]
public class UploadSessionsController : ControllerBase {
    private const long MaxFileSize = 500 * 1024 * 1024;

    private readonly IUploadSessionService _uploadSessionService;
    private readonly IVideoProcessingQueue _processingQueue;

    public UploadSessionsController(
        IUploadSessionService uploadSessionService,
        IVideoProcessingQueue processingQueue) {
        _uploadSessionService = uploadSessionService;
        _processingQueue = processingQueue;
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

    [HttpPost("{sessionId:guid}/upload")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status413PayloadTooLarge)]
    [RequestSizeLimit(MaxFileSize)]
    public async Task<IActionResult> UploadFile(Guid sessionId, IFormFile file, CancellationToken cancellationToken) {
        if (file == null) {
            return BadRequest(new { message = "No file uploaded" });
        }

        await using var stream = file.OpenReadStream();
        var result = await _uploadSessionService.UploadFileAsync(
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
                "InvalidState" => BadRequest(new { message = result.Message }),
                _ => BadRequest(new { message = result.Message })
            };
        }

        if (result.VideoId.HasValue) {
            _processingQueue.Enqueue(result.VideoId.Value);
        }

        return Ok(ToResponse(result.Session!));
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
