import { describe, expect, test } from "vitest";
import { extractClaims, findClaims } from "../../src/claims/extract.js";
import { session } from "../fixtures/session-builder.js";
import { normalize } from "../../src/session/normalize.js";

function families(text: string): string[] {
  return findClaims(text).map((c) => c.family);
}

describe("findClaims: what counts as claiming the tests pass", () => {
  test.each([
    "All tests pass.",
    "The test suite is green.",
    "34 tests passing.",
    "All 34 tests now pass.",
    "Tests are green again.",
    "✅ All tests pass",
  ])("treats %j as a test-pass claim", (text) => {
    expect(families(text)).toContain("test-pass");
  });

  test("reads a claim out of a markdown status table", () => {
    const table = ["| check | result |", "| --- | --- |", "| tests | ✅ pass |"].join("\n");
    expect(families(table)).toContain("test-pass");
  });

  test.each([
    "Typecheck passes.",
    "The build succeeds.",
    "No type errors.",
    "Lint is clean.",
  ])("treats %j as a build-pass claim", (text) => {
    expect(families(text)).toContain("build-pass");
  });
});

describe("findClaims: what must never count", () => {
  test.each([
    "Let me run the tests to make sure they pass.",
    "If the tests pass, I'll commit.",
    "The tests do not pass yet.",
    "Will the tests pass?",
    "I need to make the tests pass.",
    "2 tests are failing.",
    "Next I'll check whether the tests pass.",
    "Once the tests pass we can merge.",
    "This change should make the tests pass, so let me run them.",
  ])("does not treat %j as a claim", (text) => {
    expect(findClaims(text)).toHaveLength(0);
  });

  test("ignores a claim inside a fenced code block", () => {
    const text = ["Here is the script:", "```bash", "echo 'all tests pass'", "```"].join("\n");
    expect(findClaims(text)).toHaveLength(0);
  });

  test("ignores quoted output in a blockquote", () => {
    expect(findClaims("> 34 tests passing")).toHaveLength(0);
  });
});

describe("findClaims: hedged wording is a weaker claim", () => {
  test.each(["The tests should pass now.", "Tests probably pass now.", "The tests seem to pass."])(
    "treats %j as weak",
    (text) => {
      const claims = findClaims(text);
      expect(claims[0]?.strength).toBe("weak");
    },
  );

  test("treats a flat statement as specific", () => {
    expect(findClaims("All 34 tests pass.")[0]?.strength).toBe("specific");
  });
});

describe("findClaims: Korean", () => {
  test.each([
    "모든 테스트 통과했습니다.",
    "테스트 34개 전부 통과.",
    "테스트 모두 통과합니다.",
    "테스트 성공했습니다.",
  ])("treats %j as a test-pass claim", (text) => {
    expect(families(text)).toContain("test-pass");
  });

  test.each(["빌드 성공했습니다.", "타입체크 통과.", "린트 에러 없습니다."])(
    "treats %j as a build-pass claim",
    (text) => {
      expect(families(text)).toContain("build-pass");
    },
  );

  test.each([
    "테스트를 돌려서 통과하는지 확인할게요.",
    "테스트가 실패했습니다.",
    "테스트 통과했나요?",
    "테스트를 통과해야 합니다.",
    "이제 테스트를 실행하겠습니다.",
  ])("does not treat %j as a claim", (text) => {
    expect(findClaims(text)).toHaveLength(0);
  });
});

describe("extractClaims: where claims come from", () => {
  test("reads claims from assistant prose", async () => {
    const { transcriptPath } = session().say("All tests pass.").writeTo();
    const { actions } = await normalize(transcriptPath);
    const claims = extractClaims(actions);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.source).toBe("assistant-text");
    expect(claims[0]?.text).toContain("All tests pass");
  });

  test("never reads a claim out of private reasoning", async () => {
    const { transcriptPath } = session().think("All tests pass, probably.").writeTo();
    const { actions } = await normalize(transcriptPath);
    expect(extractClaims(actions)).toHaveLength(0);
  });

  test("treats a completed test todo as a weak claim", async () => {
    const { transcriptPath } = session().todoComplete("Make all tests pass").writeTo();
    const { actions } = await normalize(transcriptPath);
    const claims = extractClaims(actions);
    expect(claims[0]?.source).toBe("todo");
    expect(claims[0]?.strength).toBe("weak");
  });

  test("ignores a completed todo that claims nothing about tests", async () => {
    const { transcriptPath } = session().todoComplete("Rename the cart module").writeTo();
    const { actions } = await normalize(transcriptPath);
    expect(extractClaims(actions)).toHaveLength(0);
  });

  test("reads a claim out of a commit message", async () => {
    const { transcriptPath } = session()
      .bash(`git commit -m "fix: cart total, all tests pass"`)
      .writeTo();
    const { actions } = await normalize(transcriptPath);
    const claims = extractClaims(actions);
    expect(claims[0]?.source).toBe("commit-message");
  });

  test("keeps the timestamp and order of each claim", async () => {
    const { transcriptPath } = session().say("Tests are green.").writeTo();
    const { actions } = await normalize(transcriptPath);
    const claim = extractClaims(actions)[0];
    expect(claim?.ts).not.toBe("");
    expect(typeof claim?.seq).toBe("number");
  });
});
