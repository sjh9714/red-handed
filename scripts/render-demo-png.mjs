#!/usr/bin/env node
/**
 * Renders `red-handed demo` into a crisp PNG through a real browser.
 *
 * The SVG route depended on whatever monospace font the viewer's system picked,
 * and it showed. Here the terminal frame is laid out as HTML with an explicit
 * font stack and screenshotted at 2x by headless Chrome, so what ships is
 * exactly what was rendered. The content is still the real command's output —
 * generated, never drawn.
 *
 *   npm run build && node scripts/render-demo-png.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const THEME = {
  page: "#0d1117",
  frame: "#161b22",
  border: "#30363d",
  text: "#c9d1d9",
  dim: "#8b949e",
  red: "#ff7b72",
  yellow: "#e3b341",
  cyan: "#79c0ff",
};

const WIDTH = 760;
const SCALE = 2;

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
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

const stripAnsi = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");
const FINDING_START = /^\s{2}(CAUGHT|SUSPICIOUS|검거|의심)\s{2}\S/;

/** Header plus the first two findings; the closing line counts the rest. */
function crop(lines, lang) {
  const starts = [];
  for (const [index, line] of lines.entries()) {
    if (FINDING_START.test(stripAnsi(line))) starts.push(index);
  }
  if (starts.length <= 2) return lines;
  const remaining = starts.length - 2;
  const more =
    lang === "ko"
      ? `  … 나머지 ${remaining}건은 직접 보세요:  npx red-handed demo --lang ko`
      : `  … ${remaining} more findings — see them yourself:  npx red-handed demo`;
  return [...lines.slice(0, starts[2]), `\x1b[2m${more}\x1b[22m`];
}

function toHtml(output, lang) {
  const lines = crop(output.replace(/\n+$/, "").split("\n"), lang);
  const body = lines
    .map((line) => {
      const runs = parseAnsi(line);
      if (runs.length === 0) return "";
      return runs
        .map((run) => {
          const color = run.dim ? THEME.dim : run.color ? THEME[run.color] : THEME.text;
          const weight = run.bold ? "font-weight:700;" : "";
          return `<span style="color:${color};${weight}">${escapeHtml(run.text)}</span>`;
        })
        .join("");
    })
    .join("\n");

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; }
  /* Laid out at 1x, rasterised at 2x: the zoom doubles every CSS pixel. */
  html { zoom: ${SCALE}; }
  body { width: ${WIDTH}px; background: ${THEME.page}; padding: 24px; box-sizing: border-box; }
  .frame {
    background: ${THEME.frame};
    border: 1px solid ${THEME.border};
    border-radius: 10px;
    padding: 14px 18px 18px;
    box-shadow: 0 8px 32px rgba(0,0,0,.45);
  }
  .dots { display: flex; gap: 7px; margin-bottom: 12px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .term {
    font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.5;
    white-space: pre;
    -webkit-font-smoothing: antialiased;
  }
</style></head><body>
  <div class="frame">
    <div class="dots">
      <div class="dot" style="background:#ff5f57"></div>
      <div class="dot" style="background:#febc2e"></div>
      <div class="dot" style="background:#28c840"></div>
    </div>
    <div class="term">${body}</div>
  </div>
</body></html>`;
}

function render(lang, outFile) {
  let output;
  try {
    output = execFileSync(
      process.execPath,
      [join(root, "dist/cli.js"), "demo", "--lang", lang],
      { encoding: "utf8", env: { ...process.env, FORCE_COLOR: "1" }, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch (error) {
    // The demo exits 1 on purpose: it caught things.
    if (!error || typeof error.stdout !== "string" || error.stdout === "") throw error;
    output = error.stdout;
  }

  const out = join(root, "docs/shots");
  mkdirSync(out, { recursive: true });
  const page = join(out, `${lang}.html`);
  writeFileSync(page, toHtml(output, lang));
  const lineCount = crop(output.replace(/\n+$/, "").split("\n"), lang).length;
  const height = Math.ceil((48 + 44 + lineCount * 12.5 * 1.55 + 18) * SCALE);
  console.log(`${page}  viewport ${WIDTH * SCALE}x${height}`);
}

render("en", join(root, "docs/demo.png"));
render("ko", join(root, "docs/demo.ko.png"));
