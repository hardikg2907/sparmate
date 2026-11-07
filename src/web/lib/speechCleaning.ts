/** Prepares markdown text for speech synthesis by removing symbols and omitting code. */
export function cleanMarkdownForSpeech(markdown: string, isFinal = false): string {
  let text = markdown;

  // Replace completed fenced code blocks with an explicit omission note.
  text = text.replace(/```[a-zA-Z0-9_-]*\n?[\s\S]*?```/g, " code block omitted. ");

  // Prevent speaking unclosed code currently streaming in by cutting or omitting it.
  const backtickCount = (text.match(/```/g) || []).length;
  if (backtickCount % 2 === 1) {
    const lastOpen = text.lastIndexOf("```");
    if (isFinal) {
      text = text.slice(0, lastOpen) + " code block omitted. ";
    } else {
      text = text.slice(0, lastOpen);
    }
  }

  // Strip inline code delimiters while keeping the code identifier.
  text = text.replace(/`([^`]+)`/g, "$1");

  // Keep link text and discard destinations.
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Discard images entirely.
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, " ");

  // Turn headings into punctuated sentences so sentence splitting separates them.
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "$1. ");

  // Strip list markers and blockquote prefixes from line starts.
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");
  text = text.replace(/^\s*>\s+/gm, "");

  // Strip bold, italic, and strikethrough markup.
  text = text.replace(/[*_~]{1,3}(.*?)[*_~]{1,3}/g, "$1");

  // Strip horizontal rules and raw HTML tags.
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");
  text = text.replace(/<[^>]+>/g, " ");

  // Collapse whitespace while keeping spacing around punctuation clean.
  text = text.replace(/\s+/g, " ");
  text = text.replace(/\s+([.,!?:;])/g, "$1");

  return text.trim();
}
