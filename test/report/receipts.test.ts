import { describe, expect, test } from "vitest";
import { main } from "../../src/cli.js";
import { commandShape, type ReceiptsReport } from "../../src/receipts.js";
import { receiptsPayload, renderReceipts, shareLine } from "../../src/report/receipts.js";
import type { TestFramework } from "../../src/types.js";

/**
 * The count asks people to post a number in public. Everything here exists so
 * that the number is the only thing that could ever go, whatever their commands
 * happened to contain.
 */

const report = (): ReceiptsReport => ({
  sessions: 3,
  total: 10,
  readable: 6,
  shredded: 4,
  selfInflicted: 3,
  byFramework: new Map<TestFramework, { total: number; shredded: number }>([
    ["vitest", { total: 10, shredded: 4 }],
  ]),
  worstCommands: [{ command: "npx vitest run … | tail -5", count: 3 }],
});

describe("what a person could post", () => {
  test("the JSON carries numbers and nothing else", () => {
    const body = JSON.stringify(receiptsPayload(report()));
    const words = body.match(/[A-Za-z][\w.-]*/g) ?? [];
    const allowed = new Set([
      "runs",
      "shredded",
      "selfInflicted",
      "sessions",
      "byFramework",
      "vitest",
      "jest",
      "mocha",
      "pytest",
      "generic",
    ]);
    expect(words.filter((w) => !allowed.has(w))).toEqual([]);
  });

  test("the JSON has no path separators at all", () => {
    expect(JSON.stringify(receiptsPayload(report()))).not.toMatch(/\/[A-Za-z]/);
  });

  test("the paste-ready line is as clean as the JSON", () => {
    // Riskier than the JSON: people paste this into a public thread without
    // reading it first.
    const line = shareLine(report());
    expect(line).not.toContain("/");
    expect(line).toMatch(/^\d+% shredded · \d+ of \d+ runs · \d+ self-inflicted/);
  });

  test("the paste-ready line never names the generic bucket", () => {
    // "generic" says nothing about anyone's stack and would be noise in every
    // row of the thread.
    const withGeneric = report();
    withGeneric.byFramework.set("generic", { total: 40, shredded: 39 });
    expect(shareLine(withGeneric)).not.toContain("generic");
  });
});

describe("what appears on screen", () => {
  test("strips the absolute path a command was run from", () => {
    const shaped = commandShape(
      "cd /Users/someone/Projects/secret-client && npx vitest run 2>&1 | tail -5",
    );
    expect(shaped).not.toContain("secret-client");
    expect(shaped).not.toContain("/Users");
    expect(shaped).toContain("tail -5");
  });

  test("blames the segment that ran the tests, not the last one", () => {
    // A naive "last segment wins" rule prints the format check, which is not
    // the command whose result went missing.
    const shaped = commandShape("pnpm test 2>&1 | grep -E 'Tests' && pnpm format:check | tail -1");
    expect(shaped).toContain("pnpm test");
    expect(shaped).not.toContain("format:check");
  });

  test("collapses a heredoc rather than printing its body", () => {
    // Unquoted on purpose. Quoted text is stripped by a different rule, so a
    // quoted secret would let this pass without the heredoc rule existing.
    const shaped = commandShape("python3 - <<PY\nAPI_KEY=sk_live_abcdef\nPY");
    expect(shaped).not.toContain("sk_live_abcdef");
    expect(shaped).not.toContain("API_KEY");
  });

  test("says something useful when there is nothing to count", () => {
    const empty: ReceiptsReport = {
      sessions: 0,
      total: 0,
      readable: 0,
      shredded: 0,
      selfInflicted: 0,
      byFramework: new Map(),
      worstCommands: [],
    };
    const text = renderReceipts(empty, false);
    expect(text).toContain("No test runs found");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("%");
  });
});

describe("the front door", () => {
  test("running with no arguments counts receipts rather than auditing", async () => {
    // The default used to audit this project's latest session. Most people have
    // nothing to find there, and a report about yourself is not worth a second
    // run. This pins the change.
    let out = "";
    const code = await main(["--claude-home", "/nonexistent-for-this-test"], {
      out: (t) => {
        out += t;
      },
      err: () => {},
      env: { NO_COLOR: "1" },
    });
    expect(code).toBe(0);
    expect(out).toContain("No test runs found");
    expect(out).not.toContain("CAUGHT");
  });

  test("audit is still there when asked for by name", async () => {
    let out = "";
    let err = "";
    await main(["audit", "--claude-home", "/nonexistent-for-this-test"], {
      out: (t) => {
        out += t;
      },
      err: (t) => {
        err += t;
      },
      env: { NO_COLOR: "1" },
    });
    // Reaching audit's own "no transcript here" message proves the subcommand
    // still routes, which is the point. A count of zero would not.
    expect(`${out}${err}`).toContain("no session log found");
  });
});
