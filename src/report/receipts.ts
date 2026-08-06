import pc from "picocolors";
import type { ReceiptsReport } from "../receipts.js";

/** Where everyone else posted theirs. A thread, not a service, so there is nothing to run and nothing to trust. */
export const SCOREBOARD = "github.com/sjh9714/red-handed/issues/4";

const pct = (n: number, of: number): string => `${Math.round((100 * n) / Math.max(of, 1))}%`;

/**
 * One screen. Someone should read the number in three seconds and screenshot
 * the whole thing without scrolling, because that is how it travels.
 */
export function renderReceipts(report: ReceiptsReport, color = true): string {
  const c = color
    ? pc
    : { bold: (s: string) => s, dim: (s: string) => s, red: (s: string) => s };
  const out: string[] = [""];

  if (report.total === 0) {
    out.push("  No test runs found in any session on this machine.");
    out.push(c.dim("  Nothing to shred. Come back after your agent runs some tests."));
    out.push("");
    return out.join("\n");
  }

  out.push(`  Your agent ran the tests ${c.bold(String(report.total))} times.`);
  const count = String(report.shredded);
  out.push(
    `  It shredded the result ${c.bold(c.red(count))} of them.` +
      `${" ".repeat(Math.max(1, 22 - count.length))}${c.bold(pct(report.shredded, report.total))}`,
  );

  if (report.selfInflicted > 0) {
    out.push("");
    out.push(`  ${report.selfInflicted} of those it did to itself, piping the output`);
    out.push("  through tail, head or grep before anything could read it.");
    out.push("");
    for (const { command, count: n } of report.worstCommands) {
      out.push(`    ${c.dim(command.padEnd(56).slice(0, 56))} ${String(n).padStart(4)}`);
    }
  }

  const frameworks = [...report.byFramework.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, s]) => `${name} ${s.shredded} of ${s.total}`)
    .join("   ");
  out.push("");
  out.push(`  ${c.dim(`shredded by runner:  ${frameworks}`)}`);
  out.push(`  ${c.dim(`${report.sessions} sessions scanned`)}`);
  out.push("");
  out.push(`  ${c.dim("compare yours:")}  ${SCOREBOARD}`);
  out.push(`  ${c.dim("paste this:")}     ${shareLine(report)}`);
  out.push("");
  return out.join("\n");
}

/**
 * One line, ready to paste into the scoreboard thread.
 *
 * The same shape for everyone so the thread reads as a column of comparable
 * numbers rather than a pile of prose. Riskier than the JSON if anything,
 * because people paste it in public without reading it first, so it carries no
 * path, no command and no repository name either.
 */
export function shareLine(report: ReceiptsReport): string {
  const runners = [...report.byFramework.entries()]
    .filter(([name]) => name !== "generic")
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name]) => name)
    .slice(0, 3)
    .join(" ");
  return (
    `${pct(report.shredded, report.total)} shredded` +
    ` · ${report.shredded} of ${report.total} runs` +
    ` · ${report.selfInflicted} self-inflicted` +
    (runners ? ` · ${runners}` : "")
  );
}

/** Every number the count holds. Nothing here identifies a repository or a person. */
export function receiptsPayload(report: ReceiptsReport): Record<string, unknown> {
  return {
    runs: report.total,
    shredded: report.shredded,
    selfInflicted: report.selfInflicted,
    sessions: report.sessions,
    byFramework: Object.fromEntries(
      [...report.byFramework.entries()].map(([name, s]) => [name, [s.shredded, s.total]]),
    ),
  };
}
