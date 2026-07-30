import { describe, expect, test } from "vitest";
import { findClaims } from "../../src/claims/extract.js";
import { classifyTestCommand } from "../../src/session/testruns.js";
import { findingsOf, harness } from "../fixtures/harness.js";

/**
 * Every case here is a false positive this tool produced against real sessions.
 * The wording is kept as it was written, because paraphrasing loses the shape
 * that fooled the detector.
 */

describe("prose that only mentions passing tests", () => {
  test.each([
    'This machine\'s sessions are mostly Korean ("모든 테스트 통과" = "all tests pass").',
    '(1) "tests should pass"처럼 부사가 끼면 패턴이 안 맞음.',
    'The README says "all tests pass" but that is documentation.',
  ])("does not read a quotation as a claim: %j", (text) => {
    expect(findClaims(text)).toHaveLength(0);
  });

  test.each([
    "**최소 수정.** 테스트를 통과시키는 가장 작은 변경만 한다.",
    "테스트를 통과하는 코드를 작성해야 한다.",
  ])("does not read an instruction as a claim: %j", (text) => {
    expect(findClaims(text)).toHaveLength(0);
  });

  test.each([
    "내 합성 테스트 6개 중 5개는 이미 통과했어.",
    "4 of 6 tests pass.",
    "테스트 일부만 통과했습니다.",
  ])("does not read a partial result as a claim: %j", (text) => {
    expect(findClaims(text)).toHaveLength(0);
  });

  test("still reads a plain claim that happens to contain a quoted word", () => {
    expect(findClaims('All tests pass after renaming "total" to "sum".')).toHaveLength(1);
  });
});

describe("commands that merely contain a flag-like fragment", () => {
  test("does not treat sed -n in the same line as a commit as bypassing hooks", async () => {
    const h = harness();
    h.agent.bash(
      `cd /repo && sed -n '1,20p' README.md && git add -A && git commit -q -m "docs: lead with the recipe"`,
      { stdout: "[main abc] docs" },
    );
    expect(findingsOf(await h.run(), "no-verify")).toHaveLength(0);
  });

  test("does not treat git push -n as bypassing hooks, since that is a dry run", async () => {
    const h = harness();
    h.agent.bash("git push -n origin HEAD", { stdout: "To github.com:me/repo.git" });
    expect(findingsOf(await h.run(), "no-verify")).toHaveLength(0);
  });

  test("still catches a real commit bypass in a chained command", async () => {
    const h = harness();
    h.agent.bash("cd /repo && git add -A && git commit --no-verify -m 'wip'", { stdout: "ok" });
    expect(findingsOf(await h.run(), "no-verify")).toHaveLength(1);
  });

  test("still catches the short form on a commit", async () => {
    const h = harness();
    h.agent.bash("git commit -n -m 'wip'", { stdout: "ok" });
    expect(findingsOf(await h.run(), "no-verify")).toHaveLength(1);
  });
});

describe("test runners this tool did not know", () => {
  test.each([
    ["make test", "generic"],
    ["go test ./...", "generic"],
    ["cargo test", "generic"],
    ["python3 -m unittest discover", "generic"],
    ["bash scripts/test.sh", "generic"],
    ["./scripts/run-tests.sh", "generic"],
    ["python3 tools/test_oss_ops.py", "generic"],
    ["deno test", "generic"],
  ])("recognises %s as a test run", (command, framework) => {
    expect(classifyTestCommand(command)?.framework).toBe(framework);
  });

  test("does not mistake a make target that builds for a test run", () => {
    expect(classifyTestCommand("make build")).toBeNull();
  });
});

describe("claiming tests pass when verification is not visible", () => {
  test("only suspects the claim when some test-shaped command did run", async () => {
    const h = harness({ "src/cart.ts": "export const total = () => 11\n" });
    h.agent
      .edit(h.path("src/cart.ts"), "10", "11")
      // A project-specific runner this tool cannot read the result of.
      .bash("python3 tools/verify_all.py --tests", { stdout: "done" })
      .say("All 25 tests pass.");
    const findings = findingsOf(await h.run(), "claim-no-run");
    expect(findings[0]?.tier).toBe("SUSPICIOUS");
  });

  test("still catches a claim in a session with nothing test-shaped in it at all", async () => {
    const h = harness({ "src/cart.ts": "export const total = () => 11\n" });
    h.agent
      .edit(h.path("src/cart.ts"), "10", "11")
      .bash("git status", { stdout: "clean" })
      .say("All 25 tests pass.");
    expect(findingsOf(await h.run(), "claim-no-run")[0]?.tier).toBe("CAUGHT");
  });
});
