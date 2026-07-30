import { editsBetween, lastTestRunBefore } from "../correlate/timeline.js";
import type { Detector, DetectorContext, Finding } from "../types.js";
import { couldAffectTests, excerpt, unreadableVerificationBetween } from "./helpers.js";

/**
 * Saying the tests pass when the last thing that ran said otherwise.
 *
 * A run whose result could not be read is not a failure, so a claim that follows
 * an unreadable run produces nothing at all.
 */
export const claimVsFail: Detector = {
  id: "claim-vs-fail",
  run(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];

    for (const claim of ctx.claims) {
      if (claim.family !== "test-pass") continue;
      const run = lastTestRunBefore(ctx.actions, claim.seq);
      const evidence = run?.testRun;
      if (!run || !evidence) continue;

      if (evidence.status === "failed") {
        // Something between the failure and the claim may have re-verified the
        // code where this tool could not read the result. Then the failure is
        // simply not known to be the last word.
        const invisible = unreadableVerificationBetween(ctx, run.seq, claim.seq);
        findings.push({
          detector: "claim-vs-fail",
          tier: invisible ? "SUSPICIOUS" : "CAUGHT",
          messageKey: invisible ? "claim-vs-fail.maybe-reverified" : "claim-vs-fail.contradicts",
          messageVars: {
            claim: claim.text,
            summary: evidence.summaryLine ?? `exit code ${run.exitCode ?? "?"}`,
          },
          evidence: [
            {
              ts: run.ts,
              kind: "test-output",
              uuid: run.uuid,
              excerpt: `$ ${excerpt(run.command)}\n${evidence.summaryLine ?? `exit code ${run.exitCode ?? "?"}`}`,
            },
            { ts: claim.ts, kind: "quote", uuid: claim.uuid, excerpt: claim.text },
            {
              ts: claim.ts,
              kind: "note",
              excerpt: "no test run between that failure and this claim",
              noteKey: "note.no-run-between",
            },
          ],
          stillPresent: true,
        });
        continue;
      }

      if (evidence.status === "passed") {
        const changed = editsBetween(ctx.actions, run.seq, claim.seq).filter((edit) =>
          couldAffectTests(ctx, edit.filePath),
        );
        if (changed.length === 0) continue;
        const files = [...new Set(changed.map((e) => ctx.worktree.relative(e.filePath)))];
        findings.push({
          detector: "claim-vs-fail",
          tier: "SUSPICIOUS",
          messageKey: "claim-vs-fail.stale",
          messageVars: {
            claim: claim.text,
            files: files.slice(0, 3).join(", "),
            count: String(changed.length),
          },
          evidence: [
            {
              ts: run.ts,
              kind: "test-output",
              uuid: run.uuid,
              excerpt: `$ ${excerpt(run.command)}\n${evidence.summaryLine ?? "passed"}`,
            },
            {
              ts: changed[0]?.ts ?? claim.ts,
              kind: "note",
              excerpt: `${changed.length} file(s) changed after that run: ${files.slice(0, 3).join(", ")}`,
              noteKey: "note.files-changed-after",
              noteVars: { count: String(changed.length), files: files.slice(0, 3).join(", ") },
            },
            { ts: claim.ts, kind: "quote", uuid: claim.uuid, excerpt: claim.text },
          ],
          stillPresent: true,
        });
      }
    }
    return findings;
  },
};
