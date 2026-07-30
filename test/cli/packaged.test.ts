import { beforeAll, describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const built = join(projectRoot, "dist", "cli.js");

/**
 * The CLI only decides to run when it is the program being executed. Getting
 * that check wrong is invisible from the source tree and total once packaged:
 * `npm install` puts a symlink in node_modules/.bin, and a check that compares
 * paths naively sees the symlink and the real file as different programs, so the
 * command exits silently having done nothing.
 */
describe("the built command", () => {
  beforeAll(() => {
    if (!existsSync(built)) {
      execFileSync("npm", ["run", "build"], { cwd: projectRoot, stdio: "ignore" });
    }
  }, 120_000);

  test("prints a report when run directly", () => {
    const result = spawnSync(process.execPath, [built, "demo", "--no-color"], {
      encoding: "utf8",
    });
    expect(result.stdout).toContain("CAUGHT");
    expect(result.status).toBe(1);
  });

  test("prints a report when run through a symlink, the way npm installs it", () => {
    const dir = mkdtempSync(join(tmpdir(), "rh-bin-"));
    const link = join(dir, "red-handed");
    symlinkSync(built, link);

    const result = spawnSync(process.execPath, [link, "demo", "--no-color"], {
      encoding: "utf8",
    });
    expect(result.stdout).toContain("CAUGHT");
    expect(result.status).toBe(1);
  });

  test("answers --version through a symlink too", () => {
    const dir = mkdtempSync(join(tmpdir(), "rh-bin-v-"));
    const link = join(dir, "red-handed");
    symlinkSync(built, link);

    const result = spawnSync(process.execPath, [link, "--version"], { encoding: "utf8" });
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
