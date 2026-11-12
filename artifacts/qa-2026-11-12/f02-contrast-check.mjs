import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(directory, "../../styles.css"), "utf8");
function tokens(block) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[\da-f]{3,8})\s*;/gi)].map((m) => [m[1], m[2]]));
}
const light = tokens(css.match(/:root\s*\{([^}]+)\}/)[1]);
const dark = { ...light, ...tokens(css.match(/\[data-theme="dark"\]\s*\{([^}]+)\}/)[1]) };
function luminance(hex) {
  let digits = hex.slice(1);
  if (digits.length === 3) digits = [...digits].map((c) => c + c).join("");
  const channels = digits.match(/../g).map((c) => parseInt(c, 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const checks = [];
for (const [theme, palette] of Object.entries({ light, dark })) {
  const add = (name, foreground, background, minimum = 4.5) => {
    const fg = palette[foreground] || foreground, bg = palette[background] || background;
    const ratio = contrast(fg, bg);
    checks.push({ theme, name, foreground: fg, background: bg, ratio: Number(ratio.toFixed(2)), minimum, pass: ratio >= minimum });
  };
  for (const surface of ["--bg", "--surface", "--surface-soft"]) {
    add(`Main text / ${surface}`, "--ink", surface);
    add(`Secondary text / ${surface}`, "--muted", surface);
    add(`Financial negative / ${surface}`, "--danger-ink", surface);
    add(`Positive / ${surface}`, "--success", surface);
    add(`Warning / ${surface}`, "--warning", surface);
    add(`Focus / ${surface}`, "--focus", surface, 3);
  }
  add("Warnings and field errors", "--danger-ink", "--accent-soft");
  add("Selected navigation and links", "--accent-ink", "--accent-soft");
  add("Focus around tinted panels", "--focus", "--accent-soft", 3);
  add("Primary action", "#fff", "--accent");
  add("Primary action hover", "#fff", "--accent-strong");
  add("Destructive filled action", "#fff", "--danger");
  add("Form field boundary", "--line-strong", theme === "dark" ? "#121519" : "--surface", 3);
}
checks.push({ theme: "both", name: "Authentication focus on fixed dark card", foreground: "#ff7378", background: "#111", ratio: Number(contrast("#ff7378", "#111").toFixed(2)), minimum: 3, pass: contrast("#ff7378", "#111") >= 3 });
const report = {
  verification: "Static sRGB WCAG contrast calculation from styles.css token pairs. This is NOT computed browser style, screenshot QA, or a user-flow test.",
  sourceSha256: createHash("sha256").update(css).digest("hex"),
  baseline: {
    whiteTextOnWhite: Number(contrast("#f5f6f8", "#fff").toFixed(2)),
    oldFocusOnDarkSurface: Number(contrast("#a70f16", "#191c20").toFixed(2)),
    oldNegativeOnDarkSurface: Number(contrast("#b61117", "#191c20").toFixed(2))
  },
  checks,
  passed: checks.filter((c) => c.pass).length,
  total: checks.length,
  browser: { verifiedViewports: [], status: "Blocked: Windows Computer Use could not determine Chrome URL confidently; in-app browser unavailable. No new screenshots or browser claims." }
};
writeFileSync(resolve(directory, "f02-contrast-results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ passed: report.passed, total: report.total, baseline: report.baseline, failures: checks.filter((c) => !c.pass) }, null, 2));
if (report.passed !== report.total) process.exitCode = 1;
