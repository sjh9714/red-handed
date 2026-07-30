#!/usr/bin/env node
/**
 * Renders `red-handed demo` into an SVG for the README.
 *
 * The image is generated from the real command, never drawn by hand, so what
 * the README shows is what the tool prints. Rerun after changing the report:
 *
 *   npm run build && node scripts/render-demo-svg.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const THEME = {
  background: "#161b22",
  frame: "#30363d",
  text: "#c9d1d9",
  dim: "#8b949e",
  red: "#ff7b72",
  yellow: "#d29922",
  cyan: "#79c0ff",
};

const FONT =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const FONT_SIZE = 12.5;
const LINE_HEIGHT = 19;
const PAD_X = 18;
const PAD_Y = 26;
const WIDTH = 720;

function escapeXml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Splits one line of ANSI-coloured text into styled runs. */
function parseAnsi(line) {
  const runs = [];
  let bold = false;
  let dim = false;
  let color = null;
  let buffer = "";
  const flush = () => {
    if (buffer !== "") runs.push({ text: buffer, bold, dim, color });
    buffer = "";
  };

  const parts = line.split(/(\x1b\[[0-9;]*m)/);
  for (const part of parts) {
    const code = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (!code) {
      buffer += part;
      continue;
    }
    flush();
    for (const value of (code[1] === "" ? "0" : code[1]).split(";")) {
      switch (value) {
        case "0": bold = false; dim = false; color = null; break;
        case "1": bold = true; break;
        case "2": dim = true; break;
        case "22": bold = false; dim = false; break;
        case "31": color = "red"; break;
        case "33": color = "yellow"; break;
        case "36": color = "cyan"; break;
        case "39": color = null; break;
        default: break;
      }
    }
  }
  flush();
  return runs;
}

function render(lang, outFile) {
  const output = execFileSync(process.execPath, [join(root, "dist/cli.js"), "demo", "--lang", lang], {
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "1" },
    // The demo exits 1 on purpose: it caught things.
    stdio: ["ignore", "pipe", "ignore"],
  });
  return toSvg(output, outFile, lang);
}

const stripAnsi = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");
// Two spaces after the tier word: the summary line ("CAUGHT 6") has only one.
const FINDING_START = /^\s{2}(CAUGHT|SUSPICIOUS|검거|의심)\s{2}\S/;

/**
 * Keeps the header and the first two findings; a README hero a screen and a
 * half tall gets scrolled past, not read. The closing line says how many more
 * the command itself prints.
 */
function crop(lines, lang) {
  const starts = [];
  for (const [index, line] of lines.entries()) {
    if (FINDING_START.test(stripAnsi(line))) starts.push(index);
  }
  if (starts.length <= 2) return lines;
  const cut = starts[2];
  const remaining = starts.length - 2;
  const more =
    lang === "ko"
      ? `  … 나머지 ${remaining}건은 직접 보세요:  npx red-handed demo --lang ko`
      : `  … ${remaining} more findings — see them yourself:  npx red-handed demo`;
  return [...lines.slice(0, cut), `\x1b[2m${more}\x1b[22m`, ""];
}

function toSvg(output, outFile, lang) {
  const lines = crop(output.replace(/\n+$/, "").split("\n"), lang);
  const height = PAD_Y + lines.length * LINE_HEIGHT + 18;

  const body = lines
    .map((line, index) => {
      const y = PAD_Y + (index + 1) * LINE_HEIGHT - 6;
      const runs = parseAnsi(line);
      if (runs.length === 0) return "";
      const spans = runs
        .map((run) => {
          const fill = run.dim ? THEME.dim : run.color ? THEME[run.color] : THEME.text;
          const weight = run.bold ? ' font-weight="600"' : "";
          return `<tspan fill="${fill}"${weight}>${escapeXml(run.text)}</tspan>`;
        })
        .join("");
      return `<text x="${PAD_X}" y="${y}" xml:space="preserve">${spans}</text>`;
    })
    .filter((line) => line !== "")
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="red-handed terminal report">
<rect width="${WIDTH}" height="${height}" rx="8" fill="${THEME.background}" stroke="${THEME.frame}"/>
<circle cx="20" cy="16" r="5" fill="#ff5f57"/><circle cx="38" cy="16" r="5" fill="#febc2e"/><circle cx="56" cy="16" r="5" fill="#28c840"/>
<g font-family="${FONT}" font-size="${FONT_SIZE}">
${body}
</g>
</svg>
`;
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, svg);
  console.log(`${outFile}: ${lines.length} lines`);
}

let failed = false;
for (const [lang, file] of [
  ["en", "docs/demo.svg"],
  ["ko", "docs/demo.ko.svg"],
]) {
  try {
    render(lang, join(root, file));
  } catch (error) {
    // execFileSync throws on exit 1, but the demo's whole point is exiting 1.
    if (error && typeof error.stdout === "string" && error.stdout !== "") {
      toSvg(error.stdout, join(root, file), lang);
    } else {
      console.error(`failed to render ${lang}:`, error?.message ?? error);
      failed = true;
    }
  }
}
process.exit(failed ? 1 : 0);
