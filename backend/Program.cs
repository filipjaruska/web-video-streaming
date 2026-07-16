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

builder.Services.AddSingleton<WebWVideoStreamingAPI.Services.IVideoTranscodingService, WebWVideoStreamingAPI.Services.VideoTranscodingService>();

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
        ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.All
    });
}

app.UseAuthorization();

app.MapControllers();

app.Run();
