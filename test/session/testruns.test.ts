import { describe, expect, test } from "vitest";
import { classifyTestCommand, detectTestRun, parseTestOutput } from "../../src/session/testruns.js";
import type { CommandAction } from "../../src/types.js";
import {
  grepped,
  jestFail,
  jestPass,
  mochaFail,
  pytestFail,
  pytestPass,
  vitestFail,
  vitestPass,
} from "../fixtures/test-output.js";

function command(cmd: string, over: Partial<CommandAction> = {}): CommandAction {
  return {
    kind: "command",
    ts: "2026-07-23T21:00:00.000Z",
    seq: 0,
    uuid: "u1",
    command: cmd,
    stdout: "",
    stderr: "",
    exitCode: 0,
    isError: false,
    interrupted: false,
    background: false,
    ...over,
  };
}

describe("classifyTestCommand", () => {
  test.each([
    ["npm test", "generic"],
    ["pnpm test", "generic"],
    ["npx vitest run", "vitest"],
    ["npx jest", "jest"],
    ["npx mocha", "mocha"],
    ["python3 -m pytest -q", "pytest"],
    ["uv run pytest", "pytest"],
    ["cd /repo && npm test", "generic"],
    ["npm run typecheck && npx vitest run", "vitest"],
    ["pnpm test 2>&1 | tail -5", "generic"],
  ])("recognises %s", (cmd, framework) => {
    expect(classifyTestCommand(cmd)?.framework).toBe(framework);
  });

  test.each([
    ["npm run build"],
    ["git commit -m 'add tests'"],
    ["echo running tests"],
    ["ls test/"],
    ["cat src/cart.test.ts"],
    ["npm run lint"],
  ])("does not mistake %s for a test run", (cmd) => {
    expect(classifyTestCommand(cmd)).toBeNull();
  });

  // Taken from a real session: the agent wrote documentation whose body contained
  // a runnable-looking command. Writing a command is not running it.
  test("ignores a command example inside a heredoc body", () => {
    const command = [
      "cat > docs/verify.md <<'EOF'",
      "## Verify",
      "pnpm test                       # 350 passed",
      "EOF",
    ].join("\n");
    expect(classifyTestCommand(command)).toBeNull();
  });

  test("ignores a command example in a heredoc even with a different delimiter", () => {
    const command = [
      "cat >> README.md <<MARKDOWN",
      "vitest run test/documentation.test.ts  # 3 passed",
      "MARKDOWN",
    ].join("\n");
    expect(classifyTestCommand(command)).toBeNull();
  });

  test("still sees a real test run that follows a heredoc block", () => {
    const command = [
      "cat > docs/verify.md <<'EOF'",
      "pnpm test  # example",
      "EOF",
      "pnpm test 2>&1 | tail -5",
    ].join("\n");
    expect(classifyTestCommand(command)?.framework).toBe("generic");
  });

  test("ignores a test command mentioned in a multi-line commit message", () => {
    const command = [
      'git commit -q -m "docs: explain the verification flow',
      "",
      "pnpm test now covers the replay path.",
      '"',
    ].join("\n");
    expect(classifyTestCommand(command)).toBeNull();
  });

  test("ignores a python heredoc that edits a test file", () => {
    const command = [
      "python3 - <<'PYEOF'",
      'p = "packages/core/test/report.test.ts"',
      "s = open(p).read()",
      "PYEOF",
    ].join("\n");
    expect(classifyTestCommand(command)).toBeNull();
  });

  test("is not confused by pipe characters inside a quoted sed expression", () => {
    expect(classifyTestCommand("sed -i '' 's|old|new|' README.md")).toBeNull();
  });

  test("still recognises a test command quoted on a single line", () => {
    expect(classifyTestCommand(`bash -c "npm test"`)?.framework).toBe("generic");
  });

  test("still recognises a test run on a later line of a multi-line script", () => {
    const command = ["set -e", "cd /repo/packages/cli", "python3 -m pytest -q"].join("\n");
    expect(classifyTestCommand(command)?.framework).toBe("pytest");
  });

  test.each([
    ["python3 -m pytest --version"],
    ["npx vitest --help"],
    ["python3 -m pytest --collect-only"],
    ["npx jest --listTests"],
  ])("does not treat %s as a run that verifies anything", (cmd) => {
    expect(classifyTestCommand(cmd)).toBeNull();
  });

  test("recognises a package script that runs tests underneath", () => {
    const info = classifyTestCommand("npm run check", { check: "tsc --noEmit && vitest run" });
    expect(info?.framework).toBe("vitest");
  });

  test("treats a whole-suite run as full scope", () => {
    expect(classifyTestCommand("npx vitest run")?.scope).toBe("full");
  });

  test.each([
    ["npx vitest run src/cart.test.ts"],
    ["npx vitest run -t 'cart total'"],
    ["python3 -m pytest -k total"],
    ["npx jest src/cart.test.js"],
  ])("treats %s as filtered scope", (cmd) => {
    expect(classifyTestCommand(cmd)?.scope).toBe("filtered");
  });
});

