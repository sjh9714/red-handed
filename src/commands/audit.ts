import { buildContext } from "../correlate/context.js";
import { runDetectors } from "../detectors/index.js";
import { diffActions } from "../git/audit.js";
import { currentBranch, findRepoRoot } from "../git/repo.js";
import { normalize } from "../session/normalize.js";
import type { AuditReport, Finding, SessionInfo } from "../types.js";
import { DETECTORS } from "../detectors/index.js";

export interface AuditOptions {
  cwd: string;
  sessions: SessionInfo[];
  gitOnly: boolean;
  range?: string;
  detectors?: string[];
  exclude?: string[];
}

/** Audits one or more sessions, or a diff when there is no transcript to read. */
export async function audit(options: AuditOptions): Promise<AuditReport> {
  const repoRoot = findRepoRoot(options.cwd) ?? options.cwd;
  const branch = currentBranch(repoRoot);
  const detectorCount = DETECTORS.filter(
    (d) => (!options.detectors || options.detectors.includes(d.id)) && !options.exclude?.includes(d.id),
  ).length;

  if (options.gitOnly) {
    const context = buildContext({
      actions: diffActions(repoRoot, options.range),
      repoRoot,
      mode: "git-only",
    });
    return {
      repoRoot,
      branch,
      mode: "git-only",
      findings: runDetectors(context, { detectors: options.detectors, exclude: options.exclude }),
      detectorCount,
    };
  }

  const findings: Finding[] = [];
  let startedAt: string | undefined;

  for (const session of options.sessions) {
    const { actions } = await normalize(session.transcriptPath, {
      subagentPaths: session.subagentPaths,
      toolResultsDir: session.toolResultsDir,
    });
    if (actions.length === 0) continue;
    const context = buildContext({ actions, repoRoot, mode: "session" });
    for (const finding of runDetectors(context, {
      detectors: options.detectors,
      exclude: options.exclude,
    })) {
      findings.push({ ...finding, sessionId: session.sessionId, projectPath: session.cwd });
    }
    if (startedAt === undefined) startedAt = actions[0]?.ts;
  }

  const single = options.sessions.length === 1 ? options.sessions[0] : undefined;
  return {
    sessionId: single?.sessionId,
    startedAt,
    transcriptPath: single?.transcriptPath,
    repoRoot,
    branch,
    mode: "session",
    findings,
    detectorCount,
    sessionsScanned: options.sessions.length > 1 ? options.sessions.length : undefined,
  };
}
