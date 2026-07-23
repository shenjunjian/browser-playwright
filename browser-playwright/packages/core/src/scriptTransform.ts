/**
 * Lightweight script prep for runScript: strip ESM imports (preserve line
 * numbers) and inject `await __bp.checkpoint(line)` before executable lines.
 */

const IMPORT_LINE =
  /^[ \t]*import\s+(?:type\s+)?(?:[\s\S]*?)\s*from\s*['"][^'"]+['"][ \t]*;?[ \t]*$/;

/** Replace import lines with blanks so original line numbers stay stable. */
export function stripImportsPreserveLines(source: string): string {
  const lines = source.split("\n");
  return lines
    .map((line) => (IMPORT_LINE.test(line) ? "" : line))
    .join("\n");
}

function shouldInstrumentLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (trimmed.startsWith("//")) return false;
  if (
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.endsWith("*/")
  )
    return false;
  if (/^[{}();,\[\]]+$/.test(trimmed)) return false;
  if (/^(\}\)|\}\);|\);|;|,)$/.test(trimmed)) return false;
  if (/^\}\s*;?\s*$/.test(trimmed)) return false;
  // Arrow / fixture headers: `async ({ page }) => {`
  if (
    /^(async\s*)?\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{?\s*$/.test(trimmed) ||
    /^async\s*\(\s*\{\s*[^}]*\}\s*\)\s*=>\s*\{?\s*$/.test(trimmed)
  )
    return false;
  // Continuations of chained calls
  if (trimmed.startsWith(".") || trimmed.startsWith("?.")) return false;
  if (trimmed.includes("__bp.checkpoint")) return false;
  return true;
}

/**
 * Insert checkpoints before executable lines. Line numbers are 1-based and
 * refer to the original source (same as UI highlight).
 */
export function instrumentScript(source: string): string {
  const cleaned = stripImportsPreserveLines(source);
  const lines = cleaned.split("\n");
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const lineNo = i + 1;
    if (shouldInstrumentLine(trimmed)) {
      const indent = line.match(/^[ \t]*/)?.[0] ?? "";
      out.push(`${indent}await __bp.checkpoint(${lineNo});`);
    }
    out.push(line);
  }

  return out.join("\n");
}
