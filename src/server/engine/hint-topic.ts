// A leading ladder code, with the small words that tie it to the topic ("H2 on caching", "Level 3: sharding").
// A hyphen straight after the code belongs to a word ("H2-compatible"), so only a spaced dash counts.
const LEVEL_CODE = /^(?:h[1-3]|level ?[1-3])(?:$| ?[:,.] ?| [–—-] | )(?:(?:on|about|for) )?/i;

/** What a hint is filed under when the model gave only white space. */
const NO_TOPIC = "No topic given";

/**
 * The topic of a recorded hint in plain words. The model sometimes opens the topic with the ladder code, and the
 * topic is later shown to the candidate, who never sees those codes anywhere else.
 */
export function plainHintTopic(topic: string): string {
  const trimmed = topic.trim();
  if (trimmed === "") return NO_TOPIC;
  const plain = trimmed.replace(LEVEL_CODE, "").trim();
  // A topic that had no code stays as written: a name such as "gRPC" must keep its own capitals.
  if (plain === "" || plain === trimmed) return trimmed;
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}
