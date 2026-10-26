using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Options;

namespace WebWVideoStreamingAPI.Api;

/// <summary>
/// Gives a JSON response an ETag (a hash of its body) and <c>Cache-Control: no-cache</c>, and
/// answers <c>304 Not Modified</c> when the request already holds that version.
/// </summary>
/// <remarks>
/// For the documents pages poll while a video is processing — megabytes each — so a poll between
/// pipeline steps transfers headers only. The body is serialized once here and sent as is; nothing
/// is cached on the server, so a changed document is never answered with an old tag.
/// </remarks>
[AttributeUsage(AttributeTargets.Method)]
public sealed class ConditionalJsonAttribute : Attribute, IAsyncResultFilter {
    public async Task OnResultExecutionAsync(ResultExecutingContext context, ResultExecutionDelegate next) {
        if (context.Result is not ObjectResult { Value: { } value } result ||
            (result.StatusCode ?? StatusCodes.Status200OK) != StatusCodes.Status200OK) {
            await next();
            return;
        }

        var options = context.HttpContext.RequestServices
            .GetRequiredService<IOptions<JsonOptions>>().Value.JsonSerializerOptions;
        var body = JsonSerializer.SerializeToUtf8Bytes(value, value.GetType(), options);
        var etag = $"\"{Convert.ToBase64String(SHA256.HashData(body)[..16]).TrimEnd('=')}\"";

        var response = context.HttpContext.Response;
        response.Headers.ETag = etag;
        response.Headers.CacheControl = "no-cache";

        var ifNoneMatch = context.HttpContext.Request.Headers.IfNoneMatch;
        context.Result = ifNoneMatch.Any(header => header != null && header.Split(',').Any(tag => tag.Trim() == etag))
            ? new StatusCodeResult(StatusCodes.Status304NotModified)
            : new FileContentResult(body, "application/json; charset=utf-8");

        await next();
    }
}
