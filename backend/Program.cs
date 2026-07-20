using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.HttpOverrides;
using WebWVideoStreamingAPI.Data;
using WebWVideoStreamingAPI.Services;

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

var appDataDirectory = Path.Combine(builder.Environment.ContentRootPath, "App_Data");
Directory.CreateDirectory(appDataDirectory);
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? $"Data Source={Path.Combine(appDataDirectory, "upload-sessions.db")}";

builder.Services.AddDbContext<AppDbContext>(options => {
    options.UseSqlite(connectionString);
});

builder.Services.AddScoped<IUploadSessionService, UploadSessionService>();
builder.Services.AddScoped<IVideoStorageService, VideoStorageService>();
builder.Services.AddSingleton<IFfmpegRunner, FfmpegRunner>();
builder.Services.AddSingleton<IVideoTranscodingService, VideoTranscodingService>();

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

app.Run();
