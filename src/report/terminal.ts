import pc from "picocolors";
import type { AuditReport, EvidenceItem, Finding } from "../types.js";
import { messageFor, noteFor, resolveLocale, titleFor, type Locale } from "./messages.js";
import { displayWidth, wrapText } from "./width.js";

export interface TerminalOptions {
  color?: boolean;
  lang?: string;
  columns?: number;
}

const BAR = "│";

function time(ts: string): string {
  if (ts === "") return "        ";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "        ";
  return date.toTimeString().slice(0, 8);
}

/** Local time, like every other timestamp in the report. */
function shortDate(ts: string | undefined): string {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface Paint {
  caught(text: string): string;
  suspicious(text: string): string;
  dim(text: string): string;
  bold(text: string): string;
  location(text: string): string;
}

function painter(color: boolean): Paint {
  if (!color) {
    const plain = (text: string): string => text;
    return { caught: plain, suspicious: plain, dim: plain, bold: plain, location: plain };
  }
  return {
    caught: (text) => pc.bold(pc.red(text)),
    suspicious: (text) => pc.bold(pc.yellow(text)),
    dim: (text) => pc.dim(text),
    bold: (text) => pc.bold(text),
    location: (text) => pc.cyan(text),
  };
}

/**
 * One finding, told in three layers: what happened, what proves it, and what to
 * go check. The left bar keeps the layout intact no matter how wide the script
 * is — a box with a right edge falls apart in Korean.
 */
function renderFinding(
  finding: Finding,
  locale: Locale,
  paint: Paint,
  columns: number,
): string[] {
  const message = messageFor(locale, finding.messageKey, finding.messageVars);
  const tierText = finding.tier === "CAUGHT" ? locale.ui.caught : locale.ui.suspicious;
  const tier = finding.tier === "CAUGHT" ? paint.caught(tierText) : paint.suspicious(tierText);
  const where = finding.code ? `${finding.code.file}:${finding.code.line}` : "";

  const lines: string[] = [];
  // Title first, in plain words; the id after it is what --detectors accepts.
  lines.push(
    `  ${tier}  ${paint.bold(titleFor(locale, finding.messageKey))}  ${paint.dim(finding.detector)}${where ? `  ${paint.location(where)}` : ""}`,
  );

  const bar = paint.dim(BAR);
  for (const line of wrapText(message.narrative, columns - 4)) {
    lines.push(`  ${bar} ${line}`);
  }

  if (finding.evidence.length > 0) {
    lines.push(`  ${bar}`);
    lines.push(`  ${bar} ${paint.dim(locale.ui.evidence)}`);
    for (const item of finding.evidence) {
      lines.push(...renderEvidence(item, bar, paint, columns, locale));
    }
  }

  if (message.check !== "") {
    lines.push(`  ${bar}`);
    for (const [index, line] of wrapText(message.check, columns - 16).entries()) {
      const label = index === 0 ? `→ ${locale.ui.check}: ` : "  ";
      lines.push(`  ${bar} ${paint.bold(label)}${line}`);
    }
  }

  lines.push("");
  return lines;
}

function renderEvidence(
  item: EvidenceItem,
  bar: string,
  paint: Paint,
  columns: number,
  locale: Locale,
): string[] {
  const text = item.noteKey
    ? noteFor(locale, item.noteKey, item.noteVars ?? {}, item.excerpt)
    : item.excerpt;
  const stamp = paint.dim(time(item.ts));
  const body = text.split("\n");
  const out: string[] = [];
  for (const [index, raw] of body.entries()) {
    const wrapped = wrapText(raw, columns - 14);
    for (const [inner, line] of wrapped.entries()) {
      const prefix = index === 0 && inner === 0 ? stamp : " ".repeat(8);
      out.push(`  ${bar} ${prefix}  ${line}`);
    }
  }
  return out;
}

export function renderTerminal(report: AuditReport, options: TerminalOptions = {}): string {
  const color = options.color ?? true;
  const locale = resolveLocale(options.lang);
  const paint = painter(color);
  const columns = Math.min(Math.max(options.columns ?? 80, 48), 100);

  const caught = report.findings.filter((f) => f.tier === "CAUGHT");
  const suspicious = report.findings.filter((f) => f.tier === "SUSPICIOUS");

  const lines: string[] = [""];

  const headerParts: string[] = [paint.bold("RED-HANDED")];
  if (report.sessionsScanned !== undefined) {
    headerParts.push(`${locale.ui.sessionsScanned} ${report.sessionsScanned}`);
  } else if (report.sessionId) {
    const when = shortDate(report.startedAt);
    headerParts.push(
      `${locale.ui.session} ${report.sessionId.slice(0, 8)}${when ? ` (${when})` : ""}`,
    );
  }
  if (report.repoRoot) {
    const name = report.repoRoot.split("/").filter(Boolean).pop() ?? report.repoRoot;
    headerParts.push(`${locale.ui.repo} ${name}${report.branch ? ` @ ${report.branch}` : ""}`);
  }
  lines.push(`  ${headerParts.join(paint.dim(" · "))}`);

  const counts = [
    `${paint.caught(locale.ui.caught)} ${caught.length}`,
    `${paint.suspicious(locale.ui.suspicious)} ${suspicious.length}`,
    paint.dim(`${locale.ui.detectors} ${report.detectorCount}`),
  ];
  lines.push(`  ${counts.join("   ")}`);
  if (report.mode === "git-only") lines.push(`  ${paint.dim(locale.ui.gitOnlyNote)}`);
  lines.push("");

  if (report.findings.length === 0) {
    lines.push(`  ${locale.ui.clean}`);
    lines.push(`  ${paint.dim(locale.ui.cleanHint)}`);
    lines.push("");
    return lines.join("\n");
  }

  for (const finding of report.findings) {
    lines.push(...renderFinding(finding, locale, paint, columns));
  }

  const verdict = caught.length > 0 ? locale.ui.verdictCaught : locale.ui.verdictSuspicious;
  lines.push(`  ${paint.dim(verdict)}`);
  lines.push("");
  return lines.join("\n");
}

export { displayWidth };
