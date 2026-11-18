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
