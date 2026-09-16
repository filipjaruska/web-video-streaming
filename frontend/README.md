# Frontend

Next.js app for streaming measurements: the clip catalogue, the player with its
playback benchmark, per-clip analysis and the cross-clip results. It talks to the .NET backend in
`../backend`.

## Running locally

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL=http://localhost:5000
npm install
npm run dev                  # http://localhost:3000
```

Start the backend first (`dotnet run` in `../backend`, which listens on port 5000).

## Scripts

- `npm run dev` — development server
- `npm run build` / `npm start` — production build and server
- `npm test` — unit tests (Vitest)

## Layout

- `app/` — routes: catalogue, `[video]` player and analysis, `results`, `concepts`, `editor`
- `components/` — player, benchmark panel, shared UI
- `feature/` — analysis, results, concepts and editor views
- `hooks/` — playback telemetry and the benchmark runner
- `lib/abr/` — the ABR rules and the driver that applies them to hls.js and dash.js
- `lib/benchmark/` — benchmark matrix, metric definitions and types
