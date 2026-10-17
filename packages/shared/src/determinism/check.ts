// Finds calls that would make map generation differ between runs or machines. Generation must use
// SeededRng and integer maths only. This is a plain text scan, not a full parser, because the
// TypeScript lint tooling does not support our TypeScript version yet.
export interface Violation {
  line: number;
  text: string;
  reason: string;
}

const RULES: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bMath\.random\b/, reason: "Math.random is unseeded. Use SeededRng." },
  { pattern: /\bDate\b/, reason: "Dates and clocks differ every run. Use the seed." },
  { pattern: /\bperformance\b/, reason: "Clocks differ every run. Use the seed." },
  { pattern: /\bcrypto\b/, reason: "Cryptographic randomness is unseeded. Use SeededRng." },
  {
    pattern: /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|exp|log|log2|log10|pow|sinh|cosh|tanh)\b/,
    reason: "This maths function can differ between browsers and CPUs. Keep it out of generation.",
  },
  { pattern: /[\w)\]]\s*\*\*\s*[\w(]/, reason: "The ** operator can differ between engines. Keep it out of generation." },
];

// Blanks out comments and text in quotes, keeping line numbers, so words in them do not count.
function stripNonCode(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === "\\") i++;
        if (source[i] === "\n") out += "\n";
        i++;
      }
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function findViolations(source: string): Violation[] {
  const found: Violation[] = [];
  const original = source.split("\n");
  stripNonCode(source).split("\n").forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) found.push({ line: index + 1, text: (original[index] ?? "").trim(), reason: rule.reason });
    }
  });
  return found;
}
