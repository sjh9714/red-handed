import { describe, expect, test } from "vitest";
import { main } from "../../src/cli.js";

async function runDemo(extra: string[] = []): Promise<{ code: number; out: string }> {
  let out = "";
  const code = await main(["demo", ...extra], {
    out: (text) => {
      out += text;
    },
    err: () => {},
    env: { NO_COLOR: "1" },
  });
  return { code, out };
}

describe("red-handed demo", () => {
  test("shows every detector firing, with no setup and no repository", async () => {
    const { out } = await runDemo(["--json"]);
    const parsed = JSON.parse(out) as { findings: Array<{ detector: string }> };
    const detectors = new Set(parsed.findings.map((f) => f.detector));
    expect(detectors).toEqual(
      new Set([
        "no-verify",
        "skip-only",
        "claim-vs-fail",
        "claim-no-run",
        "hardcoded-expected",
        "config-disable",
        "error-swallowing",
      ]),
    );
  });

  test("says out loud that the session is made up", async () => {
    const { out } = await runDemo();
    expect(out).toMatch(/demo|synthetic|made-up/i);
  });

  test("exits non-zero, the way it would on a real repository", async () => {
    expect((await runDemo()).code).toBe(1);
  });

  test("the made-up agent speaks Korean in the Korean demo", async () => {
    const { out } = await runDemo(["--lang", "ko"]);
    expect(out).toContain("테스트 34개 전부 통과");
    expect(out).not.toContain("All 34 tests pass");
    // The runner's own output stays as a runner prints it.
    expect(out).toContain("Tests 1 failed | 33 passed");
  });
});
