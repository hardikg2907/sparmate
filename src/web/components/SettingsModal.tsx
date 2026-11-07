import { useRef, useState } from "react";
import type { Effort, ModelId, Settings } from "../../shared/types";
import { Modal } from "./Modal";
import { Alert, Button, DialogClose, Label, Segmented, Switch } from "./ui";
import { Select } from "./Select";
import { CheckIcon, SpinnerIcon, WarnIcon } from "./icons";
import type { Theme } from "../theme";
import { DEFAULT_SETTINGS } from "../lib/contract";
import { DEFAULT_VOICE_SETTINGS, getVoiceSettings, saveVoiceSettings, type VoiceSettings } from "../lib/voiceSettings";

// Typed as records so a model or effort added to the settings schema is a compile error until it has a label.
const MODEL_LABEL: Record<ModelId, string> = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5" };
const MODEL_HINT: Record<ModelId, string> = {
  "claude-opus-5-5": "Most capable",
  "claude-sonnet-5-5": "Faster, high quality",
};
const EFFORT_LABEL: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const MODEL_IDS = Object.keys(MODEL_LABEL) as ModelId[];
const EFFORTS = Object.keys(EFFORT_LABEL) as Effort[];

const MODEL_OPTIONS = MODEL_IDS.map((id) => ({
  value: id,
  label: MODEL_LABEL[id],
  hint: MODEL_HINT[id],
}));

const EFFORT_OPTIONS = EFFORTS.map((val) => ({
  value: val,
  label: EFFORT_LABEL[val],
}));

const SPEED_OPTIONS = [
  { value: "0.8", label: "0.8x", hint: "Slower" },
  { value: "0.9", label: "0.9x" },
  { value: "0.95", label: "0.95x", hint: "Default" },
  { value: "1", label: "1.0x", hint: "Normal" },
  { value: "1.1", label: "1.1x" },
  { value: "1.2", label: "1.2x", hint: "Faster" },
];

const ROLES = [
  { key: "interviewer", label: "Interviewer", hint: "Runs the live round and the guide" },
  { key: "judge", label: "Judge", hint: "Scores the round afterwards" },
  { key: "coach", label: "Coach", hint: "Teaches the gaps in the debrief chat" },
  { key: "scribe", label: "Study notes", hint: "Drafts the tracker and notes edits" },
] as const;

interface SettingsModalProps {
  settings: Settings;
  studyRoot: string;
  onClose: () => void;
  /** Throws an Error with a plain message when saving fails. */
  onSave: (settings: Settings) => Promise<void>;
  onApplyTheme: (theme: Theme) => void;
}

interface Snapshot {
  server: Settings;
  voice: VoiceSettings;
}

const sameSnapshot = (a: Snapshot, b: Snapshot) => JSON.stringify(a) === JSON.stringify(b);

