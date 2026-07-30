import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { buildContext } from "../correlate/context.js";
import { lastTestRunBefore } from "../correlate/timeline.js";
import { createWorktreeReader } from "../correlate/worktree.js";
import { runDetectors } from "../detectors/index.js";
import { normalize } from "../session/normalize.js";
import { allSessions, type DiscoverOptions } from "../session/discover.js";
import type { DetectorContext, Finding } from "../types.js";

export interface ProjectTally {
  project: string;
  sessions: number;
  caught: number;
  suspicious: number;
}

/**
 * What the agent claimed and what backed it up.
 *
 * This is the number almost everyone gets: most sessions contain no wrongdoing,
 * and a tool that prints nothing tells you nothing about your own history.
 */
export interface ClaimCoverage {
  claims: number;
  sessionsWithClaims: number;
  verifiedByARun: number;
  noRunInSession: number;
  lastRunHadFailed: number;
  testRuns: number;
  sessionsWithTestRuns: number;
}

export interface StatsResult {
  sessionsScanned: number;
  sessionsWithFindings: number;
  caught: number;
  suspicious: number;
  byDetector: Record<string, { caught: number; suspicious: number }>;
  projects: ProjectTally[];
  findings: Finding[];
  fromCache: number;
  coverage: ClaimCoverage;
}

interface CacheEntry {
  key: string;
  findings: Finding[];
  coverage?: SessionCoverage;
}

interface SessionCoverage {
  claims: number;
  verifiedByARun: number;
  noRunInSession: number;
  lastRunHadFailed: number;
  testRuns: number;
}

/** Everything stays on this machine; the cache is only there to make reruns instant. */
function cachePath(env: Record<string, string | undefined> = process.env): string {
  return join(env.RED_HANDED_HOME ?? join(homedir(), ".red-handed"), "cache.json");
}

function loadCache(path: string): Map<string, CacheEntry> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) return new Map();
    const map = new Map<string, CacheEntry>();
    for (const entry of parsed as CacheEntry[]) {
      if (typeof entry?.key === "string" && Array.isArray(entry.findings)) {
        map.set(entry.key, entry);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/** Session excerpts live here, so nobody else on the machine gets to read them. */
function saveCache(path: string, cache: Map<string, CacheEntry>): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify([...cache.values()]), { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch {
    // A cache that cannot be written is not worth failing an audit over.
  }
}

export interface StatsOptions extends DiscoverOptions {
  sinceMs?: number;
  useCache?: boolean;
  env?: Record<string, string | undefined>;
}

/** Counts what a session claimed and what stood behind each claim. */
function coverageOf(context: DetectorContext): SessionCoverage {
  const result: SessionCoverage = {
    claims: 0,
    verifiedByARun: 0,
    noRunInSession: 0,
    lastRunHadFailed: 0,
    testRuns: context.testRuns.length,
  };
  for (const claim of context.claims) {
    if (claim.family !== "test-pass") continue;
    result.claims += 1;
    const run = lastTestRunBefore(context.actions, claim.seq);
    if (!run) result.noRunInSession += 1;
    else if (run.testRun?.status === "failed") result.lastRunHadFailed += 1;
    else result.verifiedByARun += 1;
  }
  return result;
}

/** Audits every session on the machine and adds up what it finds. */
export async function stats(options: StatsOptions = {}): Promise<StatsResult> {
  const sessions = allSessions(options).filter(
    (s) => options.sinceMs === undefined || s.mtimeMs >= options.sinceMs,
  );
  const useCache = options.useCache ?? true;
  const path = cachePath(options.env);
  const cache = useCache && existsSync(path) ? loadCache(path) : new Map<string, CacheEntry>();
  const next = new Map<string, CacheEntry>();

  const result: StatsResult = {
    sessionsScanned: 0,
    sessionsWithFindings: 0,
    caught: 0,
    suspicious: 0,
    byDetector: {},
    projects: [],
    findings: [],
    fromCache: 0,
    coverage: {
      claims: 0,
      sessionsWithClaims: 0,
      verifiedByARun: 0,
      noRunInSession: 0,
      lastRunHadFailed: 0,
      testRuns: 0,
      sessionsWithTestRuns: 0,
    },
  };
  const projects = new Map<string, ProjectTally>();

  for (const session of sessions) {
    const key = `${session.transcriptPath}:${session.sizeBytes}:${Math.round(session.mtimeMs)}`;
    let findings: Finding[];
    let coverage: SessionCoverage;
    const cached = cache.get(key);
    if (cached && cached.coverage) {
      // The transcript has not changed, but the code it accuses might have.
      // Invariant #1 says a finding needs a live anchor, so re-check every one.
      const worktree = createWorktreeReader(session.cwd || null);
      findings = cached.findings.filter((f) => {
        if (!f.code) return true;
        const path = isAbsolute(f.code.file) ? f.code.file : join(session.cwd, f.code.file);
        return worktree.locate(path, f.code.snippet) !== null;
      });
      coverage = cached.coverage;
      result.fromCache += 1;
    } else {
      const { actions } = await normalize(session.transcriptPath, {
        subagentPaths: session.subagentPaths,
        toolResultsDir: session.toolResultsDir,
      });
      if (actions.length === 0) continue;
      const context = buildContext({
        actions,
        repoRoot: session.cwd || null,
        mode: "session",
      });
      findings = runDetectors(context).map((f) => ({
        ...f,
        sessionId: session.sessionId,
        projectPath: session.cwd,
      }));
      coverage = coverageOf(context);
    }
    next.set(key, { key, findings, coverage });

    result.coverage.claims += coverage.claims;
    result.coverage.verifiedByARun += coverage.verifiedByARun;
    result.coverage.noRunInSession += coverage.noRunInSession;
    result.coverage.lastRunHadFailed += coverage.lastRunHadFailed;
    result.coverage.testRuns += coverage.testRuns;
    if (coverage.claims > 0) result.coverage.sessionsWithClaims += 1;
    if (coverage.testRuns > 0) result.coverage.sessionsWithTestRuns += 1;

    result.sessionsScanned += 1;
    if (findings.length > 0) result.sessionsWithFindings += 1;

    const tally = projects.get(session.cwd) ?? {
      project: session.cwd,
      sessions: 0,
      caught: 0,
      suspicious: 0,
    };
    tally.sessions += 1;

    for (const finding of findings) {
      const bucket = (result.byDetector[finding.detector] ??= { caught: 0, suspicious: 0 });
      if (finding.tier === "CAUGHT") {
        result.caught += 1;
        bucket.caught += 1;
        tally.caught += 1;
      } else {
        result.suspicious += 1;
        bucket.suspicious += 1;
        tally.suspicious += 1;
      }
      result.findings.push(finding);
    }
    projects.set(session.cwd, tally);
  }

  if (useCache) saveCache(path, next);
  result.projects = [...projects.values()]
    .filter((p) => p.caught + p.suspicious > 0)
    .sort((a, b) => b.caught - a.caught || b.suspicious - a.suspicious);
  return result;
}
