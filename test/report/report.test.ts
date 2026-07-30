import { describe, expect, test } from "vitest";
import { displayWidth, wrapText } from "../../src/report/width.js";
import { renderTerminal } from "../../src/report/terminal.js";
import { renderJson } from "../../src/report/json.js";
import { renderMarkdown } from "../../src/report/markdown.js";
import { exitCodeFor } from "../../src/report/exit-code.js";
import { resolveLocale } from "../../src/report/messages.js";
import type { AuditReport, Finding } from "../../src/types.js";

const caught: Finding = {
  detector: "hardcoded-expected",
  tier: "CAUGHT",
  messageKey: "hardcoded-expected.literal",
  messageVars: { expected: "8", received: "11", file: "src/cart.test.ts", line: "42" },
  code: { file: "src/cart.test.ts", line: 42, snippet: "expect(total).toBe(11)" },
  evidence: [
    { ts: "2026-07-23T21:18:43.000Z", kind: "test-output", excerpt: "Tests 1 failed | 33 passed" },
    { ts: "2026-07-23T21:18:59.000Z", kind: "edit", excerpt: "- toBe(8)   →   + toBe(11)" },
    {
      ts: "2026-07-23T21:18:59.000Z",
      kind: "note",
      excerpt: "no implementation file was changed between the failure and this edit",
      noteKey: "note.no-impl-change",
    },
  ],
  stillPresent: true,
};

const suspicious: Finding = {
  detector: "error-swallowing",
  tier: "SUSPICIOUS",
  messageKey: "error-swallowing.empty",
  messageVars: { snippet: "} catch {}", file: "src/api.ts", line: "88" },
  code: { file: "src/api.ts", line: 88, snippet: "} catch {}" },
  evidence: [{ ts: "2026-07-23T21:20:00.000Z", kind: "command", excerpt: "$ node src/api.js" }],
  stillPresent: true,
};

function report(over: Partial<AuditReport> = {}): AuditReport {
  return {
    sessionId: "56dd84a4-1111-2222-3333-444444444444",
    startedAt: "2026-07-23T21:00:00.000Z",
    repoRoot: "/repo/my-app",
    branch: "main",
    mode: "session",
    findings: [caught, suspicious],
    detectorCount: 7,
    ...over,
  };
}

describe("display width", () => {
  test("counts a Korean syllable as two columns", () => {
    expect(displayWidth("테스트")).toBe(6);
  });

  test("counts plain text as one column per character", () => {
    expect(displayWidth("tests")).toBe(5);
  });

  test("wraps on width rather than character count", () => {
    const lines = wrapText("테스트가 실패하자 에이전트는 코드를 고치는 대신", 20);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(20);
  });

  test("does not break a word in half", () => {
    expect(wrapText("alpha beta gamma", 11)).toEqual(["alpha beta", "gamma"]);
  });
});

describe("terminal report", () => {
  test("tells the story, then the evidence, then what to check", () => {
    const text = renderTerminal(report(), { color: false, lang: "en" });
    expect(text).toContain("CAUGHT");
    expect(text).toContain("src/cart.test.ts:42");
    // the narrative says what happened, in words, before any evidence appears
    expect(text).toContain("changed the test to expect 11");
    expect(text.indexOf("changed the test to expect 11")).toBeLessThan(
      text.indexOf("Tests 1 failed"),
    );
    expect(text).toMatch(/check/i);
  });

  test("stamps evidence with the time it happened, in the reader's own timezone", () => {
    const text = renderTerminal(report(), { color: false, lang: "en" });
    const local = new Date("2026-07-23T21:18:43.000Z").toTimeString().slice(0, 8);
    expect(text).toContain(local);
  });

  test("counts the findings at the top", () => {
    const text = renderTerminal(report(), { color: false, lang: "en" });
    expect(text).toMatch(/CAUGHT\s+1/);
    expect(text).toMatch(/SUSPICIOUS\s+1/);
  });

  test("says so plainly when there is nothing to report", () => {
    const text = renderTerminal(report({ findings: [] }), { color: false, lang: "en" });
    expect(text).toMatch(/nothing|clean/i);
  });

  test("speaks Korean when asked", () => {
    const text = renderTerminal(report(), { color: false, lang: "ko" });
    expect(text).toContain("확인할 것");
    expect(text).toMatch(/테스트/);
  });

  test("leads each finding with a title in plain words, not the detector id", () => {
    const text = renderTerminal(report(), { color: false, lang: "en" });
    expect(text).toContain("rewrote the answer to match the bug");
    const ko = renderTerminal(report(), { color: false, lang: "ko" });
    expect(ko).toContain("오답을 정답으로 바꿔치기");
  });

  test("keeps the detector id visible for --detectors, after the title", () => {
    const text = renderTerminal(report(), { color: false, lang: "en" });
    expect(text).toContain("hardcoded-expected");
  });

  test("falls back to English for a language it does not have", () => {
    const text = renderTerminal(report(), { color: false, lang: "fr" });
    expect(text).toMatch(/check/i);
  });

  test("translates evidence notes, so a Korean report contains no stray English", () => {
    const ko = renderTerminal(report(), { color: false, lang: "ko" });
    expect(ko).not.toContain("no implementation file was changed");
    expect(ko).toContain("구현 코드는 그대로");
  });

  test("keeps quoted evidence verbatim even in a translated report", () => {
    const ko = renderTerminal(report(), { color: false, lang: "ko" });
    expect(ko).toContain("Tests 1 failed | 33 passed");
  });
});

describe("machine-readable output", () => {
  test("json keeps every finding and its evidence", () => {
    const parsed: unknown = JSON.parse(renderJson(report()));
    const value = parsed as { findings: Finding[]; summary: { caught: number } };
    expect(value.findings).toHaveLength(2);
    expect(value.summary.caught).toBe(1);
    expect(value.findings[0]?.evidence[0]?.ts).toBe("2026-07-23T21:18:43.000Z");
  });

  test("markdown is readable as a comment on a pull request", () => {
    const text = renderMarkdown(report(), { lang: "en" });
    expect(text).toContain("## ");
    expect(text).toContain("src/cart.test.ts:42");
  });
});

describe("exit code", () => {
  test("fails the command when something was caught", () => {
    expect(exitCodeFor([caught], "caught")).toBe(1);
  });

  test("passes when only suspicions remain", () => {
    expect(exitCodeFor([suspicious], "caught")).toBe(0);
  });

  test("can be asked to fail on suspicions too", () => {
    expect(exitCodeFor([suspicious], "suspicious")).toBe(1);
  });

  test("can be asked never to fail", () => {
    expect(exitCodeFor([caught], "never")).toBe(0);
  });
});

describe("locale resolution", () => {
  test("picks Korean from a system locale string", () => {
    expect(resolveLocale("ko_KR.UTF-8").id).toBe("ko");
  });

  test("falls back to English", () => {
    expect(resolveLocale("de_DE.UTF-8").id).toBe("en");
  });
});
