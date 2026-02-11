var builder = WebApplication.CreateBuilder(args);

// Configure Kestrel to listen on Railway's PORT if available
var port = Environment.GetEnvironmentVariable("PORT") ?? "5000";
builder.WebHost.ConfigureKestrel(serverOptions => {
    serverOptions.ListenAnyIP(int.Parse(port));
});

builder.Services.AddSwaggerGen();

// Get allowed origins from configuration
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

// Add services to the container.
builder.Services.AddSingleton<WebWVideoStreamingAPI.Services.IVideoTranscodingService, WebWVideoStreamingAPI.Services.VideoTranscodingService>();

// Configure file upload size limits
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options => {
    options.MultipartBodyLengthLimit = 524_288_000; // 500 MB
});

builder.Services.Configure<Microsoft.AspNetCore.Server.Kestrel.Core.KestrelServerOptions>(options => {
    options.Limits.MaxRequestBodySize = 524_288_000; // 500 MB
});

builder.Services.AddControllers();
// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

var app = builder.Build();

// Enable Swagger in all environments (useful for Railway deployment)
app.MapOpenApi();
app.UseSwagger();
app.UseSwaggerUI(c => {
    c.SwaggerEndpoint("/swagger/v1/swagger.json", "Video Streaming API v1");
    c.RoutePrefix = "swagger"; // Access at /swagger
});

app.UseCors("AllowReactApp");

app.UseStaticFiles();

// Only redirect to HTTPS in production and when behind a proxy
if (app.Environment.IsProduction()) {
    app.UseForwardedHeaders(new ForwardedHeadersOptions {
        ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.All
    });
}

// Disable HTTPS redirection for Railway (Railway handles SSL termination)
// app.UseHttpsRedirection();

app.UseAuthorization();

app.MapControllers();

app.Run();
