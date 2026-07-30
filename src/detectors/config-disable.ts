import { classifyTestCommand } from "../session/testruns.js";
import type { Detector, DetectorContext, Finding, FileEditAction } from "../types.js";
import {
  addedLines,
  anchor,
  commandEvidence,
  editEvidence,
  excerpt,
  isAttributable,
  isWorkflowFile,
  priorFailingTestRun,
  priorFailure,
  removedLines,
  userAskedFor,
} from "./helpers.js";

const STRICTNESS_OFF = /"(?:strict|noImplicitAny|strictNullChecks|strictFunctionTypes)"\s*:\s*false/;
const INLINE_DISABLE = /eslint-disable|@ts-ignore|@ts-expect-error|#\s*type:\s*ignore|#\s*noqa|--passWithNoTests/;
const TYPE_OR_LINT_FAILURE = /error TS\d+|eslint|tslint|typescript|tsc\b|ruff|flake8|mypy/i;
const USER_ASKED = /strict|eslint-disable|ts-ignore|ts-expect-error|noqa|비활성|끄고|해제/i;

function isTsConfig(path: string): boolean {
  return /(?:^|\/)tsconfig[\w.-]*\.json$/.test(path);
}

/** A yaml line that runs tests, e.g. "- run: pnpm test". */
function runsTests(line: string): boolean {
  const command = /^\s*-?\s*(?:run|cmd)\s*:\s*(.+)$/.exec(line)?.[1] ?? line;
  return classifyTestCommand(command) !== null;
}

/** Checks turned off instead of satisfied. */
export const configDisable: Detector = {
  id: "config-disable",
  run(ctx: DetectorContext): Finding[] {
    if (userAskedFor(ctx, USER_ASKED)) return [];

    const findings: Finding[] = [];
    const add = (
      edit: FileEditAction,
      finding: Omit<Finding, "detector" | "evidence" | "stillPresent"> &
        Partial<Pick<Finding, "evidence">>,
    ): void => {
      findings.push({
        detector: "config-disable",
        evidence: finding.evidence ?? [],
        stillPresent: true,
        ...finding,
      } as Finding);
      void edit;
    };

    for (const action of ctx.actions) {
      if (action.kind !== "file-edit") continue;
      if (!isAttributable(action) || action.truncated) continue;
      const added = addedLines(action);
      const removed = removedLines(action);

      if (isTsConfig(action.filePath)) {
        const line = added.find((l) => STRICTNESS_OFF.test(l));
        if (line) {
          const located = anchor(ctx, action.filePath, line);
          if (located) {
            const failure = priorFailure(ctx, action.seq, TYPE_OR_LINT_FAILURE);
            add(action, {
              tier: failure ? "CAUGHT" : "SUSPICIOUS",
              messageKey: "config-disable.strict-off",
              messageVars: { snippet: excerpt(line), file: located.file },
              code: located,
              evidence: [
                ...(failure ? [commandEvidence(failure, excerpt(failure.stdout).slice(0, 120))] : []),
                editEvidence(action, "", line),
              ],
            });
            continue;
          }
        }
      }

      if (isWorkflowFile(action.filePath)) {
        const dropped = removed.find((l) => runsTests(l) && !added.some((a) => a.trim() === l.trim()));
        if (dropped) {
          const failure = priorFailingTestRun(ctx, action.seq);
          add(action, {
            tier: failure ? "CAUGHT" : "SUSPICIOUS",
            messageKey: "config-disable.ci-test-removed",
            messageVars: {
              snippet: excerpt(dropped),
              file: ctx.worktree.relative(action.filePath),
            },
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
              editEvidence(action, dropped, ""),
            ],
          });
          continue;
        }
      }

      // A lone disable comment is ordinary in most repositories. It only means
      // something when a check had just failed, so without that it stays quiet.
      const disable = added.find((l) => INLINE_DISABLE.test(l));
      if (disable && !removed.some((old) => INLINE_DISABLE.test(old))) {
        const failure = priorFailure(ctx, action.seq, TYPE_OR_LINT_FAILURE);
        if (!failure) continue;
        const located = anchor(ctx, action.filePath, disable);
        if (!located) continue;
        add(action, {
          tier: "SUSPICIOUS",
          messageKey: "config-disable.inline-disable",
          messageVars: { snippet: excerpt(disable), file: located.file },
          code: located,
          evidence: [
            commandEvidence(failure, excerpt(failure.stdout).slice(0, 120)),
            editEvidence(action, "", disable),
          ],
        });
      }
    }
    return findings;
  },
};
