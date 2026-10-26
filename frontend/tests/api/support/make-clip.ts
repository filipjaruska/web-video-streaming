import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Generates the clip the upload end-to-end test pushes through the pipeline, so nothing binary is
 * committed: a 1080p test pattern with a tone and one SRT subtitle track, muxed to MKV like the
 * thesis clips. Needs ffmpeg on PATH.
 *
 * Kept short because the pipeline's cost scales with duration (every rung, the CRF grids and VMAF
 * all run over the whole clip).
 */
export function makeClip(outDir: string, seconds = 4): string {
  mkdirSync(outDir, { recursive: true });
  const srtPath = join(outDir, "e2e-clip.srt");
  const clipPath = join(outDir, "e2e-clip.mkv");

  writeFileSync(
    srtPath,
    `1\n00:00:00,000 --> 00:00:0${Math.min(seconds, 9)},000\nEnd-to-end test subtitle\n`,
  );

  const result = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=1920x1080:rate=24:duration=${seconds}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
      "-i",
      srtPath,
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-map",
      "2:s",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-c:s",
      "srt",
      "-metadata:s:s:0",
      "language=eng",
      clipPath,
    ],
    { encoding: "utf8" },
  );

  if (result.error || result.status !== 0) {
    throw new Error(`ffmpeg could not generate the e2e clip: ${result.error ?? result.stderr}`);
  }

  return clipPath;
}

// `node make-clip.ts <outDir> [seconds]` for generating the clip by hand.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(makeClip(process.argv[2] ?? ".", Number(process.argv[3] ?? 4)));
}
