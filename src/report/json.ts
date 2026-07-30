import type { AuditReport } from "../types.js";

/** Stable machine-readable output. Nothing here is localised. */
export function renderJson(report: AuditReport): string {
  const caught = report.findings.filter((f) => f.tier === "CAUGHT").length;
  const suspicious = report.findings.length - caught;
  return `${JSON.stringify(
    {
      version: 1,
      session: report.sessionId ?? null,
      startedAt: report.startedAt ?? null,
      transcript: report.transcriptPath ?? null,
      repo: report.repoRoot,
      branch: report.branch,
      mode: report.mode,
      sessionsScanned: report.sessionsScanned ?? null,
      summary: { caught, suspicious, detectors: report.detectorCount },
      findings: report.findings,
    },
    null,
    2,
  )}\n`;
}
