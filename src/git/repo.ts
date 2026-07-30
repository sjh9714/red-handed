import { execFileSync } from "node:child_process";

/** Runs git and returns its output, or null if git failed or is missing. */
export function runGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

export function findRepoRoot(cwd: string): string | null {
  const output = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  return output === null ? null : output.trim() || null;
}

export function currentBranch(repoRoot: string): string | null {
  const output = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return output === null ? null : output.trim() || null;
}
