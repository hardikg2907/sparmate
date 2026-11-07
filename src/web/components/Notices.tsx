import type { SocketStatus } from "../backend";
import { useDelayed } from "../hooks/useDelayed";
import type { SessionActions, SessionState } from "../session/types";
import { InfoIcon, SpinnerIcon, WarnIcon } from "./icons";
import { Banner, Button } from "./ui";

export function ConnectionBanner({ status, onRetry }: { status: SocketStatus; onRetry: () => void }) {
  const waiting = useDelayed(status === "connecting" || status === "reconnecting", 700);
  if (status === "closed") {
    return (
      <Banner
        tone="bad"
        role="alert"
        actions={
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        <WarnIcon size={16} />
        <span>The connection to the server was lost.</span>
      </Banner>
    );
  }
  if (!waiting) return null;
  return (
    <Banner tone="warn">
      <SpinnerIcon size={16} />
      <span>{status === "connecting" ? "Connecting…" : "Reconnecting… Your work is kept and will be sent when the connection is back."}</span>
    </Banner>
  );
}

/** The one-line messages every session page can show: a server error and a short notice. */
export function MessageBanners({ state, actions }: { state: SessionState; actions: SessionActions }) {
  return (
    <>
      {state.error ? (
        <Banner
          tone="bad"
          role="alert"
          actions={
            <Button size="sm" variant="ghost" onClick={actions.dismissError}>
              Dismiss
            </Button>
          }
        >
          <WarnIcon size={16} />
          <span>{state.error}</span>
        </Banner>
      ) : null}
      {state.notice ? (
        <Banner
          tone="info"
          actions={
            <Button size="sm" variant="ghost" onClick={actions.dismissNotice}>
              Dismiss
            </Button>
          }
        >
          <InfoIcon size={16} />
          <span>{state.notice}</span>
        </Banner>
      ) : null}
    </>
  );
}
