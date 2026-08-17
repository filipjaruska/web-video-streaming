using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Server.Kestrel.Core;
using Microsoft.EntityFrameworkCore;
using WebWVideoStreamingAPI.Analysis;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options => {
    options.ListenAnyIP(int.Parse(Environment.GetEnvironmentVariable("PORT") ?? "5000"));
});

// —— Storage & database locations ——————————————————————————————————————————

var defaultAppData = Path.Combine(builder.Environment.ContentRootPath, "App_Data");
Directory.CreateDirectory(defaultAppData);

var storageRoot = Environment.GetEnvironmentVariable("VIDEO_STORAGE_ROOT")
    ?? builder.Configuration.GetSection(StorageOptions.SectionName)["RootPath"];
if (string.IsNullOrWhiteSpace(storageRoot)) {
    storageRoot = Path.Combine(defaultAppData, "media");
}

storageRoot = Path.GetFullPath(storageRoot);
Directory.CreateDirectory(storageRoot);

builder.Services.Configure<StorageOptions>(options => options.RootPath = storageRoot);
builder.Services.Configure<UploadOptions>(builder.Configuration.GetSection(UploadOptions.SectionName));

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connectionString)) {
    connectionString = $"Data Source={Path.Combine(defaultAppData, "app.db")}";
}

EnsureSqliteDirectory(connectionString);
builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlite(connectionString));

// —— Services ——————————————————————————————————————————————————————————————

// Stateless wrappers around ffmpeg/ffprobe and the media root — safe to share.
builder.Services.AddSingleton<ProcessRunner>();
builder.Services.AddSingleton<MediaPaths>();
builder.Services.AddSingleton<MediaProbe>();
builder.Services.AddSingleton<Transcoder>();
builder.Services.AddSingleton<SitiAnalyzer>();
builder.Services.AddSingleton<VmafAnalyzer>();
builder.Services.AddSingleton<ProcessingQueue>();
builder.Services.AddHostedService<ProcessingWorker>();

// Everything below touches AppDbContext, so it follows the request/job scope.
builder.Services.AddScoped<AnalysisStore>();
builder.Services.AddScoped<UploadSessionService>();
builder.Services.AddScoped<VideoCatalogService>();
builder.Services.AddScoped<SubtitleExtractor>();
builder.Services.AddScoped<TranscodeAnalysisCollector>();
builder.Services.AddScoped<EncodeGrid>();
builder.Services.AddScoped<LadderDerivation>();
builder.Services.AddScoped<ProcessingPipeline>();

builder.Services.Configure<FormOptions>(options =>
    options.MultipartBodyLengthLimit = UploadOptions.MaxBytes);
builder.Services.Configure<KestrelServerOptions>(options =>
    options.Limits.MaxRequestBodySize = UploadOptions.MaxBytes);

var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>()
    ?? ["http://localhost:5173", "http://localhost:3000"];

builder.Services.AddCors(options => {
    options.AddPolicy("AllowReactApp", policy => policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod());
});

builder.Services.AddControllers();
builder.Services.AddOpenApi();
builder.Services.AddSwaggerGen();

// —— Pipeline ——————————————————————————————————————————————————————————————

var app = builder.Build();

app.MapOpenApi();
app.UseSwagger();
app.UseSwaggerUI(options => {
    options.SwaggerEndpoint("/swagger/v1/swagger.json", "Video Streaming API v1");
    options.RoutePrefix = "swagger";
});

app.UseCors("AllowReactApp");
app.UseStaticFiles();

if (app.Environment.IsProduction()) {
    app.UseForwardedHeaders(new ForwardedHeadersOptions { ForwardedHeaders = ForwardedHeaders.All });
}

app.UseAuthorization();
app.MapControllers();

using (var scope = app.Services.CreateScope()) {
    DatabaseBootstrapper.EnsureSchema(
        scope.ServiceProvider.GetRequiredService<AppDbContext>(),
        app.Logger);
}

app.Logger.LogInformation("Video storage root: {StorageRoot}", storageRoot);

app.Run();

/// <summary>Creates the parent directory when the connection string points at a SQLite file.</summary>
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
