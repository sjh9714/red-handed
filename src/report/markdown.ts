import type { AuditReport } from "../types.js";
import { messageFor, resolveLocale } from "./messages.js";

export interface MarkdownOptions {
  lang?: string;
}

/** For pasting into a pull request or an issue. */
export function renderMarkdown(report: AuditReport, options: MarkdownOptions = {}): string {
  const locale = resolveLocale(options.lang);
  const caught = report.findings.filter((f) => f.tier === "CAUGHT").length;
  const suspicious = report.findings.length - caught;

  const lines: string[] = [];
  lines.push(`## red-handed`);
  lines.push("");
  lines.push(
    `**${locale.ui.caught} ${caught}** · ${locale.ui.suspicious} ${suspicious} · ${locale.ui.detectors} ${report.detectorCount}`,
  );
  if (report.mode === "git-only") lines.push(`> ${locale.ui.gitOnlyNote}`);
  lines.push("");

  if (report.findings.length === 0) {
    lines.push(locale.ui.clean);
    lines.push("");
    return lines.join("\n");
  }

  for (const finding of report.findings) {
    const message = messageFor(locale, finding.messageKey, finding.messageVars);
    const tier = finding.tier === "CAUGHT" ? locale.ui.caught : locale.ui.suspicious;
    const where = finding.code ? ` — \`${finding.code.file}:${finding.code.line}\`` : "";
    lines.push(`### ${tier} · ${finding.detector}${where}`);
    lines.push("");
    lines.push(message.narrative);
    lines.push("");
    if (finding.evidence.length > 0) {
      lines.push(`<details><summary>${locale.ui.evidence}</summary>`);
      lines.push("");
      lines.push("```");
      for (const item of finding.evidence) {
        const stamp = item.ts === "" ? "" : `${new Date(item.ts).toTimeString().slice(0, 8)}  `;
        lines.push(`${stamp}${item.excerpt}`);
      }
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
    if (message.check !== "") {
      lines.push(`**${locale.ui.check}:** ${message.check}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
