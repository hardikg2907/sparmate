import { useEffect, type ReactNode } from "react";
import { ExternalIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { Button, Card } from "../components/ui";
import { Link } from "../router";
import type { PageContext } from "./context";

/** One calm card that says what the page will hold. Nothing here looks like content still loading. */
function EmptyCard({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card variant="raised" className="max-w-3xl p-8 sm:p-10">
      <h2 className="font-display text-title font-extrabold tracking-[-0.01em]">{title}</h2>
      <p className="mt-2 max-w-[52ch] text-body text-muted-foreground">{children}</p>
      {actions ? <div className="mt-6 flex flex-wrap items-center gap-3">{actions}</div> : null}
    </Card>
  );
}

export function GymView({ ctx }: { ctx: PageContext }) {
  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader title="Gym" aside={<span className="text-ui text-muted-foreground">10 to 15 minutes on one skill</span>} />
        <EmptyCard title="Drills from your gaps are coming">Each takes 10 to 15 minutes on one skill.</EmptyCard>
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
        {named ? (
          <EmptyCard title="LeetCode progress is coming.">Your weekly goal and the topics you have solved the least will show here.</EmptyCard>
        ) : (
          <EmptyCard
            title="Add your LeetCode username in Settings"
            actions={
              <Button asChild size="lg" variant="default">
                <Link href="/settings">Open Settings</Link>
              </Button>
            }
          >
            Your weekly goal and the topics you have solved the least will show here once the page can read your profile.
          </EmptyCard>
        )}
        <p>
          <Button asChild variant="ghost">
            <a href="https://leetcode.com/problemset/" target="_blank" rel="noopener noreferrer">
              <ExternalIcon size={16} />
              Open LeetCode
            </a>
          </Button>
        </p>
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
