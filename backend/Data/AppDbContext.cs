using Microsoft.EntityFrameworkCore;

namespace WebWVideoStreamingAPI.Data;

public class AppDbContext : DbContext {
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) {
    }

    public DbSet<Video> Videos => Set<Video>();
    public DbSet<UploadSession> UploadSessions => Set<UploadSession>();
    public DbSet<Transcode> Transcodes => Set<Transcode>();
    public DbSet<AnalysisReport> AnalysisReports => Set<AnalysisReport>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) {
        modelBuilder.Entity<Video>(entity => {
            entity.HasKey(video => video.Id);
            entity.Property(video => video.RouteId).HasMaxLength(16).IsRequired();
            entity.Property(video => video.Title).HasMaxLength(200);
            entity.Property(video => video.Description).HasMaxLength(4000);
            entity.Property(video => video.ThumbnailUrl).HasMaxLength(500);
            entity.Property(video => video.OriginalFileName).HasMaxLength(260);
            entity.Property(video => video.SourceContentType).HasMaxLength(100);
            entity.Property(video => video.CreatedAtUtc).IsRequired();
            entity.Property(video => video.UpdatedAtUtc).IsRequired();

            entity.HasIndex(video => video.RouteId).IsUnique();
            entity.HasIndex(video => video.PublishedAtUtc);

            entity.HasOne(video => video.ActiveTranscode)
                .WithMany()
                .HasForeignKey(video => video.ActiveTranscodeId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<UploadSession>(entity => {
            entity.HasKey(session => session.Id);
            entity.Property(session => session.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(session => session.ProgressPercent).IsRequired();
            entity.Property(session => session.CurrentStep).HasMaxLength(96);
            entity.Property(session => session.CreatedAtUtc).IsRequired();
            entity.Property(session => session.UpdatedAtUtc).IsRequired();
            entity.Property(session => session.ExpiresAtUtc).IsRequired();

            entity.HasOne(session => session.Video)
                .WithMany(video => video.UploadSessions)
                .HasForeignKey(session => session.VideoId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(session => new { session.VideoId, session.ExpiresAtUtc });
            entity.HasIndex(session => session.Status);
        });

        modelBuilder.Entity<Transcode>(entity => {
            entity.HasKey(transcode => transcode.Id);
            entity.Property(transcode => transcode.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(transcode => transcode.LadderKind).HasConversion<string>().HasMaxLength(32);
            entity.Property(transcode => transcode.ProfileJson).HasColumnType("TEXT");
            entity.Property(transcode => transcode.ErrorMessage).HasMaxLength(2000);
            entity.Property(transcode => transcode.CreatedAtUtc).IsRequired();

            entity.HasOne(transcode => transcode.Video)
                .WithMany(video => video.Transcodes)
                .HasForeignKey(transcode => transcode.VideoId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(transcode => new { transcode.VideoId, transcode.CreatedAtUtc });
            entity.HasIndex(transcode => new { transcode.VideoId, transcode.LadderKind });
        });

        // No FK to Video/Transcode — one table serves both owners, so rows are removed
        // explicitly by VideoCatalogService and UploadSessionService when their owner goes away.
        modelBuilder.Entity<AnalysisReport>(entity => {
            entity.HasKey(report => new { report.Owner, report.Id });
            entity.Property(report => report.Owner).HasConversion<string>().HasMaxLength(16);
            entity.Property(report => report.TreeJson).HasColumnType("TEXT").IsRequired();
            entity.Property(report => report.SeriesJson).HasColumnType("TEXT");
            entity.Property(report => report.UpdatedAtUtc).IsRequired();
        });
    }
}
