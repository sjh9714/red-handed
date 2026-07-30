/**
 * Terminal width for text that may be Korean, Japanese or Chinese.
 *
 * Reports get read and screenshotted in those languages, and a layout measured
 * in characters rather than columns falls apart the moment it is.
 */

const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi
  [0x3041, 0x33ff], // Hiragana, Katakana, Bopomofo, CJK compatibility
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f], // Emoji
  [0x1f900, 0x1f9ff],
];

const ZERO_WIDTH_RANGES: Array<[number, number]> = [
  [0x0300, 0x036f], // Combining marks
  [0x200b, 0x200f], // Zero-width and direction marks
  [0xfe00, 0xfe0f], // Variation selectors
];

function widthOf(codePoint: number): number {
  for (const [start, end] of ZERO_WIDTH_RANGES) {
    if (codePoint >= start && codePoint <= end) return 0;
  }
  for (const [start, end] of WIDE_RANGES) {
    if (codePoint >= start && codePoint <= end) return 2;
  }
  return 1;
}

export function displayWidth(text: string): number {
  let total = 0;
  for (const char of text) {
    const point = char.codePointAt(0);
    if (point === undefined) continue;
    total += widthOf(point);
  }
  return total;
}

/** Wraps on columns, never splitting a word that fits on a line of its own. */
export function wrapText(text: string, columns: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/).filter((w) => w !== "")) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (displayWidth(candidate) <= columns) {
        current = candidate;
        continue;
      }
      if (current !== "") lines.push(current);
      if (displayWidth(word) <= columns) {
        current = word;
        continue;
      }
      // A single word wider than the line: break it on columns.
      let chunk = "";
      for (const char of word) {
        if (displayWidth(chunk + char) > columns) {
          lines.push(chunk);
          chunk = char;
        } else {
          chunk += char;
        }
      }
      current = chunk;
    }
    lines.push(current);
  }
  return lines.filter((line, index, all) => line !== "" || all.length === 1);
}

export function padTo(text: string, columns: number): string {
  const gap = columns - displayWidth(text);
  return gap > 0 ? text + " ".repeat(gap) : text;
}
