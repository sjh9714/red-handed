import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session } from "../fixtures/session-builder.js";
import { flattenPath, sessionsForCwd } from "../../src/session/discover.js";

function claudeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "rh-home-"));
  mkdirSync(join(home, "projects"), { recursive: true });
  return home;
}

function writeSession(home: string, cwd: string, id: string): void {
  const dir = join(home, "projects", flattenPath(cwd));
  mkdirSync(dir, { recursive: true });
  session({ cwd, sessionId: id }).say("hello").writeTo(dir);
}

describe("flattenPath", () => {
  test("replaces every character that is not a letter or digit", () => {
    expect(flattenPath("/Users/me/Projects/Agent-Gate")).toBe("-Users-me-Projects-Agent-Gate");
  });
});

describe("sessionsForCwd", () => {
  test("finds the sessions recorded for a directory", () => {
    const home = claudeHome();
    writeSession(home, "/work/app", "11111111-1111-1111-1111-111111111111");
    const found = sessionsForCwd("/work/app", { claudeHome: home });
    expect(found).toHaveLength(1);
    expect(found[0]?.cwd).toBe("/work/app");
  });

  test("finds sessions that were started in a subdirectory of the repository", () => {
    const home = claudeHome();
    writeSession(home, "/work/app/packages/cli", "22222222-2222-2222-2222-222222222222");
    expect(sessionsForCwd("/work/app", { claudeHome: home })).toHaveLength(1);
  });

  test("keeps apart two directories that flatten to the same name", () => {
    const home = claudeHome();
    // "/work/np-watch" and "/work/np/watch" both flatten to "-work-np-watch".
    writeSession(home, "/work/np-watch", "33333333-3333-3333-3333-333333333333");
    writeSession(home, "/work/np/watch", "44444444-4444-4444-4444-444444444444");

    const found = sessionsForCwd("/work/np-watch", { claudeHome: home });
    expect(found).toHaveLength(1);
    expect(found[0]?.cwd).toBe("/work/np-watch");
  });

  test("reports nothing for a directory with no sessions", () => {
    expect(sessionsForCwd("/work/other", { claudeHome: claudeHome() })).toEqual([]);
  });

  test("puts the most recent session first", async () => {
    const home = claudeHome();
    writeSession(home, "/work/app", "aaaaaaaa-1111-1111-1111-111111111111");
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeSession(home, "/work/app", "bbbbbbbb-2222-2222-2222-222222222222");

    const found = sessionsForCwd("/work/app", { claudeHome: home });
    expect(found[0]?.sessionId.startsWith("bbbbbbbb")).toBe(true);
  });

  // 9 of 187 real transcripts on this machine open with a very large first
  // record, and one of them was newer than the session the CLI would otherwise
  // have offered — so the default audit silently examined the wrong session.
  test("finds a session whose opening record is enormous", () => {
    const home = claudeHome();
    const dir = join(home, "projects", flattenPath("/work/app"));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "99999999-9999-9999-9999-999999999999.jsonl");
    const huge = JSON.stringify({ type: "attachment", blob: "x".repeat(200_000) });
    const real = JSON.stringify({
      type: "assistant",
      cwd: "/work/app",
      uuid: "u1",
      timestamp: "2026-07-23T21:00:00.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
    });
    writeFileSync(path, `${huge}\n${real}\n`);

    const found = sessionsForCwd("/work/app", { claudeHome: home });
    expect(found.map((s) => s.sessionId)).toContain("99999999-9999-9999-9999-999999999999");
  });

  test("does not claim a session that belongs to another directory", () => {
    const home = claudeHome();
    const dir = join(home, "projects", flattenPath("/work/app"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "88888888-8888-8888-8888-888888888888.jsonl"),
      `${JSON.stringify({ type: "assistant", cwd: "/somewhere/else", uuid: "u1" })}\n`,
    );
    expect(sessionsForCwd("/work/app", { claudeHome: home })).toHaveLength(0);
  });

  test("lists the subagent transcripts belonging to a session", () => {
    const home = claudeHome();
    const dir = join(home, "projects", flattenPath("/work/app"));
    mkdirSync(dir, { recursive: true });
    session({ cwd: "/work/app", sessionId: "cccccccc-3333-3333-3333-333333333333" })
      .say("delegating")
      .subagent("a1", (s) => s.bash("npm test", { stdout: "ok" }))
      .writeTo(dir);

    const found = sessionsForCwd("/work/app", { claudeHome: home });
    expect(found[0]?.subagentPaths).toHaveLength(1);
  });
});
