import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  minify: false,
  sourcemap: false,
  splitting: false,
  shims: false,
});
