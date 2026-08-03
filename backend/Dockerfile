# Build stage
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Copy csproj and restore dependencies
COPY *.csproj ./
RUN dotnet restore

# Copy everything else and build
COPY . ./
RUN dotnet publish -c Release -o /app/publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app

# Install FFmpeg (VMAF needs a build with libvmaf; soft-fails at runtime if missing).
# Local Windows: use a full build (gyan.dev / BtbN) with --enable-libvmaf on PATH.
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy published app
COPY --from=build /app/publish .

# Expose port (Railway will set PORT env var)
EXPOSE 5000

# Start the app
ENTRYPOINT ["dotnet", "WebWVideoStreamingAPI.dll"]
