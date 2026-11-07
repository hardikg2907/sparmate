const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs", "etc", "e.g", "i.e"]);

/** Splits streamed text into completed sentences, keeping unfinalized trailing text in remainder. */
export function splitSentences(text: string, isFinal = false): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let start = 0;
  let i = 0;

  while (i < text.length) {
    const char = text.charAt(i);

    // Treat blank line paragraph breaks as distinct sentence boundaries.
    if (char === "\n" && i + 1 < text.length && text.charAt(i + 1) === "\n") {
      const sentence = text.slice(start, i).trim();
      if (sentence.length > 0) sentences.push(sentence);
      while (i < text.length && /\s/.test(text.charAt(i))) i++;
      start = i;
      continue;
    }

    if (char === "." || char === "!" || char === "?") {
      let punctEnd = i + 1;
      while (punctEnd < text.length && (text.charAt(punctEnd) === "." || text.charAt(punctEnd) === "!" || text.charAt(punctEnd) === "?")) {
        punctEnd++;
      }
      while (punctEnd < text.length && /['")\]}]/.test(text.charAt(punctEnd))) {
        punctEnd++;
      }

      const atEnd = punctEnd >= text.length;
      const followedBySpace = atEnd ? isFinal : /\s/.test(text.charAt(punctEnd));

      if (followedBySpace) {
        let isAbbr = false;
        // Avoid breaking on decimal points or common abbreviations.
        if (char === "." && (punctEnd - i === 1 || text.slice(i, punctEnd) === "...")) {
          if (i > 0 && /\d/.test(text.charAt(i - 1)) && punctEnd < text.length && /\d/.test(text.charAt(punctEnd))) {
            isAbbr = true;
          } else {
            const before = text.slice(start, i);
            const wordMatch = before.match(/([a-zA-Z.]+)\s*$/);
            const matchedWord = wordMatch?.[1];
            if (matchedWord) {
              const token = matchedWord.toLowerCase().replace(/\.$/, "");
              if (ABBREVIATIONS.has(token) || ABBREVIATIONS.has(matchedWord.toLowerCase())) {
                isAbbr = true;
              }
            }
          }
        }

        if (!isAbbr) {
          const sentence = text.slice(start, punctEnd).trim();
          if (sentence.length > 0) sentences.push(sentence);
          i = punctEnd;
          while (i < text.length && /\s/.test(text.charAt(i))) i++;
          start = i;
          continue;
        }
      }
    }
    i++;
  }

  const remainder = text.slice(start);
  if (isFinal) {
    const finalSentence = remainder.trim();
    if (finalSentence.length > 0) {
      sentences.push(finalSentence);
    }
    return { sentences, remainder: "" };
  }

  return { sentences, remainder };
}
