import { phasesFor, type Track } from "./phases";
import type { ChecklistItem } from "./types";

const MAX_LABEL = 140;
const MAX_ITEMS = 12;
const MAX_ASK = 160;
const MAX_LINE = 1000;

type Sections = Readonly<Record<string, string | undefined>>;

/** Plain text of a Markdown fragment: code spans, bold and links reduced to their words, trailing stop removed. */
export function plainLabel(markdown: string, max: number = MAX_LABEL): string {
  const text = markdown
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const stripped = text.replace(/`([^`]*)`/g, "$1").replace(/[.:;,]+$/, "");
  if (stripped.length <= max) return stripped;

  // Truncating inside syntax blocks breaks expression readability.
  let inCode = false;
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let clauseCut = -1;
  let spaceCut = -1;
  let anyCut = -1;
  let visibleLen = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "`") {
      inCode = !inCode;
      continue;
    }
    visibleLen++;
    if (visibleLen > max - 1) break;

    if (!inCode) {
      if (ch === "(") parens++;
      else if (ch === ")" && parens > 0) parens--;
      else if (ch === "[") brackets++;
      else if (ch === "]" && brackets > 0) brackets--;
      else if (ch === "{") braces++;
      else if (ch === "}" && braces > 0) braces--;

      if (parens === 0 && brackets === 0 && braces === 0) {
        anyCut = i + 1;
        if (ch === " ") {
          spaceCut = i;
        } else if (ch === "," || ch === ";" || ch === ":" || ch === ")" || ch === "]" || ch === "}") {
          clauseCut = i + 1;
        }
      }
    }
  }

  const cutIndex = clauseCut > 40 ? clauseCut : (spaceCut > 40 ? spaceCut : (anyCut > 0 ? anyCut : max - 1));
  const cut = text.slice(0, cutIndex).replace(/`([^`]*)`/g, "$1").replace(/[.,;:\s]+$/, "");
  return `${cut}…`;
}

function lines(section: string | undefined): string[] {
  return (section ?? "").split("\n");
}

function numbered(section: string | undefined): string[] {
  return lines(section).flatMap((l) => {
    const m = /^\s*\d+\.\s+(.+)$/.exec(l);
    return m?.[1] ? [m[1]] : [];
  });
}

/**
 * Splits a trailing italic "*Ask: question*" off a requirement line. Anchored at the end and found with plain string
 * checks, so a long or odd line cannot make it backtrack.
 */
function splitAsk(line: string): { text: string; ask?: string } {
  const text = line.length > MAX_LINE ? line.slice(0, MAX_LINE) : line;
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith("*")) return { text: trimmed };
  const open = trimmed.lastIndexOf("*Ask:", trimmed.length - 2);
  if (open < 0) return { text: trimmed };
  const question = trimmed.slice(open + "*Ask:".length, -1);
  if (question.includes("*")) return { text: trimmed };
  const ask = plainLabel(question, MAX_ASK);
  if (ask === "") return { text: trimmed };
  return { text: trimmed.slice(0, open).trimEnd(), ask };
}

function bullets(section: string | undefined): string[] {
  return lines(section).flatMap((l) => {
    const m = /^- (.+)$/.exec(l);
    return m?.[1] ? [m[1]] : [];
  });
}

/** The bold lead of a bullet ("**Writes:** ..." gives "Writes"), or null. */
function boldLead(text: string): string | null {
  const m = /^\*\*([^*]+?):?\*\*/.exec(text.trim());
  return m?.[1] ? m[1].replace(/:$/, "") : null;
}

/** The code span a bullet opens with ("`POST /urls` with ..." gives "POST /urls"), or null. */
function codeLead(text: string): string | null {
  const m = /^`([^`]+)`/.exec(text.trim());
  return m?.[1] ?? null;
}

export function firstSentence(text: string): string {
  const body = text.replace(/^\*\*[^*]+?\*\*:?\s*/, "");
  // Question marks inside optional field definitions do not terminate sentences.
  let inCode = false;
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  let cutIndex = -1;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "`") {
      inCode = !inCode;
    } else if (!inCode) {
      if (ch === "(") parens++;
      else if (ch === ")" && parens > 0) parens--;
      else if (ch === "[") brackets++;
      else if (ch === "]" && brackets > 0) brackets--;
      else if (ch === "{") braces++;
      else if (ch === "}" && braces > 0) braces--;
      if ((ch === "." || ch === "!" || ch === "?") && parens === 0 && brackets === 0 && braces === 0) {
        if (i + 1 === body.length || /\s/.test(body[i + 1]!)) {
          cutIndex = i;
          break;
        }
      }
    }
  }

  const sentence = cutIndex >= 0 ? body.slice(0, cutIndex) : body;
  return plainLabel(sentence);
}

