using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace WebWVideoStreamingAPI.Api.Database;

[ApiController]
[Route("api/database")]
public class DatabaseController : ControllerBase {
    private readonly AppDbContext _dbContext;
    private readonly ILogger<DatabaseController> _logger;

    public DatabaseController(AppDbContext dbContext, ILogger<DatabaseController> logger) {
        _dbContext = dbContext;
        _logger = logger;
    }

    /// <summary>
    /// Downloads a snapshot of the whole SQLite database.
    /// </summary>
    /// <remarks>
    /// The live file is never served or touched directly. EF runs SQLite in WAL mode, so recent
    /// commits may still sit in <c>-wal</c> rather than the main file, and copying <c>app.db</c> alone
    /// would hand out a stale or torn database. Instead SQLite's online backup API copies every page
    /// through a read-only connection into a temporary file — readers never block writers in WAL
    /// mode, so a running pipeline keeps writing — and that copy is streamed and deleted on close.
    /// </remarks>
    [HttpGet("export")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public async Task<IActionResult> Export(CancellationToken cancellationToken) {
        var source = new SqliteConnectionStringBuilder(_dbContext.Database.GetConnectionString()) {
            Mode = SqliteOpenMode.ReadOnly,
            Pooling = false
        };
        var snapshotPath = Path.Combine(Path.GetTempPath(), $"db-export-{Guid.NewGuid():N}.db");
        var destination = new SqliteConnectionStringBuilder {
            DataSource = snapshotPath,
            Pooling = false
        };

        try {
            await Task.Run(() => {
                using var sourceConnection = new SqliteConnection(source.ToString());
                using var destinationConnection = new SqliteConnection(destination.ToString());
                sourceConnection.Open();
                destinationConnection.Open();
                sourceConnection.BackupDatabase(destinationConnection);
            }, cancellationToken);
        } catch (Exception ex) {
            System.IO.File.Delete(snapshotPath);
            _logger.LogError(ex, "Failed to snapshot the database");
            return StatusCode(500, new { message = "Failed to export the database" });
        }

        var snapshot = new FileStream(
            snapshotPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.None,
            bufferSize: 81920,
            FileOptions.DeleteOnClose | FileOptions.Asynchronous);

        _logger.LogInformation("Exporting database snapshot ({Bytes} bytes)", snapshot.Length);
        Response.Headers.CacheControl = "no-store";
        return File(snapshot, "application/vnd.sqlite3", $"app-{DateTime.UtcNow:yyyyMMdd-HHmmss}Z.db");
    }
}
