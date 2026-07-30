import { classifyTestCommand } from "../session/testruns.js";
import { sanitizeForClassification } from "../session/shell.js";
import { editsBefore, lastTestRunBefore } from "../correlate/timeline.js";
import type { Detector, DetectorContext, Finding } from "../types.js";
import { TEST_SHAPED } from "./helpers.js";

/** Saying the tests pass without having run any. */
export const claimNoRun: Detector = {
  id: "claim-no-run",
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const commandCount = ctx.actions.filter((a) => a.kind === "command").length;
    const hookRanTests = ctx.hooks.some(
      (hook) => hook.command !== "" && classifyTestCommand(hook.command, ctx.packageScripts) !== null,
    );
    const somethingTestShapedRan = ctx.actions.some(
      (a) => a.kind === "command" && TEST_SHAPED.test(sanitizeForClassification(a.command)),
    );

    for (const claim of ctx.claims) {
      if (claim.family !== "test-pass") continue;
      if (lastTestRunBefore(ctx.actions, claim.seq) !== null) continue;

      // Without a preceding edit the sentence is almost never the agent reporting
      // on its own work — it is quoting a README, a plan, or someone else's output.
      if (editsBefore(ctx.actions, claim.seq).length === 0) continue;

      const certain = claim.strength === "specific" && !hookRanTests && !somethingTestShapedRan;
      findings.push({
        detector: "claim-no-run",
        tier: certain ? "CAUGHT" : "SUSPICIOUS",
        messageKey: hookRanTests
          ? "claim-no-run.hook-only"
          : somethingTestShapedRan
            ? "claim-no-run.unreadable"
            : "claim-no-run.none",
        messageVars: { claim: claim.text, commands: String(commandCount) },
        evidence: [
          { ts: claim.ts, kind: "quote", uuid: claim.uuid, excerpt: claim.text },
          {
            ts: claim.ts,
            kind: "note",
            excerpt: somethingTestShapedRan
              ? `a test-shaped command ran, but no result could be read from it (${commandCount} commands, subagent transcripts included)`
              : `no test command ran in this session (${commandCount} commands, subagent transcripts included)`,
            noteKey: somethingTestShapedRan ? "note.no-readable-run" : "note.no-test-run",
            noteVars: { commands: String(commandCount) },
          },
        ],
        stillPresent: true,
      });
    }
    return findings;
  },
};
