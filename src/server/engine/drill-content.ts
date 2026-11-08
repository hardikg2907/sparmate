import { DRILL_INFO, drillsForTrack, type DrillPrompt, type DrillType } from "../../shared/drills";
import type { Problem } from "../../shared/problem";

/** What a drill shows the candidate, and the answer key only the grader reads. */
export interface DrillContent {
  prompt: DrillPrompt;
  key: string;
}

export interface DrillContext {
  /** The gap's own words, used to pick the deep dive that matches it. */
  hint?: string;
  /** How many drills of this kind the candidate already tried on the problem, so a free drill moves on to the next topic. */
  rotation?: number;
}

const BULLET = /^\s*[-*]\s+(.+)$/;

function section(problem: Problem, name: string): string {
  return (problem.sections[name] ?? "").trim();
}

function bullets(text: string): string[] {
  return text.split("\n").flatMap((line) => {
    const m = BULLET.exec(line);
    return m?.[1] ? [m[1].trim()] : [];
  });
}

/** The bold lead of a bullet: "**Writes:** ..." gives "writes". */
function lead(bullet: string): string | null {
  const m = /^\*\*([^*]+?):?\*\*/.exec(bullet);
  return m?.[1] ? m[1].replace(/:$/, "").trim().toLowerCase() : null;
}

function listSentence(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export interface DeepDiveEntry {
  title: string;
  text: string;
}

/** Each "### " entry of the Deep dives section, with its Bad, Good and Great levels. */
export function deepDiveEntries(problem: Problem): DeepDiveEntry[] {
  const text = section(problem, "Deep dives");
  const entries: DeepDiveEntry[] = [];
  let current: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (current) entries.push({ title: current.title, text: current.lines.join("\n").trim() });
  };
  for (const line of text.split("\n")) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      flush();
      current = { title: heading[1].replace(/`/g, ""), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return entries.filter((e) => e.text !== "");
}

function stems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 5)),
  );
}

/** The deep dive that shares the most words with the gap, else the one the rotation points at. */
export function pickDeepDive(entries: readonly DeepDiveEntry[], hint = "", rotation = 0): DeepDiveEntry | null {
  if (entries.length === 0) return null;
  const wanted = stems(hint);
  let best = -1;
  let score = 0;
  entries.forEach((entry, index) => {
    const own = stems(entry.title);
    let shared = 0;
    for (const s of own) if (wanted.has(s)) shared += 1;
    if (shared > score) {
      score = shared;
      best = index;
    }
  });
  if (best >= 0) return entries[best] ?? null;
  return entries[Math.abs(rotation) % entries.length] ?? null;
}

/** Hidden-fact bullets that carry a number: the scale facts a capacity estimate starts from. */
export function scaleFacts(problem: Problem): string[] {
  return bullets(section(problem, "Hidden facts")).filter((b) => /\d/.test(b));
}

function walkName(problem: Problem): string {
  const m = /^Walk one ([^.:\n]+?)[.:]/m.exec(section(problem, "Reference design"));
  return m?.[1]?.replace(/`/g, "").trim() || "request";
}

/** Whether a problem has what the drill needs: a section to prompt from and a key to grade against. */
export function drillFits(problem: Problem, drill: DrillType): boolean {
  if (DRILL_INFO[drill].track !== problem.meta.track) return false;
  if (drill === "capacity") return section(problem, "Capacity math") !== "" && scaleFacts(problem).length > 0;
  if (drill === "walk") return section(problem, "Reference design") !== "";
  if (drill === "requirements") return section(problem, "Expected requirements") !== "";
  if (drill === "deep_dive") return deepDiveEntries(problem).length > 0;
  return section(problem, "Entities and relationships") !== "";
}

export function drillsAvailable(problem: Problem): DrillType[] {
  return drillsForTrack(problem.meta.track).filter((d) => drillFits(problem, d));
}

/** Builds the prompt and the key for one drill on one problem, or null when the brief cannot supply it. */
export function buildDrill(problem: Problem, drill: DrillType, ctx: DrillContext = {}): DrillContent | null {
  if (!drillFits(problem, drill)) return null;
  const info = DRILL_INFO[drill];
  // The interviewer's closing "where would you like to start?" belongs to a live round, not a drill.
  const opening = section(problem, "Opening prompt").replace(/\s*Where would you (like to )?start\?\s*$/i, "");
  const base = {
    drill,
    title: info.title,
    minutes: info.minutes,
    problem: { id: problem.meta.id, title: problem.meta.title, track: problem.meta.track },
  };
  const problemBlock = { heading: "The problem", markdown: opening };

  switch (drill) {
    case "capacity": {
      const leads = bullets(section(problem, "Capacity math"))
        .map(lead)
        .filter((l): l is string => l !== null)
        .slice(0, 5);
      const what = leads.length >= 2 ? listSentence(leads) : "load, storage and what each needs";
      return {
        prompt: {
          ...base,
          task: `Write one line each for ${what}. End each line with "which means".`,
          material: [
            problemBlock,
            {
              heading: "What you know",
              markdown: scaleFacts(problem)
                .map((f) => `- ${f}`)
                .join("\n"),
            },
          ],
          answerHint: "Plain lines are fine. Show the sum, then say what it forces you to build.",
        },
        key: section(problem, "Capacity math"),
      };
    }
    case "walk": {
      const name = walkName(problem);
      return {
        prompt: {
          ...base,
          task: `Walk one ${name} through your design, box by box, from the first call to the last.`,
          material: [problemBlock],
          answerHint: "Name each box in order, and say what it does with the request.",
        },
        key: section(problem, "Reference design"),
      };
    }
    case "requirements":
      return {
        prompt: {
          ...base,
          task: "Write the questions you would ask and the requirements you would settle, split into what it does and how well it must do it.",
          material: [problemBlock],
          answerHint: "Write each question with the answer you would assume. Numbers help.",
        },
        key: [
          section(problem, "Expected requirements"),
          "Facts the interviewer holds back until asked:",
          bullets(section(problem, "Hidden facts"))
            .map((b) => `- ${b}`)
            .join("\n"),
        ].join("\n\n"),
      };
    case "deep_dive": {
      const entry = pickDeepDive(deepDiveEntries(problem), ctx.hint, ctx.rotation);
      if (!entry) return null;
      return {
        prompt: {
          ...base,
          task: `Take "${entry.title}": say what goes wrong with the naive way, what you would build instead, and what it costs.`,
          material: [problemBlock, { heading: "The topic", markdown: entry.title }],
          answerHint: "Go one level deeper than your first answer, and name the trade-off.",
        },
        key: `### ${entry.title}\n${entry.text}`,
      };
    }
    default: {
      const facts = bullets(section(problem, "Hidden facts"));
      return {
        prompt: {
          ...base,
          task: "Write the classes: names, fields and method signatures, with no bodies. Say which class owns each rule.",
          material: [problemBlock, ...(facts.length > 0 ? [{ heading: "What you know", markdown: facts.map((f) => `- ${f}`).join("\n") }] : [])],
          answerHint: "One class per block is fine. Plain text, C++ style signatures are welcome.",
        },
        key: [section(problem, "Entities and relationships"), section(problem, "Behaviour and states")].filter(Boolean).join("\n\n"),
      };
    }
  }
}
