const LINE_GROUP = /\blines?\s+(\d+(?:\s*(?:[-–]|to|,|and)\s*\d+)*)/gi;
const NUM_OR_SEP = /(\d+)|([-–]|to|,|and)/gi;

function sepText(sep: string): string {
  if (/^[a-z]+$/i.test(sep)) return ` ${sep} `;
  return sep === "," ? ", " : sep;
}

/**
 * "line 100" / "lines 64-71" / "lines 27 and 29" become links to a `codeline:` pseudo-URL,
 * skipped inside code/fences. A dash or "to" between two numbers makes one range link; "," or
 * "and" link each number on its own.
 */
export function linkifyLines(md: string): string {
  return md
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => {
      if (i % 2) return part;
      return part.replace(LINE_GROUP, (whole, nums: string) => {
        const lead = whole.slice(0, whole.length - nums.length);
        const tokens = [...nums.matchAll(NUM_OR_SEP)];
        let out = "";
        for (let k = 0; k < tokens.length; k++) {
          const num = tokens[k][1];
          if (!num) continue; // a separator, already emitted by the number or range before it
          const sep = tokens[k + 1];
          const isRange = sep && !sep[1] && /^(-|–|to)$/i.test(sep[2] ?? "");
          if (isRange && tokens[k + 2]?.[1]) {
            const to = tokens[k + 2][1];
            out += `[${num}${sepText(sep![2]!)}${to}](codeline:${num}-${to})`;
            k += 2;
            // The separator after a range ("41-48 and 58-60") belongs to the range, not to a number.
            const after = tokens[k + 1];
            if (after && !after[1]) out += sepText(after[2]!);
          } else {
            out += `[${num}](codeline:${num}-${num})`;
            if (sep) out += sepText(sep[2]!);
          }
        }
        return lead + out;
      });
    })
    .join("");
}

/** Where a code link points: an absolute file and a line range. */
export interface CodeRef {
  file: string;
  from: number;
  to: number;
}

const CODE_URL = "code:";
export const codeHref = (r: CodeRef) => `${CODE_URL}${encodeURIComponent(r.file)}@${r.from}-${r.to}`;
export function parseCodeHref(href: string | undefined): CodeRef | null {
  const m = href?.startsWith(CODE_URL) ? /^code:([^@]+)@(\d+)-(\d+)$/.exec(href) : null;
  return m ? { file: decodeURIComponent(m[1]), from: Number(m[2]), to: Number(m[3]) } : null;
}

/** `path/file.ext`, `file.ext:12`, `file.ext:12-20` (a whole code span). */
const SPAN_FILE = /^\.?\/?([\w@.+/-]*[\w-]\.[A-Za-z0-9]{1,8})(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/;
/** `:12`, `:12-20`: a line in the file named just before. */
const SPAN_LINE = /^:(\d+)(?:\s*[-–]\s*(\d+))?$/;
/** file.ext:12 in plain text (no backticks). */
const TEXT_FILE = /(^|[\s(])([\w@.+/-]*[\w-]\.[A-Za-z0-9]{1,8}):(\d+)(?:\s*[-–]\s*(\d+))?/g;

/**
 * Lens prose cites code as `src/a.ts:12-20`, as a bare `:12` for the file named just before, or as
 * "lines 12-20" (in a step: that step's file, even after another file was named). Each becomes a link to `code:<file>@<from>-<to>`.
 * `resolve` maps a cited path (often just a base name) to a real file, or undefined to leave it as
 * text; `current` is the file a bare line means until a citation names another one.
 */
export function linkifyCode(md: string, resolve: (path: string) => string | undefined, current?: string): string {
  let last = current;
  const link = (label: string, file: string | undefined, from?: number, to?: number) => {
    if (!file) return null;
    return `[${label}](${codeHref({ file, from: from ?? 1, to: to ?? from ?? 1 })})`;
  };
  return md
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => {
      if (part.startsWith("```")) return part;
      if (i % 2) {
        const inner = part.slice(1, -1).trim();
        const f = SPAN_FILE.exec(inner);
        if (f) {
          const file = resolve(f[1]);
          if (file) last = file;
          return link(part, file, f[2] ? Number(f[2]) : undefined, f[3] ? Number(f[3]) : undefined) ?? part;
        }
        const l = SPAN_LINE.exec(inner);
        if (l) return link(part, last, Number(l[1]), l[2] ? Number(l[2]) : undefined) ?? part;
        return part;
      }
      // Plain text: file.ext:12 first (it names a file), then "line(s) N" in the current file.
      let text = part.replace(TEXT_FILE, (whole, lead: string, path: string, a: string, b?: string) => {
        const file = resolve(path);
        if (!file) return whole;
        last = file;
        return lead + link(whole.slice(lead.length), file, Number(a), b ? Number(b) : undefined);
      });
      // "lines 12-20": the step's own file when there is one (as the prompt defines it), else the last named.
      if (current ?? last) {
        const file = (current ?? last)!;
        text = linkifyLines(text).replace(/\]\(codeline:(\d+)-(\d+)\)/g, (_m, a: string, b: string) =>
          `](${codeHref({ file, from: Number(a), to: Number(b) })})`);
      }
      return text;
    })
    .join("");
}
