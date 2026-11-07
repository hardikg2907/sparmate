import { z } from "zod";

// A problem file is Markdown: YAML frontmatter (ProblemMetaSchema) plus "## " sections.
// The whole body is the interviewer's hidden brief. The candidate never sees it before the debrief.

export const ProblemSourceSchema = z.strictObject({
  title: z.string().min(1).max(200),
  url: z.string().url().regex(/^https:\/\//, "Sources must use https:").max(500),
});
export type ProblemSource = z.infer<typeof ProblemSourceSchema>;

export const ProblemCorrectionSchema = z.strictObject({
  section: z.string().min(1).max(100),
  claim: z.string().min(1).max(500),
  fix: z.string().min(1).max(1000),
  source: z.string().min(1).max(500),
});
export type ProblemCorrection = z.infer<typeof ProblemCorrectionSchema>;

export const ProblemMetaSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
  track: z.enum(["hld", "lld"]),
  title: z.string().min(2).max(120),
  difficulty: z.enum(["easy", "medium", "hard"]),
  tags: z.array(z.string().max(40)).max(12),
  /** Where the problem sits in TRACKER.md. Null for problems that are not in the tracker. */
  tracker: z
    .strictObject({
      section: z.string().min(3), // exact heading line, for example "### C2. Classic HLD Problems"
      bullet: z.string().min(2), // exact bullet text after the mark, before any " → " suffix
    })
    .nullable(),
  notesFile: z.string().regex(/^notes\/[a-z0-9][a-z0-9-]*\.md$/),
  /** LLD only: folder under lld/ that holds attempt files. */
  lldFolder: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).optional(),
  sources: z.array(ProblemSourceSchema).max(20).optional(),
  confidence: z.string().max(1000).optional(),
  verified: z.boolean().optional(),
  corrections: z.array(ProblemCorrectionSchema).max(50).optional(),
});
export type ProblemMeta = z.infer<typeof ProblemMetaSchema>;

export const HLD_SECTIONS = [
  "Opening prompt",
  "Hidden facts",
  "Expected requirements",
  "Capacity math",
  "API and entities",
  "Reference design",
  "Accepted alternatives",
  "Deep dives",
  "Curveballs",
  "Level bar",
  "Traps",
] as const;

export const LLD_SECTIONS = [
  "Opening prompt",
  "Hidden facts",
  "Expected requirements",
  "Entities and relationships",
  "Behaviour and states",
  "Reference design",
  "Patterns that fit",
  "Demo scenarios",
  "Extensions",
  "Concurrency follow-up",
  "Level bar",
  "Traps",
] as const;

/** Sections shown on the debrief page under "Reference answer". The rest stay interviewer-only. */
export const REFERENCE_SECTIONS = [
  "Expected requirements",
  "Capacity math",
  "API and entities",
  "Entities and relationships",
  "Behaviour and states",
  "Reference design",
  "Accepted alternatives",
  "Patterns that fit",
  "Deep dives",
  "Level bar",
  "Traps",
] as const;

export interface Problem {
  meta: ProblemMeta;
  /** Body sections keyed by heading text (without "## "). */
  sections: Record<string, string>;
  /** The full body Markdown (everything after the frontmatter). */
  body: string;
  /** Absolute path of the source file. */
  file: string;
  custom: boolean;
}

export function requiredSections(track: "hld" | "lld"): readonly string[] {
  return track === "hld" ? HLD_SECTIONS : LLD_SECTIONS;
}
