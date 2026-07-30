import { describe, expect, test } from "vitest";
import { session } from "../fixtures/session-builder.js";
import { normalize } from "../../src/session/normalize.js";
import type { CommandAction, FileEditAction, TodoUpdateAction } from "../../src/types.js";

function kinds(actions: Array<{ kind: string }>): string[] {
  return actions.map((a) => a.kind);
}

async function normalizeBuilt(b: ReturnType<typeof session>) {
  const { transcriptPath } = b.writeTo();
  return normalize(transcriptPath);
}

describe("normalize: commands", () => {
  test("pairs a command with its output", async () => {
    const result = await normalizeBuilt(
      session().bash("npm test", { stdout: "Tests: 3 passed, 3 total" }),
    );
    const cmd = result.actions.find((a): a is CommandAction => a.kind === "command");
    expect(cmd?.command).toBe("npm test");
    expect(cmd?.stdout).toBe("Tests: 3 passed, 3 total");
    expect(cmd?.exitCode).toBe(0);
    expect(cmd?.isError).toBe(false);
  });

  test("recovers the exit code from an 'Error: Exit code N' result", async () => {
    const result = await normalizeBuilt(
      session().bash("npm test", { exitCode: 1, stdout: "Tests: 1 failed" }),
    );
    const cmd = result.actions.find((a): a is CommandAction => a.kind === "command");
    expect(cmd?.exitCode).toBe(1);
    expect(cmd?.isError).toBe(true);
    expect(cmd?.stdout).toContain("Tests: 1 failed");
  });

  test("leaves the exit code unknown for a blocked command", async () => {
    const result = await normalizeBuilt(
      session().bash("rm -rf /", { blocked: "Permission for this action was denied" }),
    );
    const cmd = result.actions.find((a): a is CommandAction => a.kind === "command");
    expect(cmd?.exitCode).toBeNull();
  });

  test("pairs by tool_use_id when results arrive out of order", async () => {
    const b = session();
    const first = b.bashDeferred("echo first");
    const second = b.bashDeferred("echo second");
    b.resolveBash(second, { stdout: "second done" });
    b.resolveBash(first, { stdout: "first done" });

    const result = await normalizeBuilt(b);
    const commands = result.actions.filter((a): a is CommandAction => a.kind === "command");
    const firstCmd = commands.find((c) => c.command === "echo first");
    const secondCmd = commands.find((c) => c.command === "echo second");
    expect(firstCmd?.stdout).toBe("first done");
    expect(secondCmd?.stdout).toBe("second done");
  });

  test("keeps a command that never received a result", async () => {
    const b = session();
    b.bashDeferred("npm test");
    const result = await normalizeBuilt(b);
    const cmd = result.actions.find((a): a is CommandAction => a.kind === "command");
    expect(cmd?.command).toBe("npm test");
    expect(cmd?.exitCode).toBeNull();
    expect(cmd?.stdout).toBe("");
  });
});

describe("normalize: edits", () => {
  test("captures the before and after strings of an edit", async () => {
    const result = await normalizeBuilt(
      session().edit("/repo/a.ts", "const x = 1", "const x = 2", { startLine: 12 }),
    );
    const edit = result.actions.find((a): a is FileEditAction => a.kind === "file-edit");
    expect(edit?.filePath).toBe("/repo/a.ts");
    expect(edit?.oldString).toBe("const x = 1");
    expect(edit?.newString).toBe("const x = 2");
    expect(edit?.tool).toBe("Edit");
    expect(edit?.patch[0]?.newStart).toBe(12);
  });

  test("drops an edit whose result was an error, because it never applied", async () => {
    const result = await normalizeBuilt(
      session().edit("/repo/a.ts", "missing", "replacement", { failed: true }),
    );
    expect(kinds(result.actions)).not.toContain("file-edit");
  });

  test("records a Write as a create", async () => {
    const result = await normalizeBuilt(session().write("/repo/new.ts", "export const a = 1;"));
    const edit = result.actions.find((a): a is FileEditAction => a.kind === "file-edit");
    expect(edit?.tool).toBe("Write");
    expect(edit?.opType).toBe("create");
    expect(edit?.newString).toBe("export const a = 1;");
  });

  test("flags an edit whose base no longer contains the previous edit's result", async () => {
    const b = session()
      .edit("/repo/a.ts", "one", "two", { originalFile: "one\n" })
      .edit("/repo/a.ts", "three", "four", { originalFile: "three\n" });
    const result = await normalizeBuilt(b);
    const edits = result.actions.filter((a): a is FileEditAction => a.kind === "file-edit");
    expect(edits[0]?.precededByExternalChange).toBe(false);
    expect(edits[1]?.precededByExternalChange).toBe(true);
  });

  test("does not flag consecutive edits that build on each other", async () => {
    const b = session()
      .edit("/repo/a.ts", "one", "two", { originalFile: "one\nrest\n" })
      .edit("/repo/a.ts", "rest", "last", { originalFile: "two\nrest\n" });
    const result = await normalizeBuilt(b);
    const edits = result.actions.filter((a): a is FileEditAction => a.kind === "file-edit");
    expect(edits[1]?.precededByExternalChange).toBe(false);
  });
});

