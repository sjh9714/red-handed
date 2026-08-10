import { copyFileSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/fix-hook.ts"],
  // The plugin ships the hook script inside the repo, because dist/ is not
  // committed and a plugin install is just a checkout. Copying on every build
  // keeps the committed copy current, and a test pins the two files equal.
  onSuccess: async () => {
    copyFileSync("dist/fix-hook.js", "hooks/fix-pipes.mjs");
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  minify: false,
  sourcemap: false,
  splitting: false,
  shims: false,
});
