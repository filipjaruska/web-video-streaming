using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace WebWVideoStreamingAPI.Api;

/// <summary>
/// Requires the site password, sent as <c>X-Action-Password</c>, when <c>ACTION_PASSWORD</c> is
/// set — the same variable the frontend prompts against. Unset (local development), every request
/// passes.
/// </summary>
/// <remarks>
/// Put on every endpoint that changes data or hands out the database. Reads and streaming stay
/// open: CORS does not protect an API from anything that is not a browser, so this is what keeps
/// a direct <c>curl -X DELETE</c> out.
/// </remarks>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class)]
public sealed class RequireActionPasswordAttribute : Attribute, IAuthorizationFilter {
    public const string HeaderName = "X-Action-Password";
    public const string ConfigKey = "ACTION_PASSWORD";

    public void OnAuthorization(AuthorizationFilterContext context) {
        var configuration = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
        var expected = configuration[ConfigKey]?.Trim();
        if (string.IsNullOrEmpty(expected)) {
            return;
        }

        var provided = context.HttpContext.Request.Headers[HeaderName].ToString();
        if (!Matches(expected, provided)) {
            context.Result = new ObjectResult(new { message = "Password required" }) {
                StatusCode = StatusCodes.Status401Unauthorized
            };
        }
    }

    /// <summary>Constant-time comparison, so response timing says nothing about the password.</summary>
    private static bool Matches(string expected, string provided) {
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        var providedBytes = Encoding.UTF8.GetBytes(provided);
        return expectedBytes.Length == providedBytes.Length
            && CryptographicOperations.FixedTimeEquals(expectedBytes, providedBytes);
    }
}
