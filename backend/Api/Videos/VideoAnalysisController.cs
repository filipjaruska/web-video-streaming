using Microsoft.AspNetCore.Mvc;
using WebWVideoStreamingAPI.Infrastructure.Analysis;

namespace WebWVideoStreamingAPI.Api.Videos;

[ApiController]
[Route("api/videos")]
public class VideoAnalysisController : ControllerBase {
    private readonly IVideoSourceAnalysisService _analysis;

    public VideoAnalysisController(IVideoSourceAnalysisService analysis) {
        _analysis = analysis;
    }

    [HttpGet("{routeId}/analysis")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetAnalysis(string routeId, CancellationToken cancellationToken) {
        var result = await _analysis.GetByRouteIdAsync(routeId, cancellationToken);
        if (result == null) {
            return NotFound(new { message = "Video not found" });
        }

        return Ok(new {
            routeId = result.RouteId,
            schemaVersion = result.SchemaVersion,
            updatedAtUtc = result.UpdatedAtUtc,
            targets = result.Targets,
            futureTests = result.FutureTests
        });
    }
}
