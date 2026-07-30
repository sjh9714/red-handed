import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { session, type SessionBuilder } from "./session-builder.js";
import { normalize } from "../../src/session/normalize.js";
import { buildContext } from "../../src/correlate/context.js";
import { runDetectors } from "../../src/detectors/index.js";
import type { Finding } from "../../src/types.js";

export interface Harness {
  repo: string;
  agent: SessionBuilder;
  /** Absolute path inside the fake repository. */
  path(relative: string): string;
  /** Sets the file contents the audit will see as "the code right now". */
  worktree(files: Record<string, string>): void;
  run(options?: { detectors?: string[] }): Promise<Finding[]>;
}

/**
 * A whole audit in one place: a fake repository, a transcript of what the agent
 * did to it, and the state the code is in now.
 */
export function harness(files: Record<string, string> = {}): Harness {
  const repo = mkdtempSync(join(tmpdir(), "rh-repo-"));
  const write = (contents: Record<string, string>): void => {
    for (const [name, content] of Object.entries(contents)) {
      const full = join(repo, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  };
  write(files);

  const agent = session({ cwd: repo });

  return {
    repo,
    agent,
    path: (relative) => join(repo, relative),
    worktree: write,
    async run(options = {}) {
      const { transcriptPath } = agent.writeTo();
      const { actions } = await normalize(transcriptPath);
      const context = buildContext({ actions, repoRoot: repo, mode: "session" });
      return runDetectors(context, options);
    },
  };
}

export function findingsOf(findings: Finding[], detector: string): Finding[] {
  return findings.filter((f) => f.detector === detector);
}