/** "API and entities" splits into the endpoints under "External API" and the entities under "Core entities". */
function apiItems(section: string | undefined): string[] {
  let part: "api" | "entities" | null = null;
  const rawApi: string[] = [];
  const rawEntities: string[] = [];
  const messageGroups: { prefix: string; messages: string[] }[] = [];

  for (const line of lines(section)) {
    if (/^external api/i.test(line.trim())) part = "api";
    else if (/^(core )?entities/i.test(line.trim())) part = "entities";
    const m = /^- (.+)$/.exec(line);
    if (!m?.[1]) continue;
    const bullet = m[1];

    if (part === "entities") {
      // Entity schemas often list multiple types on a single line.
      const leadMatch = /^`([^`]+)`/.exec(bullet.trim());
      const set = new Set<string>();
      if (leadMatch?.[1]) {
        const lead = leadMatch[1].replace(/\s*\{.*$/, "").trim();
        if (/^[A-Z][A-Za-z0-9]+$/.test(lead)) set.add(lead);
      }
      for (const match of bullet.matchAll(/`([A-Z][A-Za-z0-9]+)\s*\{/g)) {
        if (match[1]) set.add(match[1]);
      }
      for (const ent of set) {
        if (!rawEntities.includes(`Entity ${ent}`)) {
          rawEntities.push(`Entity ${ent}`);
        }
      }
      continue;
    }

    // Bullets frequently define complementary operations like create and delete together.
    const epMatches = [...bullet.matchAll(/`((?:GET|POST|PUT|DELETE|PATCH)\s+[^`]+)`/g)];
    if (epMatches.length > 0) {
      for (const match of epMatches) {
        if (match[1]) {
          const ep = match[1].replace(/\s+with\s.*$/, "").trim();
          rawApi.push(ep);
        }
      }
      continue;
    }

    const mPrefix = /^([A-Za-z]+ to [A-Za-z]+):\s*(.+)$/.exec(bullet);
    if (mPrefix?.[1] && mPrefix[2]) {
      const prefix = mPrefix[1];
      const body = mPrefix[2];
      const reqParts = body.split(/\.\s+Reply:/i);
      const reqPart = reqParts[0] ?? body;
      const cleanBody = reqPart.replace(/\([^)]*\)/g, " ");
      const msgMatches = [...cleanBody.matchAll(/`([^`]+)`/g)];
      const msgs: string[] = [];
      for (const match of msgMatches) {
        if (match[1]) {
          const name = match[1].replace(/\s*\{.*$/, "").trim();
          if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name) && !msgs.includes(name)) {
            msgs.push(name);
          }
        }
      }
      if (msgs.length > 0) {
        messageGroups.push({ prefix, messages: msgs });
        continue;
      }
    }

    const lead = codeLead(bullet);
    rawApi.push(lead !== null ? lead.replace(/\s+with\s.*$/, "") : firstSentence(bullet));
  }

  // Combining related messages under the channel maintains coverage without exceeding the display limit.
  const total = rawApi.length + messageGroups.length + rawEntities.length;
  if (total > MAX_ITEMS) {
    const mergedMap = new Map<string, string[]>();
    for (const g of messageGroups) {
      const existing = mergedMap.get(g.prefix) ?? [];
      existing.push(...g.messages);
      mergedMap.set(g.prefix, existing);
    }
    const mergedItems = [...mergedMap.entries()].map(([p, msgs]) => `${p}: ${[...new Set(msgs)].join(", ")}`);
    return [...rawApi, ...mergedItems, ...rawEntities];
  } else {
    const groupItems = messageGroups.map((g) => `${g.prefix}: ${g.messages.join(", ")}`);
    return [...rawApi, ...groupItems, ...rawEntities];
  }
}

function walks(section: string | undefined): string[] {
  return lines(section).flatMap((l) => {
    const m = /^Walk one ([^.:]+)[.:]/.exec(l.trim());
    return m?.[1] ? [`Walk one ${plainLabel(m[1])} through every box`] : [];
  });
}

function headings(section: string | undefined): string[] {
  return lines(section).flatMap((l) => {
    const m = /^###\s+(.+)$/.exec(l);
    return m?.[1] ? [m[1]] : [];
  });
}

