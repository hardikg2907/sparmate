import { useEffect } from "react";
import { ExternalIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { Button, Card } from "../components/ui";
import { Link } from "../router";
import type { PageContext } from "./context";

/** Shapes of the cards the real page will hold, drawn empty so the layout is clear before the content exists. */
function GhostRows({ count }: { count: number }) {
  return (
    <ul aria-hidden="true" className="mt-5 space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-3.5 rounded-xl border border-dashed border-border px-3 py-3">
          <span className="size-9 rounded-lg bg-muted" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-2.5 w-2/5 rounded-full bg-muted" />
            <span className="block h-2 w-3/5 rounded-full bg-muted/60" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function GymView({ ctx }: { ctx: PageContext }) {
  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader title="Gym" aside={<span className="text-ui text-muted-foreground">10 to 15 minutes on one skill</span>} />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <section aria-labelledby="gym-empty" className="mesh on-mesh rounded-3xl p-6 sm:p-11">
            <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-ui font-semibold ring-1 ring-inset ring-white/25">Coming soon</span>
            <h2 id="gym-empty" className="mt-5 font-display text-display font-extrabold tracking-[-0.02em] sm:text-[48px] sm:leading-[52px]">
              Drills from your gaps are coming
            </h2>
            <p className="mt-3 max-w-[48ch] text-body text-muted-foreground sm:text-lead">Each takes 10 to 15 minutes on one skill.</p>
          </section>
          <Card variant="raised" className="p-5 sm:p-6">
            <h2 className="text-lead font-semibold text-muted-foreground">Also due</h2>
            <GhostRows count={3} />
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

export function DsaView({ ctx }: { ctx: PageContext }) {
  const named = ctx.settings.leetcodeUsername !== undefined;
  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader title="DSA" />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <section aria-labelledby="dsa-empty" className="mesh on-mesh rounded-3xl p-6 sm:p-11">
            <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-ui font-semibold ring-1 ring-inset ring-white/25">Coming soon</span>
            <h2 id="dsa-empty" className="mt-5 font-display text-display font-extrabold tracking-[-0.02em] sm:text-[48px] sm:leading-[52px]">
              {named ? "LeetCode progress is coming." : "Add your LeetCode username in Settings"}
            </h2>
            <p className="mt-3 max-w-[48ch] text-body text-muted-foreground sm:text-lead">
              {named
                ? "Your weekly goal and the topics you have solved the least will show here."
                : "Your weekly goal and the topics you have solved the least will show here once the page can read your profile."}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {named ? null : (
                <Button asChild size="lg" variant="default">
                  <Link href="/settings">Open Settings</Link>
                </Button>
              )}
              <Button asChild size="lg" variant="secondary">
                <a href="https://leetcode.com/problemset/" target="_blank" rel="noopener noreferrer">
                  <ExternalIcon size={16} />
                  Open LeetCode
                </a>
              </Button>
            </div>
          </section>
          <Card variant="raised" className="p-5 sm:p-6">
            <h2 className="text-lead font-semibold text-muted-foreground">Fewest solved</h2>
            <GhostRows count={3} />
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

export function GymPage({ ctx }: { ctx: PageContext }) {
  useEffect(() => {
    document.title = "Gym · Sparmate";
  }, []);
  return <GymView ctx={ctx} />;
}

export function DsaPage({ ctx }: { ctx: PageContext }) {
  useEffect(() => {
    document.title = "DSA · Sparmate";
  }, []);
  return <DsaView ctx={ctx} />;
}
