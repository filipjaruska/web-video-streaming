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
      suspicious: "error",
    },
    rules: {
      // The automatic JSX runtime makes the React import unnecessary.
      "react/react-in-jsx-scope": "off",
      // Thumbnails are served by the API; next/image would route them through Vercel's optimizer.
      "nextjs/no-img-element": "off",
      // Fetch-on-mount, resets on a new source and playback-selection syncing are deliberate here.
      // Removing them means a data-fetching library or rewriting the playback path, and without
      // the React Compiler the rule would push ordinary new effects into suppressions too.
      "react/set-state-in-effect": "off",
      "react/refs": "error",
      "react/preserve-manual-memoization": "error",
      "react/error-boundaries": "error",
      "react/no-unstable-nested-components": "error",
      "react/exhaustive-effect-dependencies": "error",
      "typescript/no-unnecessary-type-conversion": "error",
      // hls.js's runtime build also exports Hls, Events and isSupported by name, but its typings
      // only expose the default class, so the documented Hls.Events / Hls.isSupported() is the
      // only form that type-checks. These rules read the runtime exports and misfire on it.
      "import/no-named-as-default": "off",
      "import/no-named-as-default-member": "off",
      // Stylesheets are loaded by side-effect import; anything else should bind what it imports.
      "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
      // Field names owned by dash.js (HTTPRequest timings) and hls.js (AbrController internals).
      "no-underscore-dangle": ["error", { allow: ["_tfinish", "_trequest", "_abandonRulesCheck"] }],
      "no-shadow": "error",
      "unicorn/consistent-function-scoping": "error",
      "unicorn/no-array-sort": "error",
      // tsconfig's noImplicitReturns covers this and understands exhaustive switches; the lint rule
      // flags those and every effect that returns a cleanup on only some paths.
      "typescript/consistent-return": "off",
      // What's left asserts at untyped boundaries: API JSON, dash.js/hls.js internals, Recharts
      // payloads and the vendored shadcn chart. Clearing them means validating every response at
      // runtime, which is a decision of its own rather than a lint fix.
      "typescript/no-unsafe-type-assertion": "off",
    },
    overrides: [
      {
        files: ["**/*.test.ts"],
        rules: {
          // Fixture helpers live inside the describe block whose cases use them.
          "unicorn/consistent-function-scoping": "off",
          // Vitest takes a failure message as expect's second argument.
          "vitest/valid-expect": ["error", { maxArgs: 2 }],
          // The API suites assert through shared check* helpers in tests/api/support/checks.ts.
          "vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "check*"] }],
        },
      },
      {
        files: ["frontend/tests/api/support/**"],
        rules: {
          "vitest/valid-expect": ["error", { maxArgs: 2 }],
        },
      },
    ],
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
