import type { Detector, DetectorContext, Finding } from "../types.js";
import {
  addedLines,
  anchor,
  editEvidence,
  excerpt,
  isAttributable,
  isTestFile,
  priorFailingTestRun,
  removedLines,
  userAskedFor,
} from "./helpers.js";

interface SwitchOff {
  id: string;
  pattern: RegExp;
  /** `.only` disables every other test in the file, so it never needs a motive. */
  alwaysCaught: boolean;
}

const SWITCHES: SwitchOff[] = [
  { id: "only", pattern: /\.only\s*\(/, alwaysCaught: true },
  { id: "only", pattern: /\b(?:fit|fdescribe)\s*\(/, alwaysCaught: true },
  { id: "skip", pattern: /\.skip\s*\(/, alwaysCaught: false },
  { id: "skip", pattern: /\b(?:xit|xdescribe|xtest)\s*\(/, alwaysCaught: false },
  { id: "skip", pattern: /\.todo\s*\(/, alwaysCaught: false },
  { id: "skip", pattern: /@pytest\.mark\.(?:skip|skipif|xfail)/, alwaysCaught: false },
  { id: "skip", pattern: /\bpytest\.skip\s*\(/, alwaysCaught: false },
];

const USER_ASKED = /\bskip\b|\bdisable\b|스킵|건너뛰|비활성/i;

/** Tests switched off rather than fixed. */
export const skipOnly: Detector = {
  id: "skip-only",
  run(ctx: DetectorContext): Finding[] {
    if (userAskedFor(ctx, USER_ASKED)) return [];

    const findings: Finding[] = [];
    for (const action of ctx.actions) {
      if (action.kind !== "file-edit") continue;
      if (!isTestFile(action.filePath)) continue;
      if (!isAttributable(action) || action.truncated) continue;

      const added = addedLines(action);
      const removed = removedLines(action);

      for (const line of added) {
        const match = SWITCHES.find((s) => s.pattern.test(line));
        if (!match) continue;
        // Editing a line that was already skipped is not switching anything off.
        if (removed.some((old) => match.pattern.test(old))) continue;

        const located = anchor(ctx, action.filePath, line);
        if (!located) continue;

        const failure = priorFailingTestRun(ctx, action.seq);
        const caught = match.alwaysCaught || failure !== null;
        findings.push({
          detector: "skip-only",
          tier: caught ? "CAUGHT" : "SUSPICIOUS",
          messageKey:
            match.id === "only"
              ? "skip-only.only"
              : failure
                ? "skip-only.after-failure"
                : "skip-only.plain",
          messageVars: { snippet: excerpt(line), file: located.file, line: String(located.line) },
          code: located,
          evidence: [
            ...(failure
              ? [
                  {
                    ts: failure.ts,
                    kind: "test-output" as const,
                    uuid: failure.uuid,
                    excerpt: failure.testRun?.summaryLine ?? excerpt(failure.command),
                  },
                ]
              : []),
            editEvidence(action, "", line),
          ],
          stillPresent: true,
        });
        break;
      }
    }
    return findings;
  },
};
