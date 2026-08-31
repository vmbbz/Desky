const compactWhitespace = /\s+/g;

/**
 * Produces a compact, readable ambient preview from provider Markdown.
 * The complete source remains untouched for the formatted control-center view.
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*```[^\n]*\n?/gm, '')
    .replace(/^\s*~~~[^\n]*\n?/gm, '')
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^\n)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>)\s?/gm, '')
    .replace(/^\s*[-+*]\s+/gm, '• ')
    .replace(/^\s*\d+[.)]\s+/gm, '• ')
    .replace(/<((?:https?|mailto):[^>]+)>/gi, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(compactWhitespace, ' ')
    .trim();
}

export function responseBubbleLifetimeMs(text: string): number {
  const readableCharactersPerSecond = 18;
  const minimumMs = 8_000;
  const maximumMs = 18_000;
  const readingMs = Math.ceil(text.length / readableCharactersPerSecond) * 1_000;
  return Math.max(minimumMs, Math.min(maximumMs, readingMs + 3_000));
}
