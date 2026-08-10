import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fixCommand } from "../src/fix-hook.js";
import { installFix, uninstallFix } from "../src/commands/hook.js";

/**
 * This hook rewrites commands the agent is about to run. A wrong rewrite costs
 * more than the hook will ever save, so the rules here are the product: fix
 * exactly the result-eating pipe, and refuse everything it cannot be sure of.
 */

describe("what it fixes", () => {
  const fixed: Array<[string, string]> = [
    ["npx vitest run 2>&1 | tail -5", "npx vitest run 2>&1"],
    ["npm test 2>&1 | tail -20", "npm test 2>&1"],
    ["pnpm test 2>&1 | grep -E 'Tests|Duration'", "pnpm test 2>&1"],
    ["python3 -m pytest tests/ | head -30", "python3 -m pytest tests/"],
    ["go test ./... 2>&1 | tail -n 40", "go test ./... 2>&1"],
    ["cargo test 2>&1 | sed -n '1,20p'", "cargo test 2>&1"],
    // node's built-in runner. A \b before the hyphens can never match, which
    // is exactly how the first version missed this one in a live session.
    ["node --test ./missing-dir 2>&1 | tail -1", "node --test ./missing-dir 2>&1"],
    // Two eaters stacked: both go.
    ["npx vitest run 2>&1 | grep -v warning | tail -5", "npx vitest run 2>&1"],
    // Earlier statements stay untouched; only the test statement is cleaned.
    ["npm run build && npx vitest run 2>&1 | tail -5", "npm run build && npx vitest run 2>&1"],
  ];
  test.each(fixed)("%s", (before, after) => {
    expect(fixCommand(before)).toBe(after);
  });
});

describe("what it refuses to touch", () => {
  const untouched: string[] = [
    // Not a test command: cutting ls output is none of this hook's business.
    "ls -la | head -5",
    "git log --oneline | head -20",
    // No pipe at all.
    "npx vitest run",
    // The filter's exit code or count is the point; removing it changes meaning.
    "npm test 2>&1 | grep -q 'passed'",
    "npm test 2>&1 | grep -c FAIL",
    // The pipe is not the final stage of the final statement.
    "npx vitest run | tail -5 && echo done",
    // The pipe feeds something that is not a truncating filter.
    "npm test 2>&1 | tee test.log",
    "npm test 2>&1 | grep FAIL | wc -l",
    // Inside quotes: that pipe belongs to the string, not the shell.
    "node -e \"console.log('a | tail -5')\" # test",
    // Heredocs carry bodies this parser does not read.
    "python3 - <<PY | tail -3\nimport pytest\nPY",
    // sed without -n transforms; it does not eat lines.
    "npm test 2>&1 | sed 's/passed/ok/'",
    // tail -f follows; removing it changes what the command is.
    "npm test 2>&1 | tail -f",
    // Command substitution keeps its own pipes.
    "echo \"$(npm test | tail -1)\"",
  ];
  test.each(untouched)("%s", (command) => {
    expect(fixCommand(command)).toBeNull();
  });

  test("unbalanced quoting is left alone rather than guessed at", () => {
    expect(fixCommand("npm test 2>&1 | tail -5 '")).toBeNull();
  });
});

describe("the standalone script", () => {
  const script = join(__dirname, "..", "dist", "fix-hook.js");

  const run = (input: unknown): string =>
    execFileSync(process.execPath, [script], {
      input: JSON.stringify(input),
      encoding: "utf8",
    });

  test("answers with the fixed command and nothing else", () => {
    const out = run({
      tool_name: "Bash",
      tool_input: { command: "npx vitest run 2>&1 | tail -5", description: "run tests" },
    });
    const parsed = JSON.parse(out) as {
      hookSpecificOutput: {
        hookEventName: string;
        updatedInput: { command: string; description: string };
        permissionDecision?: string;
      };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.updatedInput.command).toBe("npx vitest run 2>&1");
    // The other fields ride along unchanged.
    expect(parsed.hookSpecificOutput.updatedInput.description).toBe("run tests");
    // Never a permission decision: the user's prompt flow stays theirs.
    expect(out).not.toContain("permissionDecision");
  });

  test("stays silent for commands it has nothing to say about", () => {
    expect(run({ tool_name: "Bash", tool_input: { command: "ls | head -3" } })).toBe("");
  });

  test("stays silent for other tools", () => {
    expect(run({ tool_name: "Read", tool_input: { file_path: "/tmp/x | tail -5" } })).toBe("");
  });

  test("garbage on stdin exits zero and says nothing", () => {
    expect(run("not json" as unknown)).toBe("");
  });
});

describe("the plugin copy", () => {
  test("the committed hook script is the built one", () => {
    // The plugin runs hooks/fix-pipes.mjs straight from the checkout, because
    // dist/ is not committed. If someone edits src/fix-hook.ts and forgets to
    // build, the installed plugin would run stale logic. This pins the two
    // files equal; the build itself keeps them so.
    const built = readFileSync(join(__dirname, "..", "dist", "fix-hook.js"), "utf8");
    const shipped = readFileSync(join(__dirname, "..", "hooks", "fix-pipes.mjs"), "utf8");
    expect(shipped).toBe(built);
  });

  test("hooks.json points at files that exist and nothing that does not", () => {
    const raw = readFileSync(join(__dirname, "..", "hooks", "hooks.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    };
    const commands = Object.values(parsed.hooks)
      .flat()
      .flatMap((group) => group.hooks.map((h) => h.command));
    for (const command of commands) {
      const local = /\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+?)"/.exec(command);
      if (local) {
        expect(existsSync(join(__dirname, "..", local[1] as string))).toBe(true);
      }
    }
    // The fix hook must be scoped to Bash; running it on every tool would be noise.
    expect(parsed.hooks.PreToolUse?.[0]?.matcher).toBe("Bash");
  });
});

describe("fix installs and unfix removes, nothing else", () => {
  test("round trip leaves the settings as they were", () => {
    const home = mkdtempSync(join(tmpdir(), "rh-fix-"));
    const rhHome = mkdtempSync(join(tmpdir(), "rh-fix-home-"));
    const env = { RED_HANDED_HOME: rhHome };
    const settings = join(home, "settings.json");
    writeFileSync(
      settings,
      `${JSON.stringify(
        {
          model: "opus",
          hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-own-hook" }] }] },
        },
        null,
        2,
      )}\n`,
    );

    const installed = installFix(home, { env });
    expect(installed.changed).toBe(true);
    const after = JSON.parse(readFileSync(settings, "utf8")) as {
      model: string;
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string; installedBy?: string }> }> };
    };
    expect(after.model).toBe("opus");
    expect(after.hooks.PreToolUse).toHaveLength(2);
    expect(after.hooks.PreToolUse[1]?.hooks[0]?.command).toContain("fix-pipes.mjs");
    // The copied script really is the built hook, runnable as it stands.
    const copied = readFileSync(join(rhHome, "fix-pipes.mjs"), "utf8");
    expect(copied).toContain("hookSpecificOutput");

    expect(installFix(home, { env }).changed).toBe(false);

    const removed = uninstallFix(home, { env });
    expect(removed.changed).toBe(true);
    const restored = JSON.parse(readFileSync(settings, "utf8")) as {
      hooks: { PreToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    // The user's own hook survives; only ours is gone.
    expect(restored.hooks.PreToolUse).toHaveLength(1);
    expect(restored.hooks.PreToolUse[0]?.hooks[0]?.command).toBe("my-own-hook");
  });
});