/** Every change saves at once; Undo steps back through the changes made since the dialog opened. */
export function SettingsModal({ settings, studyRoot, onClose, onSave, onApplyTheme }: SettingsModalProps) {
  const [draft, setDraftState] = useState<Settings>(settings);
  const [voiceDraft, setVoiceDraftState] = useState<VoiceSettings>(getVoiceSettings);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  // Saves run one after another, so a fast second click can never land before the first.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const persist = (next: Snapshot, serverChanged: boolean) => {
    saveVoiceSettings(next.voice);
    if (next.server.theme !== draft.theme) onApplyTheme(next.server.theme);
    if (!serverChanged) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    setError(null);
    queue.current = queue.current.then(async () => {
      try {
        await onSave(next.server);
        setStatus("saved");
      } catch (failure) {
        setError(failure instanceof Error && failure.message ? failure.message : "The settings could not be saved.");
        setStatus("idle");
      }
    });
  };

  const apply = (next: Snapshot, record: boolean) => {
    const current = { server: draft, voice: voiceDraft };
    if (sameSnapshot(current, next)) return;
    if (record) setHistory((h) => [...h, current]);
    setDraftState(next.server);
    setVoiceDraftState(next.voice);
    persist(next, JSON.stringify(next.server) !== JSON.stringify(draft));
  };

  const setDraft = (server: Settings) => apply({ server, voice: voiceDraft }, true);
  const setVoiceDraft = (voice: VoiceSettings) => apply({ server: draft, voice }, true);

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    apply(previous, false);
  };

  const reset = () => apply({ server: { ...DEFAULT_SETTINGS, theme: draft.theme }, voice: { ...DEFAULT_VOICE_SETTINGS } }, true);

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-meta text-muted-foreground" role="status">
            {status === "saving" ? (
              <span key="saving" className="fade-in inline-flex">
                <SpinnerIcon size={14} />
              </span>
            ) : status === "saved" ? (
              <span key="saved" className="fade-in inline-flex text-success">
                <CheckIcon size={14} />
              </span>
            ) : null}
            {status === "saving" ? "Saving …" : status === "saved" ? "Saved" : "Changes save as you make them."}
          </span>
          <Button onClick={undo} disabled={history.length === 0}>
            Undo
          </Button>
          <Button onClick={reset}>Reset to defaults</Button>
          <DialogClose asChild>
            <Button variant="default">Done</Button>
          </DialogClose>
        </>
      }
    >
      <div className="space-y-3">
        {error ? (
          <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />}>
            {error}
          </Alert>
        ) : null}

        <fieldset className="min-w-0 rounded-xl bg-sunken p-4 sm:p-5">
          <legend className="float-left w-full text-lead font-bold">Round length</legend>
          <p className="clear-both mb-4 text-ui text-muted-foreground">Applies to rounds you start after the change. The phase plan scales with it.</p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <div className="flex items-center gap-3">
              <span className="w-10 text-ui text-muted-foreground">HLD</span>
              <Segmented
                label="HLD round length"
                value={String(draft.durations.hld)}
                options={[
                  { value: "45", label: "45 min" },
                  { value: "60", label: "60 min" },
                ]}
                onChange={(value) => setDraft({ ...draft, durations: { ...draft.durations, hld: value === "60" ? 60 : 45 } })}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-10 text-ui text-muted-foreground">LLD</span>
              <Segmented
                label="LLD round length"
                value={String(draft.durations.lld)}
                options={[
                  { value: "90", label: "90 min" },
                  { value: "120", label: "120 min" },
                ]}
                onChange={(value) => setDraft({ ...draft, durations: { ...draft.durations, lld: value === "120" ? 120 : 90 } })}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="min-w-0 rounded-xl bg-sunken p-4 sm:p-5">
          <legend className="float-left w-full text-lead font-bold">Models and effort</legend>
          <p className="clear-both mb-4 text-ui text-muted-foreground">Higher effort thinks longer. The judge benefits most from it.</p>
          <div className="grid grid-cols-2 items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-y-3">
            <span className="text-ui font-semibold text-muted-foreground max-sm:hidden">Role</span>
            <span className="text-ui font-semibold text-muted-foreground max-sm:hidden">Model</span>
            <span className="text-ui font-semibold text-muted-foreground max-sm:hidden">Effort</span>
            {ROLES.map((role) => (
              <RoleRow
                key={role.key}
                label={role.label}
                hint={role.hint}
                model={draft.models[role.key]}
                effort={draft.effort[role.key]}
                onModel={(value) => setDraft({ ...draft, models: { ...draft.models, [role.key]: value } })}
                onEffort={(value) => setDraft({ ...draft, effort: { ...draft.effort, [role.key]: value } })}
              />
            ))}
          </div>
        </fieldset>

        <fieldset className="min-w-0 rounded-xl bg-sunken p-4 sm:p-5">
          <legend className="float-left w-full text-lead font-bold">Theme</legend>
          <p className="clear-both mb-4 text-ui text-muted-foreground">Colour scheme for the whole app. Applies as soon as you pick it.</p>
          <Segmented
            label="Theme"
            value={draft.theme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onChange={(value) => setDraft({ ...draft, theme: value })}
          />
        </fieldset>

        <fieldset className="min-w-0 rounded-xl bg-sunken p-4 sm:p-5">
          <legend className="float-left w-full text-lead font-bold">Voice</legend>
          <p className="clear-both mb-4 text-ui text-muted-foreground">Spoken dialogue during interview and coach rounds.</p>
          <div className="space-y-4">
            <div>
              <span className="mb-1.5 block text-ui font-semibold text-muted-foreground">Speak replies</span>
              <Segmented
                label="Speak replies"
                value={voiceDraft.speakReplies ? "on" : "off"}
                options={[
                  { value: "off", label: "Off" },
                  { value: "on", label: "On" },
                ]}
                onChange={(value) => setVoiceDraft({ ...voiceDraft, speakReplies: value === "on" })}
              />
            </div>

            {voiceDraft.speakReplies ? (
              <>
                <div className="max-w-56">
                  <Label htmlFor="settings-kokoro-speed" className="mb-1.5 block">
                    Speed
                  </Label>
                  <Select
                    id="settings-kokoro-speed"
                    label="Speed"
                    className="w-full"
                    value={String(voiceDraft.kokoroSpeed)}
                    options={SPEED_OPTIONS}
                    onChange={(val) => setVoiceDraft({ ...voiceDraft, kokoroSpeed: Number(val) })}
                  />
                </div>
              </>
            ) : null}

            <div>
              <div className="flex items-center gap-3">
                <Switch
                  id="settings-headphones"
                  checked={voiceDraft.useHeadphones}
                  onCheckedChange={(checked) => setVoiceDraft({ ...voiceDraft, useHeadphones: checked })}
                />
                <Label htmlFor="settings-headphones" className="font-medium text-foreground">
                  I use headphones
                </Label>
              </div>
              <p className="mt-1 text-meta text-muted-foreground">
                {voiceDraft.useHeadphones
                  ? "The mic stays on while the interviewer speaks, so you can interrupt by talking."
                  : "The mic pauses while the interviewer speaks, so it does not type the reply. Press Esc to interrupt."}
              </p>
            </div>

            <div>
              <span className="mb-1.5 block text-ui font-semibold text-muted-foreground">Voice input mode</span>
              <Segmented
                label="Voice input mode"
                value={voiceDraft.sendMode}
                options={[
                  { value: "review", label: "Review before sending" },
                  { value: "pause", label: "Send after a pause" },
                ]}
                onChange={(value) => setVoiceDraft({ ...voiceDraft, sendMode: value as "review" | "pause" })}
              />
              <p className="mt-1 text-meta text-muted-foreground">
                {voiceDraft.sendMode === "review"
                  ? "Final transcript lands in the input for review before sending."
                  : "Automatically sends message after about 2 seconds of silence."}
              </p>
            </div>
          </div>
        </fieldset>

        <fieldset className="min-w-0 rounded-xl bg-sunken p-4 sm:p-5">
          <legend className="float-left w-full text-lead font-bold">Study folder</legend>
          <p className="clear-both mb-4 text-ui text-muted-foreground">Tracker, review and notes edits are written here, only after you approve them.</p>
          <code className="block break-all rounded-md border border-border bg-card px-3 py-2 font-mono text-ui text-foreground">{studyRoot}</code>
        </fieldset>
      </div>
    </Modal>
  );
}

function RoleRow({
  label,
  hint,
  model,
  effort,
  onModel,
  onEffort,
}: {
  label: string;
  hint: string;
  model: ModelId;
  effort: Effort;
  onModel: (value: ModelId) => void;
  onEffort: (value: Effort) => void;
}) {
  return (
    <>
      <div className="col-span-2 mt-2 sm:col-span-1 sm:mt-0">
        <div className="text-ui font-medium">{label}</div>
        <div className="text-meta text-muted-foreground">{hint}</div>
      </div>
      <Select
        label={`${label} model`}
        className="w-full"
        value={model}
        options={MODEL_OPTIONS}
        onChange={onModel}
      />
      <Select
        label={`${label} effort`}
        className="w-full"
        value={effort}
        options={EFFORT_OPTIONS}
        onChange={onEffort}
      />
    </>
  );
}
