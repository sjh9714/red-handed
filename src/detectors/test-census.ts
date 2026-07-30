import { sanitizeForClassification } from "../session/shell.js";
import type { CommandAction, Detector, DetectorContext, Finding, TestRunEvidence } from "../types.js";
import { excerpt, userAskedFor } from "./helpers.js";

const USER_ASKED = /\b(?:remove|delete|drop|obsolete|prune|retire)\b|삭제|지우|없애/i;

/** Two runs are comparable only if they ran the same thing. */
function fingerprint(action: CommandAction): string {
  return sanitizeForClassification(action.command).replace(/\s+/g, " ").trim();
}

function total(evidence: TestRunEvidence): number | null {
  const { passed, failed, skipped } = evidence;
  if (passed === undefined && failed === undefined && skipped === undefined) return null;
  return (passed ?? 0) + (failed ?? 0) + (skipped ?? 0);
}

/**
 * The suite got smaller.
 *
 * Deleting a test leaves nothing in the code to point at, which is exactly why
 * it is the cheapest way to make a failure go away — and why every other check
 * here misses it. The runner's own count is the one witness that survives.
 *
 * Two guards keep this honest: only runs of the same command are compared (a
 * subpackage run against a whole-repo run means nothing), and only full runs.
 * Against 184 real sessions those two rules produce no findings at all.
 */
export const testCensus: Detector = {
  id: "test-census",
  run(ctx: DetectorContext): Finding[] {
    if (userAskedFor(ctx, USER_ASKED)) return [];

    const findings: Finding[] = [];
    const previous = new Map<string, { action: CommandAction; count: number }>();

    for (const action of ctx.actions) {
      if (action.kind !== "command") continue;
      const evidence = action.testRun;
      if (!evidence || evidence.scope !== "full") continue;
      const count = total(evidence);
      if (count === null || count === 0) continue;

      const key = `${evidence.framework}:${fingerprint(action)}`;
      const before = previous.get(key);
      previous.set(key, { action, count });
      if (!before || count >= before.count) continue;

      findings.push({
        detector: "test-census",
        tier: "SUSPICIOUS",
        messageKey: "test-census.shrank",
        messageVars: {
          before: String(before.count),
          after: String(count),
          gone: String(before.count - count),
        },
        evidence: [
          {
            ts: before.action.ts,
            kind: "test-output",
            uuid: before.action.uuid,
            excerpt: `$ ${excerpt(before.action.command)}\n${before.action.testRun?.summaryLine ?? `${before.count} tests`}`,
          },
          {
            ts: action.ts,
            kind: "test-output",
            uuid: action.uuid,
            excerpt: `$ ${excerpt(action.command)}\n${evidence.summaryLine ?? `${count} tests`}`,
          },
        ],
        // The runner said it; there is no line of code left to anchor to.
        stillPresent: true,
      });
    }
    return findings;
  },
};
