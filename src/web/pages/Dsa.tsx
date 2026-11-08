import { useEffect, useMemo, useState, type ReactNode } from "react";
import { topicFocus, type DsaResponse, type DsaSolve } from "../../shared/dsa";
import { WEEKDAYS, planIndex } from "../../shared/week";
import { ExternalIcon, TargetIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { SidePanel } from "../components/SidePanel";
import { InfoTip } from "../components/study";
import { Button, Card, Skeleton, cn } from "../components/ui";
import { dayMonth, shortDay } from "../lib/dates";
import { failureText, waitText } from "../lib/dsaText";
import { useNow } from "../lib/useNow";
import { useDsa, type DsaData } from "../lib/useDsa";
import { Link } from "../router";
import type { PageContext } from "./context";

const LEETCODE_URL = "https://leetcode.com/problemset/";
/** The most topic chips the side card shows before it says how many more there are. */
const SHOWN_UNTOUCHED = 8;
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Whole seconds until `iso`, counted down each second. A fixed `now` stops the clock, for fixtures. */
function useSecondsUntil(iso: string | null, fixed?: Date): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!iso || fixed) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [iso, fixed]);
  if (!iso) return 0;
  return Math.max(0, Math.ceil((Date.parse(iso) - (fixed ? fixed.getTime() : tick)) / 1000));
}

/** "Read again" that waits out the server's minimum gap and says how long is left. */
function ReadAgain({
  res,
  data,
  now,
  size = "sm",
  variant = "ghost",
}: {
  res: DsaResponse | null;
  data: DsaData;
  now?: Date;
  size?: "sm" | "lg";
  variant?: "ghost" | "secondary";
}) {
  const seconds = useSecondsUntil(res?.nextReadAt ?? null, now);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button variant={variant} size={size} busy={data.refreshing} disabled={seconds > 0} onClick={data.refresh}>
        Read again
      </Button>
      {seconds > 0 ? <span className="text-ui text-faint">Try again in {waitText(seconds)}</span> : null}
    </span>
  );
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "today at 08:10", or "Sat 7 Nov at 08:10" for an older read. */
function readLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  return `${sameDay(at, now) ? "today" : shortDay(at)} at ${TIME.format(at)}`;
}

function countLabel(n: number): string {
  return `${n} ${n === 1 ? "problem" : "problems"}`;
}

function OpenLeetcode({ variant = "default", size = "lg" }: { variant?: "default" | "ghost"; size?: "lg" | "default" }) {
  return (
    <Button asChild size={size} variant={variant}>
      <a href={LEETCODE_URL} target="_blank" rel="noopener noreferrer">
        <ExternalIcon size={16} />
        Open LeetCode
      </a>
    </Button>
  );
}

/** One calm card for a state with no numbers to show. */
function Notice({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <Card variant="raised" className="max-w-3xl p-8 sm:p-10">
      <h2 className="font-display text-title font-extrabold tracking-[-0.01em]">{title}</h2>
      <p className="mt-2 max-w-[52ch] text-body text-muted-foreground">{children}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div>
    </Card>
  );
}

const SETTINGS_BUTTON = (
  <Button asChild size="lg" variant="default">
    <Link href="/settings">Open Settings</Link>
  </Button>
);

export function DsaView({ ctx, data, now: fixedNow }: { ctx: PageContext; data: DsaData; now?: Date }) {
  const liveNow = useNow();
  const now = fixedNow ?? liveNow;
  const [panelOpen, setPanelOpen] = useState(false);
  const named = ctx.settings.leetcodeUsername !== undefined;
  const res = data.response;
  const status = !named ? "no_username" : (res?.status ?? null);
  const shown = res !== null && (res.status === "ok" || res.status === "stale") ? res : null;

  const aside =
    shown?.fetchedAt != null ? (
      <span className="flex items-center gap-1.5 text-ui text-faint">
        From LeetCode, read {readLabel(shown.fetchedAt, now)}
        <InfoTip label="About this read">
          Read from your public profile. If a read fails, this page keeps the last numbers and shows their date. Sparmate never asks for your LeetCode login.
        </InfoTip>
      </span>
    ) : null;

  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              DSA
              <InfoTip label="About these numbers">These numbers count the practice you do on LeetCode. They do not say whether you are ready.</InfoTip>
            </span>
          }
          aside={aside}
        />
        {shown && shown.status === "stale" ? <StaleNote res={shown} data={data} now={fixedNow} /> : null}
        {data.loading && named ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]" role="status">
            <span className="sr-only">Reading your LeetCode progress…</span>
            <Skeleton className="h-80 rounded-3xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : shown ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
            <Hero res={shown} ctx={ctx} now={now} />
            <PassCard res={shown} onOpen={() => setPanelOpen(true)} />
          </div>
        ) : status === "no_username" ? (
          <Notice
            title="Add your LeetCode username in Settings"
            actions={
              <>
                {SETTINGS_BUTTON}
                <OpenLeetcode variant="ghost" />
              </>
            }
          >
            Your weekly goal and the topics you have not touched yet will show here once the page can read your public profile.
          </Notice>
        ) : status === "not_found" ? (
          <Notice
            title={`No public LeetCode profile named ${res?.username ?? ctx.settings.leetcodeUsername ?? ""}`}
            actions={
              <>
                {SETTINGS_BUTTON}
                <OpenLeetcode variant="ghost" />
              </>
            }
          >
            Check the name in Settings. The profile must be public for Sparmate to read it.
          </Notice>
        ) : (
          <Notice
            title="LeetCode could not be read"
            actions={
              <>
                <ReadAgain res={res} data={data} now={fixedNow} size="lg" variant="secondary" />
                <OpenLeetcode variant="ghost" />
              </>
            }
          >
            {data.unreachable
              ? "Sparmate could not load these numbers. Reload the page in a moment."
              : "LeetCode did not answer, so there are no numbers yet. Nothing is lost. Try again in a few minutes."}
          </Notice>
        )}
      </div>
      {panelOpen && shown ? <PassPanel res={shown} onClose={() => setPanelOpen(false)} /> : null}
    </PageShell>
  );
}

