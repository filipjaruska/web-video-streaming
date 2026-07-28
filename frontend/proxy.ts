import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

function getCountryCode(request: NextRequest): string | null {
  const headerValue =
    request.headers.get("x-vercel-ip-country") ??
    request.headers.get("cf-ipcountry") ??
    request.headers.get("x-country-code") ??
    request.headers.get("x-geo-country");

  return headerValue?.trim().toUpperCase() || null;
}

export function proxy(request: NextRequest) {
  const hostname = request.nextUrl.hostname;
  const isLocalhost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  if (process.env.NODE_ENV !== "production" || isLocalhost) {
    return NextResponse.next();
  }

  const countryCode = getCountryCode(request);

  if (countryCode && ALLOWED_COUNTRIES.has(countryCode)) {
    return NextResponse.next();
  }

  return new NextResponse("Access denied", {
    status: 403,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
