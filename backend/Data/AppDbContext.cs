using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Infrastructure.Analysis.Models;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Data;

public class AppDbContext : DbContext {
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) {
    }

    public DbSet<Video> Videos => Set<Video>();
    public DbSet<UploadSession> UploadSessions => Set<UploadSession>();
    public DbSet<Transcode> Transcodes => Set<Transcode>();
    public DbSet<VideoSourceAnalysis> VideoSourceAnalyses => Set<VideoSourceAnalysis>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) {
        modelBuilder.Entity<Video>(entity => {
            entity.HasKey(video => video.Id);
            entity.Property(video => video.RouteId).HasMaxLength(16).IsRequired();
            entity.Property(video => video.Title).HasMaxLength(200);
            entity.Property(video => video.Description).HasMaxLength(4000);
            entity.Property(video => video.ThumbnailUrl).HasMaxLength(500);
            entity.Property(video => video.OriginalFileName).HasMaxLength(260);
            entity.Property(video => video.StorageKey).HasMaxLength(260);
            entity.Property(video => video.SourceContentType).HasMaxLength(100);
            entity.Property(video => video.CreatedAtUtc).IsRequired();
            entity.Property(video => video.UpdatedAtUtc).IsRequired();

            entity.HasIndex(video => video.RouteId).IsUnique();
            entity.HasIndex(video => video.PublishedAtUtc);

            entity.HasOne(video => video.ActiveTranscode)
                .WithMany()
                .HasForeignKey(video => video.ActiveTranscodeId)
                .OnDelete(DeleteBehavior.SetNull);

            entity.HasOne(video => video.SourceAnalysis)
                .WithOne(analysis => analysis.Video)
                .HasForeignKey<VideoSourceAnalysis>(analysis => analysis.VideoId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<VideoSourceAnalysis>(entity => {
            entity.HasKey(analysis => analysis.VideoId);
            entity.Property(analysis => analysis.TreeJson).HasColumnType("TEXT").IsRequired();
            entity.Property(analysis => analysis.SeriesJson).HasColumnType("TEXT");
            entity.Property(analysis => analysis.UpdatedAtUtc).IsRequired();
        });

        modelBuilder.Entity<UploadSession>(entity => {
            entity.HasKey(session => session.Id);
            entity.Property(session => session.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(session => session.ProgressPercent).IsRequired();
            entity.Property(session => session.CurrentStep).HasMaxLength(64);
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
            entity.Property(transcode => transcode.ErrorMessage).HasMaxLength(2000);
            entity.Property(transcode => transcode.CreatedAtUtc).IsRequired();

            entity.HasOne(transcode => transcode.Video)
                .WithMany(video => video.Transcodes)
                .HasForeignKey(transcode => transcode.VideoId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(transcode => new { transcode.VideoId, transcode.CreatedAtUtc });
        });
    }
}
