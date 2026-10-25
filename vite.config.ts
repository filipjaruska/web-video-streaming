import { defineConfig } from "vite-plus";

// Non-JS trees and generated output that neither Oxlint nor Oxfmt should touch.
const ignored = [
  "backend/**",
  "video/**",
  "tools/**",
  ".claude/**",
  ".idea/**",
  ".vscode/**",
  "**/.next/**",
  "**/node_modules/**",
];

export default defineConfig({
  lint: {
    ignorePatterns: ignored,
    plugins: ["typescript", "unicorn", "oxc", "react", "nextjs", "import", "vitest"],
    categories: {
      correctness: "error",
      suspicious: "warn",
    },
    rules: {
      // The automatic JSX runtime makes the React import unnecessary.
      "react/react-in-jsx-scope": "off",
      // Thumbnails are served by the API; next/image would route them through Vercel's optimizer.
      "nextjs/no-img-element": "off",
      // React Compiler rules. The compiler isn't enabled, and the flagged code is the playback
      // and measurement path, so these stay visible without blocking commits.
      "react/set-state-in-effect": "warn",
      "react/refs": "warn",
      "react/preserve-manual-memoization": "warn",
      "react/error-boundaries": "warn",
      "typescript/no-unnecessary-type-conversion": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: [...ignored, "**/pnpm-lock.yaml"],
  },
  // Staged files under the ignore patterns above (e.g. backend/railway.json) reach these commands
  // too; without the flag, a commit whose only matches are ignored fails.
  staged: {
    "*.{ts,tsx,js,mjs,cjs}": "vp check --fix --no-error-on-unmatched-pattern",
    "*.{json,md,yml,yaml,css}": "vp fmt --no-error-on-unmatched-pattern",
    "*.cs": "dotnet format web-video-streaming.sln --include",
  },
  run: {
    tasks: {
      "api:dev": {
        command: "dotnet watch run --project backend/WebWVideoStreamingAPI.csproj",
        cache: false,
      },
      "api:build": "dotnet build web-video-streaming.sln",
      "api:format": {
        command: "dotnet format web-video-streaming.sln",
        cache: false,
      },
      // Both dependencies are long-running and independent, so they start together
      // and this task's own command only runs once both have exited.
      dev: {
        command: "echo dev servers stopped",
        dependsOn: ["frontend#dev", "api:dev"],
        cache: false,
      },
    },
  },
});
