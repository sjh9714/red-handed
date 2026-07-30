import { describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { diffActions } from "../../src/git/audit.js";
import { findRepoRoot } from "../../src/git/repo.js";
import { buildContext } from "../../src/correlate/context.js";
import { runDetectors } from "../../src/detectors/index.js";

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
}

function newRepo(files: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), "rh-git-"));
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  write(repo, files);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "initial");
  return repo;
}

function write(repo: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const full = join(repo, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}

describe("findRepoRoot", () => {
  test("finds the repository a directory belongs to", () => {
    const repo = newRepo({ "a.ts": "one\n" });
    mkdirSync(join(repo, "src/deep"), { recursive: true });
    expect(findRepoRoot(join(repo, "src/deep"))).toBe(findRepoRoot(repo));
  });

  test("reports nothing outside a repository", () => {
    expect(findRepoRoot(mkdtempSync(join(tmpdir(), "rh-norepo-")))).toBeNull();
  });
});

describe("diffActions", () => {
  test("turns an uncommitted change into an edit with its added lines", () => {
    const repo = newRepo({ "test/a.test.ts": "it('works', () => {})\n" });
    write(repo, { "test/a.test.ts": "it.skip('works', () => {})\n" });

    const actions = diffActions(repo);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.filePath).toBe(join(repo, "test/a.test.ts"));
    const added = actions[0]?.patch.flatMap((h) => h.lines).filter((l) => l.startsWith("+"));
    expect(added?.join("\n")).toContain("it.skip");
  });

  test("records a new file as a create", () => {
    const repo = newRepo({ "a.ts": "one\n" });
    write(repo, { "b.ts": "two\n" });
    execFileSync("git", ["add", "-A"], { cwd: repo });

    const actions = diffActions(repo);
    const created = actions.find((a) => a.filePath.endsWith("b.ts"));
    expect(created?.opType).toBe("create");
  });

  test("reads a commit range", () => {
    const repo = newRepo({ "a.ts": "one\n" });
    write(repo, { "a.ts": "two\n" });
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "second");

    const actions = diffActions(repo, "HEAD~1..HEAD");
    expect(actions).toHaveLength(1);
    expect(actions[0]?.patch[0]?.lines.some((l) => l === "+two")).toBe(true);
  });

  test("says nothing when the tree is clean", () => {
    expect(diffActions(newRepo({ "a.ts": "one\n" }))).toEqual([]);
  });

  test("audits a diff with no transcript, and never claims certainty", () => {
    const repo = newRepo({ "test/a.test.ts": "it('works', () => {})\n" });
    write(repo, { "test/a.test.ts": "it.only('works', () => {})\n" });

    const context = buildContext({
      actions: diffActions(repo),
      repoRoot: repo,
      mode: "git-only",
    });
    const findings = runDetectors(context);
    expect(findings.map((f) => f.detector)).toContain("skip-only");
    // `.only` is normally a certainty; without a transcript nothing can be.
    expect(findings.every((f) => f.tier === "SUSPICIOUS")).toBe(true);
  });

  test("keeps quiet about a file that was deleted", () => {
    const repo = newRepo({ "a.ts": "one\n", "b.ts": "two\n" });
    execFileSync("git", ["rm", "-q", "b.ts"], { cwd: repo });
    expect(diffActions(repo).map((a) => a.filePath)).not.toContain(join(repo, "b.ts"));
  });
});
