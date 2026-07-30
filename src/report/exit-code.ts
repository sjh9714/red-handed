import type { Finding } from "../types.js";

export type FailOn = "caught" | "suspicious" | "never";

/** 0 clean, 1 findings at or above the chosen level. Usage errors exit 2. */
export function exitCodeFor(findings: Finding[], failOn: FailOn): number {
  if (failOn === "never") return 0;
  if (failOn === "suspicious") return findings.length > 0 ? 1 : 0;
  return findings.some((f) => f.tier === "CAUGHT") ? 1 : 0;
}
