import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "../../src/cli.js";
import { flattenPath } from "../../src/session/discover.js";
import { session } from "../fixtures/session-builder.js";
import { excerpt } from "../../src/detectors/helpers.js";

interface Run {
  code: number;
  out: string;
  err: string;
}

async function run(argv: string[], env: Record<string, string> = {}): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    out: (t) => {
      out += t;
    },
    err: (t) => {
      err += t;
    },
    env: { NO_COLOR: "1", ...env },
  });
  return { code, out, err };
}

/** A repo whose session switched a test off, plus a private home for the cache. */
function cheatingProject(): { repo: string; home: string; cacheHome: string } {
  const repo = mkdtempSync(join(tmpdir(), "rh-safe-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  const testFile = join(repo, "test/cart.test.ts");
  mkdirSync(dirname(testFile), { recursive: true });
  writeFileSync(testFile, "it.only('total', () => {})\n");

  const home = mkdtempSync(join(tmpdir(), "rh-safe-home-"));
  const projectDir = join(home, "projects", flattenPath(repo));
  mkdirSync(projectDir, { recursive: true });
  session({ cwd: repo, sessionId: "cafe0000-1111-2222-3333-444444444444" })
    .edit(testFile, "it('total'", "it.only('total'")
    .writeTo(projectDir);

  return { repo, home, cacheHome: mkdtempSync(join(tmpdir(), "rh-safe-cache-")) };
}

describe("the cache never keeps an accusation alive after the code is gone", () => {
  test("a finding whose code was reverted disappears on the next run", async () => {
    const { repo, home, cacheHome } = cheatingProject();
    const first = await run(["stats", "--claude-home", home, "--json"], {
      RED_HANDED_HOME: cacheHome,
    });
    expect((JSON.parse(first.out) as { summary: { caught: number } }).summary.caught).toBe(1);

    // The user takes the .only back out. The accusation must not survive.
    writeFileSync(join(repo, "test/cart.test.ts"), "it('total', () => {})\n");
    const second = await run(["stats", "--claude-home", home, "--json"], {
      RED_HANDED_HOME: cacheHome,
    });
    expect((JSON.parse(second.out) as { summary: { caught: number } }).summary.caught).toBe(0);
  });

  test("--no-cache is accepted and produces the same answer", async () => {
    const { home, cacheHome } = cheatingProject();
    const result = await run(["stats", "--claude-home", home, "--json", "--no-cache"], {
      RED_HANDED_HOME: cacheHome,
    });
    expect(result.code).toBe(1);
  });

  test("the cache is written where only its owner can read it", async () => {
    const { home, cacheHome } = cheatingProject();
    await run(["stats", "--claude-home", home, "--json"], { RED_HANDED_HOME: cacheHome });
    const mode = statSync(join(cacheHome, "cache.json")).mode & 0o777;
    expect(mode & 0o077).toBe(0);
  });
});

describe("a mistyped option is a usage error, not a clean audit", () => {
  test("an unknown detector name is rejected", async () => {
    const { repo, home } = cheatingProject();
    const result = await run(["--cwd", repo, "--claude-home", home, "--detectors", "skip_only"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("skip_only");
    expect(result.err).toContain("skip-only");
  });

  test("a valid detector name is still accepted", async () => {
    const { repo, home } = cheatingProject();
    const result = await run(["--cwd", repo, "--claude-home", home, "--detectors", "skip-only"]);
    expect(result.code).toBe(1);
  });

  test("a nonsense --since is rejected", async () => {
    const { home } = cheatingProject();
    const result = await run(["stats", "--claude-home", home, "--since", "abc"]);
    expect(result.code).toBe(2);
  });
});

describe("quiet mode still says something when it fails the build", () => {
  test("--quiet --fail-on suspicious explains why it exited non-zero", async () => {
    const { repo, home } = cheatingProject();
    const result = await run([
      "--cwd",
      repo,
      "--claude-home",
      home,
      "--quiet",
      "--fail-on",
      "suspicious",
    ]);
    expect(result.code).toBe(1);
    expect(result.out + result.err).not.toBe("");
  });

  test("--quiet --json always emits a document", async () => {
    const clean = mkdtempSync(join(tmpdir(), "rh-clean-"));
    const home = mkdtempSync(join(tmpdir(), "rh-clean-home-"));
    const projectDir = join(home, "projects", flattenPath(clean));
    mkdirSync(projectDir, { recursive: true });
    session({ cwd: clean }).say("Renamed a module.").writeTo(projectDir);

    const result = await run(["--cwd", clean, "--claude-home", home, "--quiet", "--json"]);
    expect(() => JSON.parse(result.out)).not.toThrow();
  });
});

describe("install-hook never damages settings it cannot understand", () => {
  function homeWith(contents: string): string {
    const home = mkdtempSync(join(tmpdir(), "rh-hook-safe-"));
    writeFileSync(join(home, "settings.json"), contents);
    return home;
  }

  test("refuses to touch a settings file it cannot parse", async () => {
    const original = '{\n  // a comment makes this invalid JSON\n  "statusLine": {"type":"command"}\n}';
    const home = homeWith(original);
    const result = await run(["install-hook", "--claude-home", home]);
    expect(result.code).toBe(2);
    expect(readFileSync(join(home, "settings.json"), "utf8")).toBe(original);
  });

  test("keeps the first backup rather than overwriting it", async () => {
    const home = homeWith(JSON.stringify({ statusLine: { type: "command" }, hooks: {} }, null, 2));
    await run(["install-hook", "--claude-home", home]);
    await run(["uninstall-hook", "--claude-home", home]);
    const backup = readFileSync(join(home, "settings.json.red-handed-backup"), "utf8");
    expect(backup).toContain("statusLine");
  });

  test("keeps every unrelated setting", async () => {
    const home = homeWith(
      JSON.stringify({ statusLine: { type: "command" }, permissions: { deny: ["rm"] } }, null, 2),
    );
    await run(["install-hook", "--claude-home", home]);
    const settings = JSON.parse(readFileSync(join(home, "settings.json"), "utf8")) as {
      statusLine?: unknown;
      permissions?: { deny?: string[] };
    };
    expect(settings.statusLine).toBeDefined();
    expect(settings.permissions?.deny).toEqual(["rm"]);
  });

  test("reports a filesystem problem instead of crashing", async () => {
    const home = mkdtempSync(join(tmpdir(), "rh-hook-ro-"));
    writeFileSync(join(home, "settings.json"), "{}");
    chmodSync(join(home, "settings.json"), 0o444);
    const result = await run(["install-hook", "--claude-home", home]);
    chmodSync(join(home, "settings.json"), 0o644);
    expect(result.code).toBe(2);
    expect(result.err).not.toContain("at Object");
  });

  test("installs where CLAUDE_CONFIG_DIR points, not somewhere else", async () => {
    const home = mkdtempSync(join(tmpdir(), "rh-hook-env-"));
    const result = await run(["install-hook"], { CLAUDE_CONFIG_DIR: home });
    expect(result.code).toBe(0);
    expect(readFileSync(join(home, "settings.json"), "utf8")).toContain("red-handed");
  });
});

describe("secrets are masked before anything is quoted", () => {
  test.each([
    ["export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123", "ghp_"],
    ["curl -H 'Authorization: Bearer sk-proj-abcdef123456'", "sk-proj"],
    ["psql postgres://admin:hunter2@db.example.com/app", "hunter2"],
    ["AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY", "wJalrXUtn"],
  ])("masks %j", (text, secret) => {
    const masked = excerpt(text);
    expect(masked).not.toContain(secret);
    expect(masked).toContain("REDACTED");
  });

  test("leaves ordinary command text alone", () => {
    expect(excerpt("npx vitest run test/cart.test.ts")).toBe("npx vitest run test/cart.test.ts");
  });
});
