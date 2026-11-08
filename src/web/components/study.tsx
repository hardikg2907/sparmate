import type { ReactNode } from "react";
import type { Mode, Track } from "../../shared/phases";
import { MODE_LABEL, TRACK_TITLE } from "../lib/format";
import { CodeIcon, CompassIcon, InfoIcon, MicIcon, NetworkIcon } from "./icons";
import { Segmented, Tooltip, cn } from "./ui";

export const GUIDED_HINT = "Step by step, with feedback and hints, no timer pressure. Earns at most partly done.";
export const INTERVIEW_HINT = "A timed round. The interviewer answers questions and pushes deeper, and gives no hints. Scored at the end.";

/** An ⓘ that explains a term on hover or focus, so the surface stays free of the explanation. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip content={children}>
      <button type="button" aria-label={label} className="inline-flex rounded-full text-faint transition-colors hover:text-foreground focus-visible:text-foreground">
        <InfoIcon size={14} />
      </button>
    </Tooltip>
  );
}

export function TrackIcon({ track, size = 14 }: { track: Track; size?: number }) {
  return track === "hld" ? <NetworkIcon size={size} /> : <CodeIcon size={size} />;
}

export function ModeIcon({ mode, size = 14, className }: { mode: Mode; size?: number; className?: string }) {
  return mode === "guided" ? <CompassIcon size={size} className={className} /> : <MicIcon size={size} className={className} />;
}

/** The track name as a small pill with its icon. */
export function TrackChip({ track, onMesh }: { track: Track; onMesh?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-semibold ring-1 ring-inset",
        onMesh ? "bg-white/10 text-foreground ring-white/25" : "bg-muted text-muted-foreground ring-border-strong/50",
      )}
    >
      <TrackIcon track={track} size={13} />
      {TRACK_TITLE_SHORT[track]}
    </span>
  );
}

export const TRACK_TITLE_SHORT: Record<Track, string> = { hld: "System design", lld: "Machine coding" };
export const DAY_TITLE = { hld: "System design day", lld: "Machine coding day", dsa: "DSA day", redo: "Redo day", rest: "Rest day" } as const;
export { TRACK_TITLE };

export function ModeSwitch({ value, onChange, disabled }: { value: Mode; onChange: (mode: Mode) => void; disabled?: boolean }) {
  return (
    <Segmented
      label="Mode"
      value={value}
      disabled={disabled}
      className="flex w-full [&>*]:flex-1 [&>*]:justify-center"
      options={[
        { value: "interview", label: MODE_LABEL.interview, icon: <MicIcon size={14} />, title: INTERVIEW_HINT },
        { value: "guided", label: MODE_LABEL.guided, icon: <CompassIcon size={14} />, title: GUIDED_HINT },
      ]}
      onChange={onChange}
    />
  );
}

/** Label over value in its own slot, in a row of slots divided by a hairline. Nothing is joined with dots. */
export function Facts({ items, className, onMesh }: { items: { label: ReactNode; value: ReactNode }[]; className?: string; onMesh?: boolean }) {
  return (
    <dl
      className={cn(
        "grid w-full auto-cols-fr grid-flow-col divide-x divide-border rounded-xl sm:inline-grid sm:w-auto sm:auto-cols-auto",
        onMesh ? "mesh-tile" : "bg-sunken ring-1 ring-inset ring-border",
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={index} className="min-w-0 px-3 py-3 sm:px-5 sm:py-3.5">
          <dt className="text-meta text-muted-foreground">{item.label}</dt>
          <dd className="mt-0.5 flex items-center gap-2 text-body font-semibold text-foreground sm:text-lead">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
