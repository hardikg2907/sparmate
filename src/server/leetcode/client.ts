import { z } from "zod";
import type { DsaFailure } from "../../shared/dsa";
import { LEETCODE_USERNAME_PATTERN } from "../../shared/week";
import type { LedgerEntry, ProblemInfo } from "./compute";

/** The only host this module talks to. No setting or request can change it. */
const ENDPOINT = "https://leetcode.com/graphql";
const REFERER = "https://leetcode.com";
export const RECENT_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 512 * 1024;

const PROFILE_QUERY = `query profile($u: String!) {
  matchedUser(username: $u) {
    submitStatsGlobal { acSubmissionNum { difficulty count } }
  }
}`;
const RECENT_QUERY = `query recent($u: String!, $n: Int!) {
  recentAcSubmissionList(username: $u, limit: $n) { title titleSlug timestamp }
}`;
const QUESTION_QUERY = `query question($s: String!) { question(titleSlug: $s) { difficulty topicTags { name slug } } }`;

/** Any failure to read LeetCode: network, status, size, shape. The page treats all of them the same way. */
export class LeetcodeError extends Error {
  constructor(
    message: string,
    readonly reason: Exclude<DsaFailure, "not_found"> = "unexpected_reply",
  ) {
    super(message);
    this.name = "LeetcodeError";
  }
}

const count = z.number().int().min(0).max(1_000_000);
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const slug = z.string().regex(SLUG);

const ProfileSchema = z.strictObject({
  submitStatsGlobal: z.strictObject({
    acSubmissionNum: z.array(z.strictObject({ difficulty: z.enum(["All", "Easy", "Medium", "Hard"]), count })).max(8),
  }),
});
const ProfileEnvelope = z.object({ data: z.strictObject({ matchedUser: ProfileSchema.nullable() }), errors: z.array(z.unknown()).max(50).optional() });

const RecentEnvelope = z.object({
  data: z.strictObject({
    recentAcSubmissionList: z
      .array(z.strictObject({ title: z.string().min(1).max(200), titleSlug: slug, timestamp: z.string().regex(/^\d{9,11}$/) }))
      .max(100)
      .nullable(),
  }),
  errors: z.array(z.unknown()).max(50).optional(),
});

const QuestionEnvelope = z.object({
  data: z.strictObject({
    question: z
      .strictObject({
        difficulty: z.enum(["Easy", "Medium", "Hard"]),
        topicTags: z.array(z.strictObject({ name: z.string().min(1).max(100), slug })).max(60),
      })
      .nullable(),
  }),
  errors: z.array(z.unknown()).max(50).optional(),
});

/** Everything LeetCode counts on the account, earlier years included. */
export interface LeetcodeProfile {
  totals: { all: number; easy: number; medium: number; hard: number };
}

export type ProfileResult = { found: false } | { found: true; profile: LeetcodeProfile };

export interface LeetcodeClient {
  profile(username: string, signal?: AbortSignal): Promise<ProfileResult>;
  recent(username: string, signal?: AbortSignal): Promise<LedgerEntry[]>;
  /** Null when LeetCode has no such problem. */
  problem(titleSlug: string, signal?: AbortSignal): Promise<ProblemInfo | null>;
}

export interface ClientOptions {
  fetch: typeof fetch;
  /** Names the app. It must carry no personal data. */
  userAgent: string;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Reads at most `maxBytes` and aborts the transfer past that, so a hostile or broken reply cannot fill memory. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new LeetcodeError("The reply is too large");
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new LeetcodeError("The reply is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createLeetcodeClient(options: ClientOptions): LeetcodeClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  async function post<S extends z.ZodType>(schema: S, query: string, variables: Record<string, unknown>, outer?: AbortSignal): Promise<z.infer<S>> {
    const signal = outer ? AbortSignal.any([AbortSignal.timeout(timeoutMs), outer]) : AbortSignal.timeout(timeoutMs);
    let text: string;
    try {
      const res = await options.fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Referer: REFERER, "User-Agent": options.userAgent, Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        // A redirect would send the request to a host this module never chose.
        redirect: "error",
        signal,
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new LeetcodeError(`LeetCode answered with status ${res.status}`, "busy");
      }
      text = await readCapped(res, maxBytes);
    } catch (err) {
      if (err instanceof LeetcodeError) throw err;
      throw signal.aborted ? new LeetcodeError("LeetCode did not answer in time", "timeout") : new LeetcodeError("LeetCode could not be reached", "unreachable");
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LeetcodeError("LeetCode sent a reply that is not JSON");
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new LeetcodeError("LeetCode sent a reply in an unknown format");
    return parsed.data;
  }

  const checkName = (username: string) => {
    if (!LEETCODE_USERNAME_PATTERN.test(username)) throw new LeetcodeError("The username is not valid");
  };

  return {
    async profile(username, signal) {
      checkName(username);
      const reply = await post(ProfileEnvelope, PROFILE_QUERY, { u: username }, signal);
      const user = reply.data.matchedUser;
      // An unknown name comes back as null, with or without an errors list next to it.
      if (user === null) return { found: false };
      if (reply.errors?.length) throw new LeetcodeError("LeetCode reported an error");
      const byLevel = new Map(user.submitStatsGlobal.acSubmissionNum.map((row) => [row.difficulty, row.count]));
      const level = (name: "All" | "Easy" | "Medium" | "Hard") => {
        const value = byLevel.get(name);
        if (value === undefined) throw new LeetcodeError("LeetCode sent a reply in an unknown format");
        return value;
      };
      return { found: true, profile: { totals: { all: level("All"), easy: level("Easy"), medium: level("Medium"), hard: level("Hard") } } };
    },

    async recent(username, signal) {
      checkName(username);
      const reply = await post(RecentEnvelope, RECENT_QUERY, { u: username, n: RECENT_LIMIT }, signal);
      if (reply.errors?.length) throw new LeetcodeError("LeetCode reported an error");
      return (reply.data.recentAcSubmissionList ?? []).map((row) => ({ title: row.title, slug: row.titleSlug, timestamp: Number(row.timestamp) }));
    },

    async problem(titleSlug, signal) {
      if (!SLUG.test(titleSlug)) throw new LeetcodeError("The problem name is not valid");
      const reply = await post(QuestionEnvelope, QUESTION_QUERY, { s: titleSlug }, signal);
      if (reply.errors?.length) throw new LeetcodeError("LeetCode reported an error");
      const question = reply.data.question;
      return question ? { difficulty: question.difficulty, topics: question.topicTags } : null;
    },
  };
}
