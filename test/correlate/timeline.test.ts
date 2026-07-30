import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { session } from "../fixtures/session-builder.js";
import { normalize } from "../../src/session/normalize.js";
import {
  attachTestRuns,
  buildFileStates,
  editsBetween,
  lastTestRunBefore,
} from "../../src/correlate/timeline.js";
import { createWorktreeReader } from "../../src/correlate/worktree.js";
import { vitestFail, vitestPass } from "../fixtures/test-output.js";
import type { AgentAction, CommandAction } from "../../src/types.js";

async function actionsOf(b: ReturnType<typeof session>): Promise<AgentAction[]> {
  const { transcriptPath } = b.writeTo();
  const { actions } = await normalize(transcriptPath);
  return attachTestRuns(actions);
}

function repoWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "rh-worktree-"));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe("buildFileStates", () => {
  test("groups a file's edits in the order they happened", async () => {
    const actions = await actionsOf(
      session()
        .edit("/repo/a.ts", "one", "two", { originalFile: "one\n" })
        .edit("/repo/b.ts", "x", "y", { originalFile: "x\n" })
        .edit("/repo/a.ts", "two", "three", { originalFile: "two\n" }),
    );
    const states = buildFileStates(actions);
    expect(states.get("/repo/a.ts")?.edits).toHaveLength(2);
    expect(states.get("/repo/b.ts")?.edits).toHaveLength(1);
    expect(states.get("/repo/a.ts")?.edits[1]?.newString).toBe("three");
  });

  test("records where something outside the agent's edits changed the file", async () => {
    const actions = await actionsOf(
      session()
        .edit("/repo/a.ts", "one", "two", { originalFile: "one\n" })
        .edit("/repo/a.ts", "unrelated", "other", { originalFile: "unrelated\n" }),
    );
    const state = buildFileStates(actions).get("/repo/a.ts");
    expect(state?.externalChangeAt).toHaveLength(1);
  });
});

describe("attachTestRuns", () => {
  test("marks a command that ran tests", async () => {
    const actions = await actionsOf(session().bash("npx vitest run", { stdout: vitestPass() }));
    const command = actions.find((a): a is CommandAction => a.kind === "command");
    expect(command?.testRun?.status).toBe("passed");
  });

  test("leaves an ordinary command alone", async () => {
    const actions = await actionsOf(session().bash("npm run build", { stdout: "done" }));
    const command = actions.find((a): a is CommandAction => a.kind === "command");
    expect(command?.testRun).toBeUndefined();
  });
});

describe("lastTestRunBefore", () => {
  test("finds the nearest run that happened before a point", async () => {
    const actions = await actionsOf(
      session()
        .bash("npx vitest run", { stdout: vitestPass() })
        .bash("npx vitest run", { stdout: vitestFail() })
        .say("All tests pass."),
    );
    const claim = actions.find((a) => a.kind === "assistant-text");
    const run = lastTestRunBefore(actions, claim?.seq ?? 0);
    expect(run?.testRun?.status).toBe("failed");
  });

  test("ignores a run that happened after the point", async () => {
    const actions = await actionsOf(
      session().say("All tests pass.").bash("npx vitest run", { stdout: vitestPass() }),
    );
    const claim = actions.find((a) => a.kind === "assistant-text");
    expect(lastTestRunBefore(actions, claim?.seq ?? 0)).toBeNull();
  });

  test("returns nothing when no tests ever ran", async () => {
    const actions = await actionsOf(session().say("All tests pass."));
    expect(lastTestRunBefore(actions, 99)).toBeNull();
  });
});

describe("editsBetween", () => {
  test("lists edits that happened in a window", async () => {
    const actions = await actionsOf(
      session()
        .bash("npx vitest run", { stdout: vitestFail() })
        .edit("/repo/src/cart.ts", "a", "b")
        .say("All tests pass."),
    );
    const run = actions.find((a): a is CommandAction => a.kind === "command");
    const claim = actions.find((a) => a.kind === "assistant-text");
    const edits = editsBetween(actions, run?.seq ?? 0, claim?.seq ?? 0);
    expect(edits.map((e) => e.filePath)).toEqual(["/repo/src/cart.ts"]);
  });

  test("excludes edits outside the window", async () => {
    const actions = await actionsOf(
      session()
        .edit("/repo/src/early.ts", "a", "b")
        .bash("npx vitest run", { stdout: vitestFail() })
        .say("All tests pass."),
    );
    const run = actions.find((a): a is CommandAction => a.kind === "command");
    const claim = actions.find((a) => a.kind === "assistant-text");
    expect(editsBetween(actions, run?.seq ?? 0, claim?.seq ?? 0)).toHaveLength(0);
  });
});

describe("worktree reader", () => {
  test("finds the line a snippet sits on today", () => {
    const repo = repoWith({ "src/cart.test.ts": "line one\nline two\nexpect(total).toBe(11)\n" });
    const reader = createWorktreeReader(repo);
    expect(reader.locate(join(repo, "src/cart.test.ts"), "expect(total).toBe(11)")).toEqual({
      line: 3,
      snippet: "expect(total).toBe(11)",
    });
  });

  test("reports nothing when the snippet is gone", () => {
    const repo = repoWith({ "src/cart.test.ts": "expect(total).toBe(8)\n" });
    const reader = createWorktreeReader(repo);
    expect(reader.locate(join(repo, "src/cart.test.ts"), "expect(total).toBe(11)")).toBeNull();
  });

  test("still finds a snippet whose indentation changed", () => {
    const repo = repoWith({ "a.ts": "describe(() => {\n      it.skip('x', () => {})\n})\n" });
    const reader = createWorktreeReader(repo);
    expect(reader.locate(join(repo, "a.ts"), "  it.skip('x', () => {})")?.line).toBe(2);
  });

  test("reports nothing for a file that no longer exists", () => {
    const repo = repoWith({});
    const reader = createWorktreeReader(repo);
    expect(reader.read(join(repo, "gone.ts"))).toBeNull();
    expect(reader.locate(join(repo, "gone.ts"), "anything")).toBeNull();
  });

  test("shows paths relative to the repository", () => {
    const repo = repoWith({ "src/a.ts": "x\n" });
    const reader = createWorktreeReader(repo);
    expect(reader.relative(join(repo, "src/a.ts"))).toBe("src/a.ts");
  });
});
