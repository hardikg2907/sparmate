import { phasesFor, type Track } from "./phases";
import type { ChecklistItem } from "./types";

const MAX_LABEL = 90;
const MAX_ITEMS = 12;
const MAX_ASK = 160;
const MAX_LINE = 1000;

type Sections = Readonly<Record<string, string | undefined>>;

/** Plain text of a Markdown fragment: code spans, bold and links reduced to their words, trailing stop removed. */
export function plainLabel(markdown: string, max: number = MAX_LABEL): string {
  const text = markdown
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;,]+$/, "");
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[.,;:]+$/, "")}…`;
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

function firstSentence(text: string): string {
  const plain = plainLabel(text.replace(/\*\*[^*]*\*\*:?\s*/, ""));
  return plain.split(/(?<=[.!?])\s/)[0] ?? plain;
}

/** "API and entities" splits into the endpoints under "External API" and the entities under "Core entities". */
function apiItems(section: string | undefined): string[] {
  const out: string[] = [];
  let part: "api" | "entities" | null = null;
  for (const line of lines(section)) {
    if (/^external api/i.test(line.trim())) part = "api";
    else if (/^(core )?entities/i.test(line.trim())) part = "entities";
    const m = /^- (.+)$/.exec(line);
    if (!m?.[1]) continue;
    const lead = codeLead(m[1]);
    if (part === "entities") {
      if (lead !== null) out.push(`Entity ${lead.replace(/\s*\{.*$/, "").trim()}`);
    } else {
      out.push(lead !== null ? lead.replace(/\s+with\s.*$/, "") : firstSentence(m[1]));
    }
  }
  return out;
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
  return bullets(section).flatMap((b) => {
    const lead = codeLead(b);
    return lead ? [lead] : [];
  });
}

/** The numbered requirement lines, each with the question that draws it out when the brief gives one. */
function requirementItems(section: string | undefined): { text: string; ask?: string }[] {
  return numbered(section).map(splitAsk);
}

function behaviourItems(section: string | undefined): string[] {
  return bullets(section).map((b) => codeLead(b) ?? firstSentence(b));
}

function demoScenarios(section: string | undefined): string[] {
  return numbered(section).map((s) => `Demo: ${plainLabel(s)}`);
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