function entityNames(section: string | undefined): string[] {
  const out: string[] = [];
  for (const b of bullets(section)) {
    // Structural briefs occasionally declare a hierarchy of domain models on one line.
    if (/^(not stored|accepted alternative)/i.test(b.trim())) continue;
    const colonIdx = b.indexOf(":");
    const lead = colonIdx >= 0 ? b.slice(0, colonIdx) : b.split(/(?<=\S)\.\s/)[0] ?? b;
    const stripped = lead.replace(/\([^)]*\)/g, "");
    const matches = [...stripped.matchAll(/`([^`]+)`/g)];
    for (const m of matches) {
      if (m[1]) {
        const name = m[1].trim();
        if (name) out.push(name);
      }
    }
  }
  return out;
}

/** The numbered requirement lines, each with the question that draws it out when the brief gives one. */
function requirementItems(section: string | undefined): { text: string; ask?: string }[] {
  return numbered(section).map(splitAsk);
}

function behaviourItems(section: string | undefined): string[] {
  const out: string[] = [];
  let skippingQuestions = false;

  for (const line of lines(section)) {
    const trimmed = line.trim();
    if (/^#+\s+/i.test(trimmed)) {
      skippingQuestions = /questions to ask/i.test(trimmed);
      continue;
    }
    if (/questions to ask/i.test(trimmed)) {
      skippingQuestions = true;
      continue;
    }
    // Prompts reserved for interviewer follow-ups should not populate candidate expectations.
    if (skippingQuestions) continue;

    // State machines and transition rules are often specified via matrix columns.
    if (trimmed.includes("|")) {
      const cells = trimmed.split("|").map((c) => c.trim());
      const first = cells[0];
      if (first && !first.startsWith("-") && !/^method$/i.test(first) && !/^[-:\s]+$/.test(first)) {
        out.push(first);
        continue;
      }
    }

    const mNum = /^\s*\d+[a-z]?\.\s+(.+)$/.exec(line);
    if (mNum?.[1]) {
      const clean = mNum[1].replace(/\s*<-.*$/, "").trim();
      out.push(codeLead(clean) ?? firstSentence(clean));
      continue;
    }

    const mBullet = /^- (.+)$/.exec(line);
    if (mBullet?.[1]) {
      out.push(codeLead(mBullet[1]) ?? firstSentence(mBullet[1]));
    }
  }

  return out;
}

function demoScenarios(section: string | undefined): string[] {
  const seen = new Map<string, number>();
  // Distinct test cases need distinguishable labels to avoid collapse when indexed.
  return numbered(section).map((s) => {
    let title: string;
    const mBold = /^\*\*([^*]+)\*\*/.exec(s.trim());
    if (mBold?.[1]) {
      title = mBold[1].replace(/[.:]+$/, "");
    } else {
      const mDot = /^([^.]+?)\.(?:\s|$)/.exec(s.trim());
      title = mDot?.[1] ?? s;
    }
    const clean = plainLabel(title);
    const base = `Demo: ${clean}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count > 0 ? `${base} (${count + 1})` : base;
  });
}

/**
 * What a strong answer covers in each step, read from the problem brief's own sections, so the checklist and the
 * judge's answer key never disagree. A step whose sections yield nothing falls back to the step's goal.
 */
export function deriveChecklist(track: Track, sections: Sections): Record<string, ChecklistItem[]> {
  const requirements = requirementItems(sections["Expected requirements"]);
  const raw: Record<string, string[]> =
    track === "hld"
      ? {
          requirements: requirements.map((r) => r.text),
          capacity: bullets(sections["Capacity math"]).flatMap((b) => {
            const lead = boldLead(b);
            return lead ? [lead] : [];
          }),
          api: apiItems(sections["API and entities"]),
          design: walks(sections["Reference design"]),
          deep_dives: headings(sections["Deep dives"]),
          // The curveball stays hidden until the interviewer delivers it, so this step names only its shape.
          wrap_up: ["Where the design breaks first", "The extension handled"],
        }
      : {
          clarify: requirements.map((r) => r.text),
          entities: entityNames(sections["Entities and relationships"]),
          behaviour: behaviourItems(sections["Behaviour and states"]),
          skeleton: ["Classes and signatures that compile"],
          thin_slice: demoScenarios(sections["Demo scenarios"]).slice(0, 1),
          fill_out: demoScenarios(sections["Demo scenarios"]).slice(1),
          extend: ["The new requirement restated", "The demo runs after the change"],
        };
  // Only the requirements step carries questions, and it is the one step whose lines hold them.
  const askFor = new Map<string, string>();
  for (const r of requirements) if (r.ask) askFor.set(plainLabel(r.text), r.ask);
  const asking = track === "hld" ? "requirements" : "clarify";
  const out: Record<string, ChecklistItem[]> = {};
  for (const phase of phasesFor(track)) {
    const labels = [...new Set((raw[phase.id] ?? []).map((l) => plainLabel(l)).filter((l) => l !== ""))].slice(0, MAX_ITEMS);
    const chosen = labels.length > 0 ? labels : [plainLabel(phase.goal)];
    out[phase.id] = chosen.map((label, i) => {
      const ask = phase.id === asking ? askFor.get(label) : undefined;
      return ask ? { id: `${phase.id}-${i + 1}`, label, ask } : { id: `${phase.id}-${i + 1}`, label };
    });
  }
  return out;
}
