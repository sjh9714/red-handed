import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { buildContext } from "../correlate/context.js";
import { runDetectors } from "../detectors/index.js";
import { normalize } from "../session/normalize.js";
import { allSessions, type DiscoverOptions } from "../session/discover.js";
import type { Finding } from "../types.js";

export interface ProjectTally {
  project: string;
  sessions: number;
  caught: number;
  suspicious: number;
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
}

interface CacheEntry {
  key: string;
  findings: Finding[];
}

/** Everything stays on this machine; the cache is only there to make reruns instant. */
function cachePath(): string {
  return join(process.env.RED_HANDED_HOME ?? join(homedir(), ".red-handed"), "cache.json");
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

function saveCache(path: string, cache: Map<string, CacheEntry>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify([...cache.values()]));
  } catch {
    // A cache that cannot be written is not worth failing an audit over.
  }
}

export interface StatsOptions extends DiscoverOptions {
  sinceMs?: number;
  useCache?: boolean;
}

/** Audits every session on the machine and adds up what it finds. */
export async function stats(options: StatsOptions = {}): Promise<StatsResult> {
  const sessions = allSessions(options).filter(
    (s) => options.sinceMs === undefined || s.mtimeMs >= options.sinceMs,
  );
  const useCache = options.useCache ?? true;
  const path = cachePath();
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
  };
  const projects = new Map<string, ProjectTally>();

  for (const session of sessions) {
    const key = `${session.transcriptPath}:${session.sizeBytes}:${Math.round(session.mtimeMs)}`;
    let findings: Finding[];
    const cached = cache.get(key);
    if (cached) {
      findings = cached.findings;
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
    }
    next.set(key, { key, findings });

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
