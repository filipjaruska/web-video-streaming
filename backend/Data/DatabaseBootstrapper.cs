using System.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace WebWVideoStreamingAPI.Data;

/// <summary>
/// Brings the SQLite file in line with the current model at startup.
/// </summary>
/// <remarks>
/// There are no EF migrations here because the data is disposable. But the file itself outlives a
/// deploy — on Railway it sits on a persistent volume — and <c>EnsureCreated</c> does nothing at all
/// once any table exists, so a schema change would otherwise leave the app querying columns that
/// were never added. This detects that drift and recreates the database instead of failing on every
/// request. Recreation only happens on an actual mismatch, or when the file cannot be read at all,
/// so ordinary restarts keep their rows.
/// </remarks>
public static class DatabaseBootstrapper {
    /// <summary>
    /// SQLite result codes that mean the file itself is unusable — not merely busy or locked, which
    /// would be a reason to wait, never to delete.
    /// </summary>
    private static readonly HashSet<int> UnreadableFileCodes = [
        10, // SQLITE_IOERR
        11, // SQLITE_CORRUPT
        26  // SQLITE_NOTADB
    ];

    /// <summary>The files SQLite keeps beside a database; a reset has to remove all of them.</summary>
    private static readonly string[] SidecarSuffixes = ["", "-wal", "-shm", "-journal"];

    public static void EnsureSchema(AppDbContext dbContext, ILogger logger) {
        try {
            dbContext.Database.EnsureCreated();

            var drift = FindDrift(dbContext).ToList();
            if (drift.Count == 0) {
                return;
            }

            logger.LogWarning(
                "Database schema does not match the current model ({Drift}). Recreating it — existing rows are discarded. Media files already on disk are now orphaned and can be deleted.",
                string.Join("; ", drift));
        } catch (SqliteException ex) when (UnreadableFileCodes.Contains(ex.SqliteErrorCode)) {
            // A file that fails its very first query is not going to start working on the next boot;
            // left alone it crash-loops the service. The data is disposable, so start over.
            logger.LogError(
                ex,
                "Database file cannot be read (SQLite error {Code}). Recreating it — existing rows are discarded.",
                ex.SqliteErrorCode);
        }

        Recreate(dbContext, logger);
    }

    /// <summary>
    /// Deletes the database together with its WAL, shared-memory and rollback-journal files, then
    /// creates it afresh.
    /// </summary>
    /// <remarks>
    /// Not <c>EnsureDeleted</c>: that removes only the main file. EF creates SQLite databases in WAL
    /// mode, so the old <c>-wal</c> and <c>-shm</c> files stayed behind and were paired with the new
    /// database created next to them. On Railway the first write to it failed with "disk I/O error",
    /// and every boot afterwards failed on its first query — a crash loop that outlived the deploy
    /// which caused it.
    /// </remarks>
    private static void Recreate(AppDbContext dbContext, ILogger logger) {
        var path = ResolveDatabasePath(dbContext);

        dbContext.Database.CloseConnection();
        SqliteConnection.ClearAllPools();

        if (path != null) {
            foreach (var suffix in SidecarSuffixes) {
                var file = path + suffix;
                if (File.Exists(file)) {
                    File.Delete(file);
                    logger.LogInformation("Deleted {File}", file);
                }
            }
        } else {
            dbContext.Database.EnsureDeleted();
        }

        dbContext.Database.EnsureCreated();
        logger.LogInformation("Database recreated with the current schema.");
    }

    /// <summary>Absolute path of the database file, or null for an in-memory database.</summary>
    private static string? ResolveDatabasePath(AppDbContext dbContext) {
        var dataSource = new SqliteConnectionStringBuilder(dbContext.Database.GetConnectionString()).DataSource;

        if (string.IsNullOrWhiteSpace(dataSource) ||
            dataSource.Equals(":memory:", StringComparison.OrdinalIgnoreCase) ||
            dataSource.StartsWith("file::memory:", StringComparison.OrdinalIgnoreCase)) {
            return null;
        }

        return Path.GetFullPath(dataSource);
    }

    /// <summary>
    /// Compares the mapped model against what is actually in the file. Driven off the EF model
    /// rather than a hardcoded list, so it keeps working as entities change.
    /// </summary>
    private static IEnumerable<string> FindDrift(AppDbContext dbContext) {
        foreach (var entity in dbContext.Model.GetEntityTypes()) {
            var table = entity.GetTableName();
            if (string.IsNullOrEmpty(table)) {
                continue;
            }

            var actual = ReadColumns(dbContext, table);
            if (actual.Count == 0) {
                yield return $"table '{table}' is missing";
                continue;
            }

            foreach (var property in entity.GetProperties()) {
                var column = property.GetColumnName();
                if (!string.IsNullOrEmpty(column) && !actual.Contains(column)) {
                    yield return $"'{table}.{column}' is missing";
                }
            }
        }
    }

    private static HashSet<string> ReadColumns(AppDbContext dbContext, string table) {
        var columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var connection = dbContext.Database.GetDbConnection();
        var shouldClose = connection.State != ConnectionState.Open;

        if (shouldClose) {
            connection.Open();
        }

        try {
            using var command = connection.CreateCommand();
            // Table names here come from the EF model, never from user input.
            command.CommandText = $"PRAGMA table_info(\"{table}\");";

            using var reader = command.ExecuteReader();
            while (reader.Read()) {
                columns.Add(reader.GetString(1));
            }
        } finally {
            if (shouldClose) {
                connection.Close();
            }
        }

        return columns;
    }
}
