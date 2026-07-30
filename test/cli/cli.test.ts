import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "../../src/cli.js";
import { flattenPath } from "../../src/session/discover.js";
import { session } from "../fixtures/session-builder.js";
import { vitestFail } from "../fixtures/test-output.js";

interface Run {
  code: number;
  out: string;
  err: string;
}

async function run(argv: string[], env: Record<string, string> = {}): Promise<Run> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    env: { NO_COLOR: "1", ...env },
  });
  return { code, out, err };
}

/** A repository with a Claude Code session that faked a passing test. */
function repoWithCheatingSession(): { repo: string; home: string } {
  const repo = mkdtempSync(join(tmpdir(), "rh-cli-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "T"], { cwd: repo });

  const testFile = join(repo, "test/cart.test.ts");
  mkdirSync(dirname(testFile), { recursive: true });
  writeFileSync(testFile, "expect(total()).toBe(11)\n");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: repo });

  const home = mkdtempSync(join(tmpdir(), "rh-cli-home-"));
  const projectDir = join(home, "projects", flattenPath(repo));
  mkdirSync(projectDir, { recursive: true });
  session({ cwd: repo, sessionId: "deadbeef-1111-2222-3333-444444444444" })
    .bash("npx vitest run", { stdout: vitestFail({ expected: "8", received: "11" }) })
    .edit(testFile, "expect(total()).toBe(8)", "expect(total()).toBe(11)")
    .say("All tests pass now.")
    .writeTo(projectDir);

  return { repo, home };
}

describe("red-handed", () => {
  test("audits the current project and fails when something was caught", async () => {
    const { repo, home } = repoWithCheatingSession();
    const result = await run(["--cwd", repo, "--claude-home", home]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("CAUGHT");
    expect(result.out).toContain("test/cart.test.ts");
  });

  test("writes machine-readable findings on request", async () => {
    const { repo, home } = repoWithCheatingSession();
    const result = await run(["--cwd", repo, "--claude-home", home, "--json"]);
    const parsed = JSON.parse(result.out) as { summary: { caught: number } };
    expect(parsed.summary.caught).toBeGreaterThan(0);
  });

  test("writes markdown on request", async () => {
    const { repo, home } = repoWithCheatingSession();
    const result = await run(["--cwd", repo, "--claude-home", home, "--md"]);
    expect(result.out).toContain("## red-handed");
  });

  test("speaks the language it is asked to", async () => {
    const { repo, home } = repoWithCheatingSession();
    const result = await run(["--cwd", repo, "--claude-home", home, "--lang", "ko"]);
    expect(result.out).toContain("확인할 것");
  });

  test("can be told not to fail the command", async () => {
    const { repo, home } = repoWithCheatingSession();
    const result = await run(["--cwd", repo, "--claude-home", home, "--fail-on", "never"]);
    expect(result.code).toBe(0);
  });

  test("can run a single detector", async () => {
    const { repo, home } = repoWithCheatingSession();
    const result = await run([
      "--cwd",
      repo,
      "--claude-home",
      home,
      "--json",
      "--detectors",
      "no-verify",
    ]);
    const parsed = JSON.parse(result.out) as { findings: unknown[] };
    expect(parsed.findings).toHaveLength(0);
  });

  test("lists the sessions it can see", async () => {
    const { repo, home } = repoWithCheatingSession();
    const result = await run(["sessions", "--cwd", repo, "--claude-home", home]);
    expect(result.out).toContain("deadbeef");
    expect(result.code).toBe(0);
  });

  test("explains itself", async () => {
    const result = await run(["--help"]);
    expect(result.out).toContain("red-handed");
    expect(result.out).toContain("--git-only");
    expect(result.code).toBe(0);
  });

  test("reports its version", async () => {
    const result = await run(["--version"]);
    expect(result.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("rejects an option it does not know", async () => {
    const result = await run(["--nonsense"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("--nonsense");
  });

  test("says so plainly when there is no session for this directory", async () => {
    const empty = mkdtempSync(join(tmpdir(), "rh-empty-"));
    const home = mkdtempSync(join(tmpdir(), "rh-home-empty-"));
    mkdirSync(join(home, "projects"), { recursive: true });
    const result = await run(["--cwd", empty, "--claude-home", home]);
    expect(result.err).toMatch(/no session/i);
    expect(result.code).toBe(0);
  });

  test("audits a diff when asked to work without a transcript", async () => {
    const repo = mkdtempSync(join(tmpdir(), "rh-gitonly-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["config", "user.email", "t@e.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "T"], { cwd: repo });
    const testFile = join(repo, "test/a.test.ts");
    mkdirSync(dirname(testFile), { recursive: true });
    writeFileSync(testFile, "it('works', () => {})\n");
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: repo });
    writeFileSync(testFile, "it.only('works', () => {})\n");

    const result = await run(["--cwd", repo, "--git-only"]);
    expect(result.out).toContain("SUSPICIOUS");
    expect(result.out).toContain("skip-only");
  });
});

describe("red-handed stats", () => {
  test("counts findings across every session on the machine", async () => {
    const { home } = repoWithCheatingSession();
    const result = await run(["stats", "--claude-home", home, "--json"]);
    const parsed = JSON.parse(result.out) as {
      sessionsScanned: number;
      summary: { caught: number };
    };
    expect(parsed.sessionsScanned).toBeGreaterThan(0);
    expect(parsed.summary.caught).toBeGreaterThan(0);
  });
});

describe("red-handed install-hook", () => {
  function homeWithSettings(settings: unknown): string {
    const home = mkdtempSync(join(tmpdir(), "rh-hook-"));
    writeFileSync(join(home, "settings.json"), JSON.stringify(settings, null, 2));
    return home;
  }

  test("adds a Stop hook without touching the ones already there", async () => {
    const home = homeWithSettings({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-hook.sh" }] }] },
    });
    const result = await run(["install-hook", "--claude-home", home]);
    expect(result.code).toBe(0);

    const settings = JSON.parse(readFileSync(join(home, "settings.json"), "utf8")) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    const commands = settings.hooks.Stop.flatMap((entry) => entry.hooks.map((h) => h.command));
    expect(commands).toContain("existing-hook.sh");
    expect(commands.some((c) => c.includes("red-handed"))).toBe(true);
  });

  test("keeps a backup of the settings it changed", async () => {
    const home = homeWithSettings({ hooks: {} });
    await run(["install-hook", "--claude-home", home]);
    expect(readFileSync(join(home, "settings.json.red-handed-backup"), "utf8")).toContain("hooks");
  });

  test("does not add itself twice", async () => {
    const home = homeWithSettings({ hooks: {} });
    await run(["install-hook", "--claude-home", home]);
    await run(["install-hook", "--claude-home", home]);
    const settings = JSON.parse(readFileSync(join(home, "settings.json"), "utf8")) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    const mine = settings.hooks.Stop.flatMap((e) => e.hooks).filter((h) =>
      h.command.includes("red-handed"),
    );
    expect(mine).toHaveLength(1);
  });

  test("takes itself back out again", async () => {
    const home = homeWithSettings({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "existing-hook.sh" }] }] },
    });
    await run(["install-hook", "--claude-home", home]);
    await run(["uninstall-hook", "--claude-home", home]);
    const settings = JSON.parse(readFileSync(join(home, "settings.json"), "utf8")) as {
      hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> };
    };
    const commands = settings.hooks.Stop.flatMap((e) => e.hooks.map((h) => h.command));
    expect(commands).toEqual(["existing-hook.sh"]);
  });
});