describe("parseTestOutput", () => {
  test("reads a passing vitest run", () => {
    const result = parseTestOutput(vitestPass({ passed: 34 }), "vitest");
    expect(result.status).toBe("passed");
    expect(result.passed).toBe(34);
    expect(result.summaryLine).toContain("34 passed");
  });

  test("reads a failing vitest run", () => {
    const result = parseTestOutput(vitestFail({ failed: 1, passed: 33 }), "vitest");
    expect(result.status).toBe("failed");
    expect(result.failed).toBe(1);
    expect(result.passed).toBe(33);
  });

  test("extracts the received value from a vitest assertion", () => {
    const result = parseTestOutput(vitestFail({ expected: "8", received: "11" }), "vitest");
    expect(result.failures[0]?.expected).toBe("8");
    expect(result.failures[0]?.received).toBe("11");
  });

  test("reads a failing jest run and its Expected/Received block", () => {
    const result = parseTestOutput(jestFail({ expected: "8", received: "11" }), "jest");
    expect(result.status).toBe("failed");
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.expected).toBe("8");
    expect(result.failures[0]?.received).toBe("11");
  });

  test("reads a passing jest run", () => {
    expect(parseTestOutput(jestPass({ passed: 12 }), "jest").status).toBe("passed");
  });

  test("reads a failing mocha run", () => {
    const result = parseTestOutput(mochaFail({ failing: 2, passing: 30 }), "mocha");
    expect(result.status).toBe("failed");
    expect(result.failed).toBe(2);
    expect(result.passed).toBe(30);
  });

  test("reads a failing pytest run and its assert line", () => {
    const result = parseTestOutput(pytestFail({ expected: "8", received: "11" }), "pytest");
    expect(result.status).toBe("failed");
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.expected).toBe("8");
    expect(result.failures[0]?.received).toBe("11");
  });

  test("reads a passing pytest run", () => {
    const result = parseTestOutput(pytestPass({ passed: 12 }), "pytest");
    expect(result.status).toBe("passed");
    expect(result.passed).toBe(12);
  });

  test("finds a framework summary even when the framework was guessed wrong", () => {
    expect(parseTestOutput(vitestPass(), "generic").status).toBe("passed");
    expect(parseTestOutput(pytestFail(), "generic").status).toBe("failed");
  });

  test("stays unknown when the summary was filtered out of the output", () => {
    const result = parseTestOutput(grepped(), "vitest");
    expect(result.status).toBe("unknown");
    expect(result.summaryLine).toBeUndefined();
  });

  test("stays unknown for empty output", () => {
    expect(parseTestOutput("", "vitest").status).toBe("unknown");
  });
});

describe("detectTestRun", () => {
  test("attaches evidence to a recognised test command", () => {
    const evidence = detectTestRun(command("npx vitest run", { stdout: vitestPass() }));
    expect(evidence?.status).toBe("passed");
    expect(evidence?.framework).toBe("vitest");
  });

  test("returns nothing for a command that is not a test run", () => {
    expect(detectTestRun(command("npm run build", { stdout: "built" }))).toBeUndefined();
  });

  test("infers pass from exit code 0 on a plain unpiped test command", () => {
    const evidence = detectTestRun(command("npx vitest run", { stdout: "", exitCode: 0 }));
    expect(evidence?.status).toBe("passed");
  });

  test("infers failure from a non-zero exit code on a plain unpiped test command", () => {
    const evidence = detectTestRun(
      command("npx vitest run", { stdout: "", exitCode: 1, isError: true }),
    );
    expect(evidence?.status).toBe("failed");
  });

  test("refuses to trust the exit code when the output was piped", () => {
    const evidence = detectTestRun(
      command("npm test 2>&1 | grep -E 'error'", { stdout: grepped(), exitCode: 0 }),
    );
    expect(evidence?.status).toBe("unknown");
  });

  test("refuses to trust the exit code of an && chain", () => {
    const evidence = detectTestRun(
      command("npm run typecheck && npx vitest run", { stdout: "", exitCode: 1, isError: true }),
    );
    expect(evidence?.status).toBe("unknown");
  });

  test("prefers the parsed summary over the exit code", () => {
    const evidence = detectTestRun(
      command("npm test 2>&1 | tail -5", { stdout: vitestFail(), exitCode: 0 }),
    );
    expect(evidence?.status).toBe("failed");
  });

  test("stays unknown when a test command was interrupted", () => {
    const evidence = detectTestRun(
      command("npx vitest run", { stdout: "", exitCode: null, interrupted: true }),
    );
    expect(evidence?.status).toBe("unknown");
  });

  test("reads the summary out of stderr when that is where it landed", () => {
    const evidence = detectTestRun(
      command("npx vitest run", { stdout: "", stderr: vitestFail(), exitCode: 1, isError: true }),
    );
    expect(evidence?.status).toBe("failed");
    expect(evidence?.failed).toBe(1);
  });
});
