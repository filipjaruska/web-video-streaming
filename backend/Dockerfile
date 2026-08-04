# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy csproj and restore dependencies
COPY *.csproj ./
RUN dotnet restore

# Copy everything else and build
COPY . ./
RUN dotnet publish -c Release -o /app/publish

# Static FFmpeg from BtbN (gpl build includes libvmaf). Kept out of the runtime
# apt layer so Railway builds stay fast and VMAF works (distro ffmpeg often lacks it).
# Local Windows: use a full build (gyan.dev / BtbN) with --enable-libvmaf on PATH.
FROM debian:bookworm-slim AS ffmpeg
ARG TARGETARCH
ARG FFMPEG_URL_AMD64=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz
ARG FFMPEG_URL_ARM64=https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linuxarm64-gpl.tar.xz
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
    && arch="${TARGETARCH:-amd64}" \
    && if [ "$arch" = "arm64" ]; then url="$FFMPEG_URL_ARM64"; else url="$FFMPEG_URL_AMD64"; fi \
    && curl -fsSL "$url" -o /tmp/ffmpeg.tar.xz \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp \
    && install -m 755 /tmp/ffmpeg-*/bin/ffmpeg /usr/local/bin/ffmpeg \
    && install -m 755 /tmp/ffmpeg-*/bin/ffprobe /usr/local/bin/ffprobe \
    && rm -rf /var/lib/apt/lists/* /tmp/ffmpeg* /tmp/ffmpeg.tar.xz

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app

COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /usr/local/bin/ffprobe /usr/local/bin/ffprobe

# Copy published app
COPY --from=build /app/publish .

# Expose port (Railway will set PORT env var)
EXPOSE 5000

# Start the app
ENTRYPOINT ["dotnet", "WebWVideoStreamingAPI.dll"]
