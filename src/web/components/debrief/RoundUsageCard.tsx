import { useEffect, useState } from "react";
import { api, type SessionUsageResponse } from "../../backend";
import { Card, Skeleton } from "../ui";

function UsageSkeleton() {
  return (
    <Card variant="raised" className="p-6">
      <span role="status" className="sr-only">
        Loading round usage
      </span>
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-4 w-full" />
        ))}
      </div>
    </Card>
  );
}

export function RoundUsageCard({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<SessionUsageResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.sessionUsage(sessionId)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!loaded) return <UsageSkeleton />;
  // The usage card is a side note to the debrief, so a failed load leaves it out rather than showing an error.
  if (!data || !data.hasData || !data.totals || data.totals.calls === 0) {
    return null;
  }

  const totals = data.totals;

  return (
    <Card variant="raised" className="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-4">
        <div>
          <h2 className="text-lead font-semibold text-foreground">This round used</h2>
          <p className="text-ui text-muted-foreground">Estimated API-equivalent token and cost usage for this round.</p>
        </div>
        <div className="font-mono text-title font-semibold tabular-nums text-foreground">
          ${totals.costUsd < 0.01 ? totals.costUsd.toFixed(4) : totals.costUsd.toFixed(3)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 py-4 sm:grid-cols-4">
        <div>
          <div className="text-meta font-medium text-muted-foreground">Input tokens</div>
          <div className="font-mono text-body font-semibold tabular-nums text-foreground">{totals.inputTokens.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-meta font-medium text-muted-foreground">Output tokens</div>
          <div className="font-mono text-body font-semibold tabular-nums text-foreground">{totals.outputTokens.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-meta font-medium text-muted-foreground">Cache hit rate</div>
          <div className="font-mono text-body font-semibold tabular-nums text-foreground">{(totals.cacheHitRate * 100).toFixed(1)}%</div>
        </div>
        <div>
          <div className="text-meta font-medium text-muted-foreground">Model calls</div>
          <div className="font-mono text-body font-semibold tabular-nums text-foreground">{totals.calls}</div>
        </div>
      </div>

      {data.byRole.length > 0 ? (
        <div className="overflow-x-auto border-t border-border pt-4">
          <table className="w-full text-left text-ui">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 text-right font-medium">Calls</th>
                <th className="pb-2 text-right font-medium">Input</th>
                <th className="pb-2 text-right font-medium">Output</th>
                <th className="pb-2 text-right font-medium">Cache read</th>
                <th className="pb-2 text-right font-medium">Hit rate</th>
                <th className="pb-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono text-ui tabular-nums">
              {data.byRole.map((role) => (
                <tr key={role.role} className="hover:bg-accent/50">
                  <td className="py-2 font-sans font-medium text-foreground capitalize">{role.role}</td>
                  <td className="py-2 text-right text-muted-foreground">{role.calls}</td>
                  <td className="py-2 text-right text-muted-foreground">{role.inputTokens.toLocaleString()}</td>
                  <td className="py-2 text-right text-muted-foreground">{role.outputTokens.toLocaleString()}</td>
                  <td className="py-2 text-right text-muted-foreground">{role.cacheReadTokens.toLocaleString()}</td>
                  <td className="py-2 text-right text-muted-foreground">{(role.cacheHitRate * 100).toFixed(1)}%</td>
                  <td className="py-2 text-right font-semibold text-foreground">
                    ${role.costUsd < 0.01 ? role.costUsd.toFixed(4) : role.costUsd.toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
