using System.Data;
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
/// request. Recreation only happens on an actual mismatch, so ordinary restarts keep their rows.
/// </remarks>
public static class DatabaseBootstrapper {
    public static void EnsureSchema(AppDbContext dbContext, ILogger logger) {
        dbContext.Database.EnsureCreated();

        var drift = FindDrift(dbContext).ToList();
        if (drift.Count == 0) {
            return;
        }

        logger.LogWarning(
            "Database schema does not match the current model ({Drift}). Recreating it — existing rows are discarded. Media files already on disk are now orphaned and can be deleted.",
            string.Join("; ", drift));

        dbContext.Database.EnsureDeleted();
        dbContext.Database.EnsureCreated();

        logger.LogInformation("Database recreated with the current schema.");
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
