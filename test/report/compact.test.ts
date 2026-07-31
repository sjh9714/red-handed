import { describe, expect, test } from "vitest";
import { main } from "../../src/cli.js";
import { renderTerminal } from "../../src/report/terminal.js";
import type { AuditReport } from "../../src/types.js";

/**
 * The full report is written for someone sitting in front of a terminal who
 * asked a question and wants the whole answer. That is the right default.
 *
 * It is the wrong shape for the places a finding shows up when nobody asked:
 * a CI log, the one-line hook notice, a screenshot, a list of twenty findings
 * you are skimming. `--compact` keeps what makes a finding checkable — the
 * timestamps and the quoted line — and drops the prose around it.
 */
async function run(args: string[]): Promise<string> {
  let out = "";
  await main(args, { out: (t) => { out += t; }, err: () => {}, env: { NO_COLOR: "1" } });
  return out;
}

describe("--compact", () => {
  test("keeps the evidence, which is the part that can be checked", async () => {
    const out = await run(["demo", "--detectors", "claim-vs-fail", "--compact"]);
    // Shape, not a literal clock reading: the report prints local time, so a
    // hardcoded 06:07:50 passes in Seoul and fails in CI. Found exactly that way.
    expect(out).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect((out.match(/\d{2}:\d{2}:\d{2}/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(out).toContain("All 34 tests pass now");
    expect(out).toContain("Tests 1 failed | 33 passed (34)");
  });

  test("keeps the tier and the human-readable title", async () => {
    const out = await run(["demo", "--detectors", "claim-vs-fail", "--compact"]);
    expect(out).toContain("CAUGHT");
    expect(out).toContain("said tests pass — the last run failed");
  });

  test("drops the narrative and the prescription", async () => {
    const out = await run(["demo", "--detectors", "claim-vs-fail", "--compact"]);
    expect(out).not.toContain("The agent said the tests pass. The last test run");
    expect(out).not.toContain("→ check:");
  });

  test("fits in twelve lines for a single finding", async () => {
    const out = await run(["demo", "--detectors", "claim-vs-fail", "--compact"]);
    const lines = out.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeLessThanOrEqual(12);
  });

  test("still says which check it was, so --detectors can be used next", async () => {
    const out = await run(["demo", "--detectors", "claim-vs-fail", "--compact"]);
    expect(out).toContain("claim-vs-fail");
  });

  // Called directly rather than through the demo, because every check fires in
  // the demo by design — there is no way to ask it for a clean report.
  test("says nothing extra when there is nothing to report", () => {
    const out = renderTerminal(
      { findings: [], detectorCount: 9, mode: "session" } as unknown as AuditReport,
      { color: false, compact: true },
    );
    const lines = out.split("\n").filter((l) => l.trim() !== "");
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(out).not.toContain("switched off, weakened");
  });

  test("works in Korean too", async () => {
    const out = await run(["demo", "--detectors", "claim-vs-fail", "--compact", "--lang", "ko"]);
    expect(out).toContain("검거");
    expect(out).toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(out).not.toContain("→ 확인할 것:");
  });

  test("is rejected alongside --json, which is already machine-readable", async () => {
    let err = "";
    const code = await main(["demo", "--compact", "--json"], {
      out: () => {},
      err: (t) => { err += t; },
      env: {},
    });
    expect(code).toBe(2);
    expect(err).toMatch(/compact/i);
  });
});
