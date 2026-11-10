import { useEffect, useState } from "react";
import { ListIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { Button, Segmented } from "../components/ui";
import { useGym, type GymData } from "../lib/useGym";
import { useStudyData, type StudyData } from "../lib/useStudyData";
import { Link, navigate } from "../router";
import type { PageContext } from "./context";
import { RecentAttempts } from "./DrillHistory";
import { DrillsPanel } from "./Gym";
import { RoundsPanel } from "./Library";

export type PracticeTab = "rounds" | "drills";

const TAB_PATH: Record<PracticeTab, string> = { rounds: "/practice", drills: "/practice/drills" };

/** Rounds and Drills share one page, so the choice of a problem to play and the choice of a skill to train sit side by side. */
export function PracticeView({ tab: routeTab, study, gym, ctx }: { tab: PracticeTab; study: StudyData; gym: GymData; ctx: PageContext }) {
  const [tab, setTab] = useState(routeTab);
  useEffect(() => setTab(routeTab), [routeTab]);
  const due = gym.gym?.dueCount ?? 0;

  const choose = (next: PracticeTab) => {
    setTab(next);
    navigate(TAB_PATH[next], { replace: true, instant: true });
  };

  return (
    <PageShell testMode={ctx.testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader
          title="Practice"
          aside={
            <Button asChild variant="outline">
              <Link href="/practice/new">
                <ListIcon size={16} />
                Practise any question
              </Link>
            </Button>
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <Segmented
            label="Practice view"
            value={tab}
            onChange={choose}
            options={[
              { value: "rounds", label: "Rounds" },
              {
                value: "drills",
                label: "Drills",
                badge:
                  due > 0 ? (
                    <span className="rounded-full bg-warning-soft px-1.5 text-meta font-semibold text-warning" aria-label={`${due} due`}>
                      {due} due
                    </span>
                  ) : null,
              },
            ]}
          />
          {tab === "drills" ? <span className="text-ui text-muted-foreground">10 to 15 minutes on one skill</span> : null}
        </div>
        {/* Both stay mounted, so a choice of track, filter or problem survives a visit to the other view. */}
        <div hidden={tab !== "rounds"}>
          <RoundsPanel data={study} ctx={ctx} />
        </div>
        <div hidden={tab !== "drills"}>
          <div className="space-y-6">
            <DrillsPanel data={gym} />
            {tab === "drills" && gym.gym ? <RecentAttempts /> : null}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

export function PracticePage({ tab, ctx }: { tab: PracticeTab; ctx: PageContext }) {
  const study = useStudyData();
  const gym = useGym();
  useEffect(() => {
    document.title = "Practice · Sparmate";
  }, []);
  return <PracticeView tab={tab} study={study} gym={gym} ctx={ctx} />;
}
