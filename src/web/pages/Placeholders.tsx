import { useEffect, type ReactNode } from "react";
import { PageHeader, PageShell } from "../components/PageShell";
import { Card } from "../components/ui";
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

export function GymPage({ ctx }: { ctx: PageContext }) {
  useEffect(() => {
    document.title = "Gym · Sparmate";
  }, []);
  return <GymView ctx={ctx} />;
}