export function DsaPage({ ctx }: { ctx: PageContext }) {
  const data = useDsa(ctx.settings.leetcodeUsername !== undefined, ctx.settings.leetcodeUsername);
  useEffect(() => {
    document.title = "DSA · Sparmate";
  }, []);
  return <DsaView ctx={ctx} data={data} />;
}

function StaleNote({ res, data, now }: { res: DsaResponse; data: DsaData; now?: Date }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-ui text-muted-foreground" role="status">
      <span>
        {failureText(res.failure?.reason)} These numbers are from {res.fetchedAt ? shortDay(new Date(res.fetchedAt)) : "an earlier read"}.
      </span>
      <ReadAgain res={res} data={data} now={now} />
    </p>
  );
}

function Hero({ res, ctx, now }: { res: DsaResponse; ctx: PageContext; now: Date }) {
  const today = planIndex(now);
  return (
    <section aria-labelledby="dsa-hero" className="mesh on-mesh rounded-3xl p-6 sm:p-10">
      <div className="grid items-end gap-8 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber px-3 py-1 text-ui font-bold text-amber-foreground">
            <TargetIcon size={14} />
            Weekly goal
          </span>
          <h2 id="dsa-hero" className="mt-5 text-body font-medium text-muted-foreground">
            Mediums this week
          </h2>
          <p className="mt-1 flex items-baseline gap-3">
            <span className="font-display text-[88px] font-extrabold leading-none tracking-[-0.03em] tabular-nums sm:text-[112px]">{res.week.mediums}</span>
            <span className="text-title font-semibold text-muted-foreground">of {res.weeklyGoal}</span>
          </p>
          <p className="mt-2 text-ui text-muted-foreground">{countLabel(res.week.solved)} this week</p>
          <div className="mt-8">
            <OpenLeetcode />
          </div>
        </div>
        <div className="mesh-tile rounded-2xl p-4">
          <p className="text-meta text-muted-foreground">Problems solved each day</p>
          <ol aria-label="Problems solved each day this week" className="mt-3 grid grid-cols-7 gap-1.5 text-center">
            {WEEKDAYS.map((name, index) => {
              const count = res.week.perDay[index] ?? 0;
              const planned = ctx.settings.weeklyPlan[index] === "dsa";
              return (
                <li key={name} aria-current={index === today ? "date" : undefined} className="w-[30px]">
                  <span className="block text-meta text-muted-foreground" aria-hidden="true">
                    {name.slice(0, 1)}
                  </span>
                  <span
                    className={cn(
                      "mx-auto mt-1.5 grid size-7 place-items-center rounded-lg text-meta font-bold tabular-nums",
                      count > 0 ? "bg-gradient-to-b from-[#b3bcff] to-[#7c6cf0] text-[#0e1230]" : "bg-white/10",
                      planned && "ring-[1.5px] ring-inset ring-white/60",
                      index === today && "outline outline-[1.5px] outline-offset-2 outline-white",
                    )}
                  >
                    {count > 0 ? count : null}
                    <span className="sr-only">
                      {name}, {count} solved{planned ? ", a DSA day" : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 flex items-center gap-2 text-meta text-muted-foreground">
            <span aria-hidden="true" className="inline-block size-3 rounded-[4px] ring-[1.5px] ring-inset ring-white/60" />
            DSA day in your plan
          </p>
        </div>
      </div>
    </section>
  );
}

function TopicBar({ name, solved, max }: { name: string; solved: number; max: number }) {
  const width = solved === 0 ? 0 : Math.max(4, (solved / Math.max(1, max)) * 100);
  return (
    <li className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_1.75rem] items-center gap-x-3.5 py-2.5">
      <span className="truncate text-body font-semibold">{name}</span>
      <span className="block h-2 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <span className="block h-full rounded-full bg-white/30" style={{ width: `${width}%` }} />
      </span>
      <span className="text-right text-body font-bold tabular-nums">{solved}</span>
    </li>
  );
}

function PassCard({ res, onOpen }: { res: DsaResponse; onOpen: () => void }) {
  const focus = useMemo(() => topicFocus(res.topics), [res.topics]);
  const since = res.countFrom ? ` since ${dayMonth(res.countFrom)}` : "";
  const max = Math.max(1, ...focus.topics.map((t) => t.solved), ...res.topics.map((t) => t.solved));
  return (
    <Card variant="raised" className="p-5 sm:p-6">
      <h2 className="text-lead font-semibold">This pass</h2>
      <p className="mt-1 text-ui text-muted-foreground">
        {countLabel(res.pass.solved)}
        {since}
      </p>
      {res.pass.solved === 0 ? <p className="mt-4 text-ui text-muted-foreground">Nothing solved yet. A new solve shows up here after the next read.</p> : null}
      {focus.untouched ? (
        <section aria-labelledby="untouched-h" className="mt-5">
          <h3 id="untouched-h" className="text-ui font-semibold text-muted-foreground">
            Not touched yet
          </h3>
          <ul className="mt-2.5 flex flex-wrap gap-2">
            {focus.topics.slice(0, SHOWN_UNTOUCHED).map((t) => (
              <li key={t.slug} className="rounded-full bg-muted px-3 py-1 text-ui text-foreground ring-1 ring-inset ring-border-strong/50">
                {t.name}
              </li>
            ))}
            {focus.topics.length > SHOWN_UNTOUCHED ? <li className="px-1 py-1 text-ui text-muted-foreground">+{focus.topics.length - SHOWN_UNTOUCHED} more</li> : null}
          </ul>
        </section>
      ) : (
        <section aria-labelledby="fewest-h" className="mt-4">
          <h3 id="fewest-h" className="text-ui font-semibold text-muted-foreground">
            Fewest solved
          </h3>
          <ul className="mt-1 divide-y divide-border">
            {focus.topics.map((t) => (
              <TopicBar key={t.slug} name={t.name} solved={t.solved} max={max} />
            ))}
          </ul>
        </section>
      )}
      <div className="mt-4 flex justify-end border-t border-border pt-3.5">
        <Button variant="ghost" size="sm" onClick={onOpen}>
          All topics and problems
        </Button>
      </div>
    </Card>
  );
}

function PassPanel({ res, onClose }: { res: DsaResponse; onClose: () => void }) {
  const max = Math.max(1, ...res.topics.map((t) => t.solved));
  const levels: { label: string; value: number }[] = [
    { label: "Easy", value: res.pass.easy },
    { label: "Medium", value: res.pass.medium },
    { label: "Hard", value: res.pass.hard },
  ];
  return (
    <SidePanel
      title="This pass"
      kicker={`${countLabel(res.pass.solved)}${res.countFrom ? ` since ${dayMonth(res.countFrom)}` : ""}`}
      onClose={onClose}
      footer={res.lifetimeSolved !== null ? <p className="text-meta text-faint">Lifetime on LeetCode: {res.lifetimeSolved} solved, includes earlier years</p> : undefined}
    >
      <dl className="grid grid-cols-3 gap-3">
        {levels.map((level) => (
          <div key={level.label} className="flex flex-col-reverse rounded-lg bg-sunken px-3 py-2.5">
            <dt className="text-ui text-muted-foreground">{level.label}</dt>
            <dd className="text-title font-bold tabular-nums">{level.value}</dd>
          </div>
        ))}
      </dl>
      {res.pass.unread > 0 ? <p className="mt-2 text-meta text-faint">{res.pass.unread} not read yet</p> : null}
      <h3 className="mt-7 text-lead font-semibold">Topics</h3>
      {res.topics.length === 0 ? (
        <p className="mt-2 text-ui text-muted-foreground">No topic yet. Topics appear once a solve has been read.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {res.topics.map((t) => (
            <TopicBar key={t.slug} name={t.name} solved={t.solved} max={max} />
          ))}
        </ul>
      )}
      <h3 className="mt-7 text-lead font-semibold">Recent solves</h3>
      {res.recent.length === 0 ? (
        <p className="mt-2 text-ui text-muted-foreground">No solves since this day yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {res.recent.map((solve) => (
            <RecentRow key={`${solve.slug}-${solve.solvedAt}`} solve={solve} />
          ))}
        </ul>
      )}
    </SidePanel>
  );
}

function RecentRow({ solve }: { solve: DsaSolve }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <span className="min-w-0">
        <a href={`https://leetcode.com/problems/${solve.slug}/`} target="_blank" rel="noopener noreferrer" className="block truncate text-body font-semibold hover:underline">
          {solve.title}
        </a>
        <span className="mt-0.5 block text-meta text-muted-foreground">{solve.difficulty ?? "Level not read yet"}</span>
      </span>
      <span className="shrink-0 text-ui text-muted-foreground">{shortDay(new Date(solve.solvedAt))}</span>
    </li>
  );
}
