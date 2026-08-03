using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.HttpOverrides;
using WebWVideoStreamingAPI.Core;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Infrastructure;
using WebWVideoStreamingAPI.Infrastructure.Analysis;

var builder = WebApplication.CreateBuilder(args);

var port = Environment.GetEnvironmentVariable("PORT") ?? "5000";
builder.WebHost.ConfigureKestrel(serverOptions => {
    serverOptions.ListenAnyIP(int.Parse(port));
});

builder.Services.AddSwaggerGen();

var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>()
    ?? new[] { "http://localhost:5173", "http://localhost:3000" };

builder.Services.AddCors(options => {
    options.AddPolicy("AllowReactApp",
        policy => {
            policy.WithOrigins(allowedOrigins)
                  .AllowAnyHeader()
                  .AllowAnyMethod();
        });
});

var contentRoot = builder.Environment.ContentRootPath;
var defaultAppData = Path.Combine(contentRoot, "App_Data");
Directory.CreateDirectory(defaultAppData);

var storageRoot = Environment.GetEnvironmentVariable("VIDEO_STORAGE_ROOT")
    ?? builder.Configuration.GetSection(StorageOptions.SectionName)["RootPath"];
if (string.IsNullOrWhiteSpace(storageRoot)) {
    storageRoot = Path.Combine(defaultAppData, "media");
}

storageRoot = Path.GetFullPath(storageRoot);
Directory.CreateDirectory(storageRoot);

builder.Services.Configure<StorageOptions>(options => {
    options.RootPath = storageRoot;
});

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connectionString)) {
    connectionString = $"Data Source={Path.Combine(defaultAppData, "app.db")}";
}

// Ensure SQLite parent directory exists when connection string points at a file path.
EnsureSqliteDirectory(connectionString);

builder.Services.AddDbContext<AppDbContext>(options => {
    options.UseSqlite(connectionString);
});

builder.Services.AddScoped<IUploadSessionService, UploadSessionService>();
builder.Services.AddScoped<IVideoStorageService, VideoStorageService>();
builder.Services.AddScoped<IVideoCatalogService, VideoCatalogService>();
builder.Services.AddScoped<IVideoSourceAnalysisService, VideoSourceAnalysisService>();
builder.Services.AddScoped<IVideoTranscodeAnalysisService, VideoTranscodeAnalysisService>();
builder.Services.AddScoped<ITranscodeAnalysisCollector, TranscodeAnalysisCollector>();
builder.Services.AddScoped<VideoProcessingPipeline>();
builder.Services.AddSingleton<IVideoProcessingQueue, VideoProcessingQueue>();
builder.Services.AddHostedService<VideoProcessingWorker>();
builder.Services.AddSingleton<IMediaProcessRunner, MediaProcessRunner>();
builder.Services.AddSingleton<IFfmpegRunner, FfmpegRunner>();
builder.Services.AddSingleton<IVideoTranscodingService, VideoTranscodingService>();
builder.Services.AddSingleton<IMediaProbeService, MediaProbeService>();
builder.Services.AddSingleton<ISitiAnalysisService, SitiAnalysisService>();
builder.Services.AddSingleton<IVmafAnalysisService, VmafAnalysisService>();

builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options => {
    options.MultipartBodyLengthLimit = 524_288_000;
});

builder.Services.Configure<Microsoft.AspNetCore.Server.Kestrel.Core.KestrelServerOptions>(options => {
    options.Limits.MaxRequestBodySize = 524_288_000;
});

builder.Services.AddControllers();
builder.Services.AddOpenApi();

var app = builder.Build();

app.MapOpenApi();
app.UseSwagger();
app.UseSwaggerUI(c => {
    c.SwaggerEndpoint("/swagger/v1/swagger.json", "Video Streaming API v1");
    c.RoutePrefix = "swagger";
});

app.UseCors("AllowReactApp");

app.UseStaticFiles();

if (app.Environment.IsProduction()) {
    app.UseForwardedHeaders(new ForwardedHeadersOptions {
        ForwardedHeaders = ForwardedHeaders.All
    });
}

app.UseAuthorization();

app.MapControllers();

using (var scope = app.Services.CreateScope()) {
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    dbContext.Database.EnsureCreated();
}

app.Logger.LogInformation("Video storage root: {StorageRoot}", storageRoot);

app.Run();

static void EnsureSqliteDirectory(string connectionString) {
    const string prefix = "Data Source=";
    var start = connectionString.IndexOf(prefix, StringComparison.OrdinalIgnoreCase);
    if (start < 0) {
        return;
    }

    var pathPart = connectionString[(start + prefix.Length)..].Trim();
    var semicolon = pathPart.IndexOf(';');
    if (semicolon >= 0) {
        pathPart = pathPart[..semicolon];
    }

    pathPart = pathPart.Trim('"');
    if (string.IsNullOrWhiteSpace(pathPart) || pathPart.Equals(":memory:", StringComparison.OrdinalIgnoreCase)) {
        return;
    }

    var directory = Path.GetDirectoryName(Path.GetFullPath(pathPart));
    if (!string.IsNullOrWhiteSpace(directory)) {
        Directory.CreateDirectory(directory);
    }
}