describe("normalize: speech", () => {
  test("captures assistant prose", async () => {
    const result = await normalizeBuilt(session().say("All tests pass."));
    const said = result.actions.filter((a) => a.kind === "assistant-text");
    expect(said).toHaveLength(1);
  });

  test("never captures private reasoning as speech", async () => {
    const result = await normalizeBuilt(
      session().think("I have no idea whether the tests pass.").say("Done."),
    );
    const texts = result.actions
      .filter((a) => a.kind === "assistant-text")
      .map((a) => (a as { text: string }).text);
    expect(texts).toEqual(["Done."]);
  });

  test("captures the user's own prompts", async () => {
    const result = await normalizeBuilt(session().user("please skip that test"));
    const user = result.actions.find((a) => a.kind === "user-message");
    expect((user as { text: string }).text).toBe("please skip that test");
  });
});

describe("normalize: todos and hooks", () => {
  test("reports which todos moved to completed", async () => {
    const result = await normalizeBuilt(session().todoComplete("Fix the cart bug"));
    const todo = result.actions.find((a): a is TodoUpdateAction => a.kind === "todo-update");
    expect(todo?.completed).toEqual(["Fix the cart bug"]);
  });

  test("captures a hook run as independent evidence", async () => {
    const result = await normalizeBuilt(session().hookSuccess("npm test", 0, "3 passed"));
    const hook = result.actions.find((a) => a.kind === "hook");
    expect(hook).toBeDefined();
    expect((hook as { command: string }).command).toBe("npm test");
  });
});

describe("normalize: subagents and tolerance", () => {
  test("merges subagent transcripts and tags them with the agent id", async () => {
    const b = session()
      .say("delegating")
      .subagent("a1", (s) => s.bash("npm test", { stdout: "Tests: 5 passed, 5 total" }));
    const { transcriptPath, projectDir } = b.writeTo();
    void projectDir;
    const result = await normalize(transcriptPath);
    const cmd = result.actions.find((a): a is CommandAction => a.kind === "command");
    expect(cmd?.command).toBe("npm test");
    expect(cmd?.agentId).toBe("a1");
  });

  test("orders merged actions by time", async () => {
    const b = session()
      .say("first")
      .subagent("a1", (s) => s.say("second (subagent)"))
      .say("third");
    const { transcriptPath } = b.writeTo();
    const result = await normalize(transcriptPath);
    const texts = result.actions
      .filter((a) => a.kind === "assistant-text")
      .map((a) => (a as { text: string }).text);
    expect(texts).toEqual(["first", "second (subagent)", "third"]);
  });

  test("ignores line types it does not know", async () => {
    const result = await normalizeBuilt(
      session().unknownLine("some-future-type").say("hello"),
    );
    expect(result.unrecognizedLineTypes["some-future-type"]).toBe(1);
    expect(kinds(result.actions)).toContain("assistant-text");
  });

  test("reads cwd and version from inside the transcript", async () => {
    const result = await normalizeBuilt(
      session({ cwd: "/Users/me/project", version: "2.1.219" }).say("hi"),
    );
    expect(result.cwd).toBe("/Users/me/project");
    expect(result.versions).toContain("2.1.219");
  });
});
