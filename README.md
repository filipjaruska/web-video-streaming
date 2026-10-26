# Web Video Streaming

A platform for measuring video streaming. The Next.js frontend holds the clip catalogue, the player
with its playback benchmark, per-clip analysis and the cross-clip results. The .NET backend
transcodes and analyses uploads with FFmpeg and serves HLS and DASH.

## Commands

Run these from the repo root.

- `vp install`: install dependencies and set up the git hooks
- `vp run dev`: start the frontend (http://localhost:3000) and backend (http://localhost:5000) together, with hot reload
- `vp run frontend#dev` / `vp run api:dev`: start only one of them
- `vp check`: format check, lint and type check
- `vp check --fix`: the same, applying fixes
- `vp run frontend#test`: frontend unit tests (Vitest)
- `vp run frontend#test:api`: API tests against the running backend (see [Testing](#testing))
- `vp run frontend#test:api:record`: re-record the API golden snapshots
- `vp run frontend#build`: production build of the frontend
- `vp run api:build`: build the backend
- `vp run api:format`: format all C# with `dotnet format`

Swagger UI is at http://localhost:5000/swagger while the backend runs.

## Prerequisites

- **Vite+ CLI (`vp`).** It also manages Node and pnpm.
  - Windows: `irm https://vite.plus/ps1 | iex`
  - macOS/Linux: `curl -fsSL https://vite.plus | bash`
- **.NET SDK 10.0.302+**, pinned in `backend/global.json`.
- **FFmpeg and ffprobe with libvmaf on `PATH`.** On Windows, use a full build from gyan.dev or BtbN. Distro builds often lack VMAF.

## Setup

```bash
vp install
cp frontend/.env.example frontend/.env.local
vp run dev
```

The defaults work for local development without editing either `.env.example`.

### Configuration

**Frontend:** `frontend/.env.local`

| Variable               | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`  | Backend URL used by the browser (default `http://localhost:5000`) |
| `API_URL`              | Optional server-only backend URL for SSR, sitemap and robots      |
| `NEXT_PUBLIC_SITE_URL` | Public origin for `sitemap.xml` and `robots.txt`                  |
| `ACTION_PASSWORD`      | Password for uploads and metadata edits. Empty disables it        |

**Backend:** environment variables override `appsettings.json`, and nested keys use `__`. See `backend/.env.example`.

| Variable                               | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `PORT`                                 | Listen port (default `5000`)                                   |
| `VIDEO_STORAGE_ROOT`                   | Uploads, transcodes and thumbnails (default `App_Data/media`)  |
| `ConnectionStrings__DefaultConnection` | SQLite database (default `App_Data/app.db`)                    |
| `AllowedOrigins__0`                    | CORS origin for the frontend (default `http://localhost:3000`) |

## Layout

```
frontend/              Next.js app (pnpm workspace member)
  app/                 routes: catalogue, clip tabs (watch, results, benchmark, raw), results, method, upload
  components/          player, benchmark panel, shared UI
  feature/             clip, results (chapter 5), upload timeline and method views
  hooks/               playback telemetry and the benchmark runner
  lib/abr/             ABR rules and the driver that applies them to hls.js and dash.js
  lib/benchmark/       benchmark matrix, metric definitions and types
  lib/results/         chapter 5 tables and graphs, reduced on the server
  tests/unit/          pure frontend logic: ABR rules, metrics, matrix, URLs, chapter 5 rows, CSV
  tests/api/           the API as the frontend consumes it (contracts, goldens, upload end-to-end)
backend/               ASP.NET Core API
  Api/                 controllers: videos, upload sessions, streaming, benchmarks, database
  Core/                upload, transcoding pipeline, processing queue, FFmpeg wrappers
  Analysis/            VMAF, SI/TI, encode grid, ladder derivation and comparison, BD-rate
  Data/                EF Core DbContext and entities (SQLite)
vite.config.ts         lint, format, staged-file and task config for the whole repo
```

## Testing

All tests live in `frontend/tests/` and run on Vitest through Vite+.

- **Unit (`tests/unit/`):** `vp run frontend#test`. Pure logic, no backend. They run in CI, and `vp check` type-checks them.
- **API (`tests/api/`):** `vp run frontend#test:api`. These run against the backend at `API_URL` (default `http://localhost:5000`) and skip cleanly when none is running. Every call goes through the frontend's own client functions (`lib/*Api.ts`).
  - **Contracts:**
    - Every response is checked against zod schemas bound to the frontend's TypeScript types.
    - Every HLS/DASH manifest and segment of every packaging run must resolve, plus byte ranges and CORS.
    - A request tagged with the 3G profile must actually be throttled to its rate.
    - Unknown resources get 404s, and path-traversal segment names are refused.
  - **Golden snapshots:**
    - What's recorded: the raw responses (analysis, benchmarks, transcodes, subtitles, the catalogue), every manifest, and a fingerprint of one segment per run.
    - Where they live: `tests/__golden__/`, gitignored, because they hold your measurement data and only match the database they came from.
    - On a later run, any change shows as a value-level diff.
    - Record them before a backend refactor with `vp run frontend#test:api:record`. Re-record after deliberately reprocessing a clip or adding benchmark runs.
  - **Upload end-to-end:**
    - Only runs with `API_TESTS_WRITE=1`.
    - It generates a 4 s clip with ffmpeg, uploads it, waits for the whole pipeline (about 9 minutes locally), runs every contract on it, submits a benchmark, renames the video and deletes it.
    - It only touches the video it creates, but it writes to the backend's database and occupies its processing queue. **Don't set it against a backend whose data matters.**
- **CI:** the `api` job starts a backend on a fresh database with the same FFmpeg build as the Docker image, then runs the API project with writes enabled. That includes the upload end-to-end test, so every push runs the whole processing pipeline once.

## Tooling

Vite+ runs Oxlint, Oxfmt, Vitest and the task runner from one root `vite.config.ts`. `next dev` and
`next build` still do the frontend's bundling. `vp run` only starts them.

- **Pre-commit hook:** `.vite-hooks/pre-commit` runs `vp staged` on the files you commit.
  - TS/JS gets `vp check --fix`. Lint or type errors block the commit.
  - JSON, CSS and Markdown get `vp fmt`.
  - C# gets `dotnet format`.

  Fixes are re-staged automatically. Set `VP_GIT_HOOKS=0` to skip the hook once.

- **Editor:** install the recommended VS Code extensions (Vite+ extension pack, C# Dev Kit). The workspace settings format and fix on save.
- **Line endings:** LF everywhere, enforced by `.gitattributes` and `.editorconfig`.

## Deployment

- **Frontend:** Vercel, with the Root Directory set to `frontend`. Dependencies install from the root lockfile.
- **Backend:** Railway, built from `backend/Dockerfile`. The image bundles a pinned static FFmpeg 8.1 build with libvmaf.
