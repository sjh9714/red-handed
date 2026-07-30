import type { Detector, DetectorContext, Finding } from "../types.js";
import { claimNoRun } from "./claim-no-run.js";
import { claimVsFail } from "./claim-vs-fail.js";
import { configDisable } from "./config-disable.js";
import { errorSwallowing } from "./error-swallowing.js";
import { hardcodedExpected } from "./hardcoded-expected.js";
import { noVerify } from "./no-verify.js";
import { skipOnly } from "./skip-only.js";
import { testCensus } from "./test-census.js";

/** Ordered by how much a reader should trust them. */
export const DETECTORS: Detector[] = [
  noVerify,
  skipOnly,
  claimVsFail,
  claimNoRun,
  hardcodedExpected,
  testCensus,
  configDisable,
  errorSwallowing,
];

/** Detectors that can run without a session transcript, on a diff alone. */
export const GIT_ONLY_DETECTORS = new Set(["skip-only", "config-disable", "error-swallowing"]);

export interface RunOptions {
  detectors?: string[];
  exclude?: string[];
}

const TIER_ORDER = { CAUGHT: 0, SUSPICIOUS: 1 } as const;

/** Two edits landing on the same line are one problem, not two. */
function identity(finding: Finding): string {
  return [
    finding.detector,
    finding.messageKey,
    finding.code ? `${finding.code.file}:${finding.code.line}` : "",
    finding.code ? "" : (finding.evidence[0]?.excerpt ?? ""),
  ].join("|");
}

export function runDetectors(ctx: DetectorContext, options: RunOptions = {}): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const detector of DETECTORS) {
    if (options.detectors && !options.detectors.includes(detector.id)) continue;
    if (options.exclude?.includes(detector.id)) continue;
    if (ctx.mode === "git-only" && !GIT_ONLY_DETECTORS.has(detector.id)) continue;
    for (const finding of detector.run(ctx)) {
      const key = identity(finding);
      if (seen.has(key)) continue;
      seen.add(key);
      // Without a transcript there is no proof of intent, so nothing is certain.
      findings.push(ctx.mode === "git-only" ? { ...finding, tier: "SUSPICIOUS" } : finding);
    }
  }

  return findings.sort((a, b) => {
    const tier = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tier !== 0) return tier;
    return DETECTORS.findIndex((d) => d.id === a.detector) - DETECTORS.findIndex((d) => d.id === b.detector);
  });
}
