using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Models;

namespace WebWVideoStreamingAPI.Data;

public class AppDbContext : DbContext {
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) {
    }

    public DbSet<Video> Videos => Set<Video>();
    public DbSet<UploadSession> UploadSessions => Set<UploadSession>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) {
        modelBuilder.Entity<Video>(entity => {
            entity.HasKey(video => video.Id);
            entity.Property(video => video.RouteId).HasMaxLength(16).IsRequired();
            entity.Property(video => video.Title).HasMaxLength(200);
            entity.Property(video => video.Description).HasMaxLength(4000);
            entity.Property(video => video.ThumbnailUrl).HasMaxLength(500);
            entity.Property(video => video.OriginalFileName).HasMaxLength(260);
            entity.Property(video => video.StorageKey).HasMaxLength(260);
            entity.Property(video => video.CreatedAtUtc).IsRequired();
            entity.Property(video => video.UpdatedAtUtc).IsRequired();

            entity.HasIndex(video => video.RouteId).IsUnique();
        });

        modelBuilder.Entity<UploadSession>(entity => {
            entity.HasKey(session => session.Id);
            entity.Property(session => session.Status).HasConversion<string>().HasMaxLength(32);
            entity.Property(session => session.ProgressPercent).IsRequired();
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
    }
}
