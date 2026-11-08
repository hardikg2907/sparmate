import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Effort, ModelId, Settings } from "../../shared/types";
import { DAY_KINDS, DEFAULT_WEEKLY_PLAN, DSA_GOAL_MAX, DSA_GOAL_MIN, LEETCODE_USERNAME_PATTERN, WEEKDAYS, type DayKind } from "../../shared/week";
import { CalendarIcon, CheckIcon, ClockIcon, CodeIcon, FolderIcon, MicIcon, MinusIcon, NetworkIcon, PlusIcon, SpinnerIcon, WarnIcon } from "../components/icons";
import { PageHeader, PageShell } from "../components/PageShell";
import { Select } from "../components/Select";
import { Alert, Button, Card, Input, Segmented, Switch, cn } from "../components/ui";
import { DEFAULT_SETTINGS } from "../lib/contract";
import { DEFAULT_VOICE_SETTINGS, getVoiceSettings, saveVoiceSettings, type VoiceSettings } from "../lib/voiceSettings";
import type { Theme } from "../theme";
import type { PageContext } from "./context";

// Typed as records so a model or effort added to the settings schema is a compile error until it has a label.
const MODEL_LABEL: Record<ModelId, string> = { "claude-opus-5-5": "Opus 5.5", "claude-sonnet-5-5": "Sonnet 5.5" };
const MODEL_HINT: Record<ModelId, string> = { "claude-opus-5-5": "Most capable", "claude-sonnet-5-5": "Faster, high quality" };
const EFFORT_LABEL: Record<Effort, string> = { low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const MODEL_OPTIONS = (Object.keys(MODEL_LABEL) as ModelId[]).map((id) => ({ value: id, label: MODEL_LABEL[id], hint: MODEL_HINT[id] }));
const EFFORT_OPTIONS = (Object.keys(EFFORT_LABEL) as Effort[]).map((value) => ({ value, label: EFFORT_LABEL[value] }));

const SPEED_OPTIONS = [
  { value: "0.8", label: "0.8x", hint: "Slower" },
  { value: "0.9", label: "0.9x" },
  { value: "0.95", label: "0.95x", hint: "Default" },
  { value: "1", label: "1.0x", hint: "Normal" },
  { value: "1.1", label: "1.1x" },
  { value: "1.2", label: "1.2x", hint: "Faster" },
];

const ROLES = [
  { key: "interviewer", label: "Interviewer", hint: "Runs the round and the guide" },
  { key: "judge", label: "Judge", hint: "Scores the round" },
  { key: "coach", label: "Coach", hint: "Teaches the gaps" },
  { key: "scribe", label: "Study notes", hint: "Drafts tracker and notes edits" },
] as const;

const DAY_LABEL: Record<DayKind, string> = { hld: "HLD", lld: "LLD", dsa: "DSA", redo: "Redo", rest: "Rest" };
const DAY_OPTIONS = DAY_KINDS.map((value) => ({ value, label: DAY_LABEL[value] }));

const SECTIONS = [
  { id: "plan", label: "Weekly plan", icon: CalendarIcon },
  { id: "dsa", label: "DSA and LeetCode", icon: CodeIcon },
  { id: "rounds", label: "Rounds", icon: ClockIcon },
  { id: "models", label: "Models", icon: NetworkIcon },
  { id: "voice", label: "Voice and theme", icon: MicIcon },
  { id: "folder", label: "Study folder", icon: FolderIcon },
] as const;

interface SettingsViewProps {
  settings: Settings;
  studyRoot: string;
  testMode: boolean;
  /** Throws an Error with a plain message when saving fails. */
  onSave: (settings: Settings) => Promise<void>;
  onApplyTheme: (theme: Theme) => void;
}

const sameDraft = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b);

function usernameProblem(value: string): string | null {
  if (value === "") return null;
  return LEETCODE_USERNAME_PATTERN.test(value) ? null : "Use 1 to 40 letters, digits, underscores or hyphens.";
}

/** Everything is edited in a draft and written once, by Save changes. */
export function SettingsView({ settings, studyRoot, testMode, onSave, onApplyTheme }: SettingsViewProps) {
  const [saved, setSaved] = useState<Settings>(settings);
  const [draft, setDraft] = useState<Settings>(settings);
  const [savedVoice, setSavedVoice] = useState<VoiceSettings>(getVoiceSettings);
  const [voice, setVoice] = useState<VoiceSettings>(savedVoice);
  const [username, setUsername] = useState(settings.leetcodeUsername ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const sections = useRef<Map<string, HTMLElement>>(new Map());

  const nameProblem = usernameProblem(username);
  const next: Settings = { ...draft, leetcodeUsername: username === "" ? undefined : username };
  if (next.leetcodeUsername === undefined) delete next.leetcodeUsername;
  const dirty = !sameDraft(next, saved) || JSON.stringify(voice) !== JSON.stringify(savedVoice);

  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id.replace("settings-", ""));
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    for (const el of sections.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const edit = (patch: Partial<Settings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus("idle");
  };
  const editVoice = (patch: Partial<VoiceSettings>) => {
    setVoice((v) => ({ ...v, ...patch }));
    setStatus("idle");
  };

  const save = async () => {
    if (nameProblem) return;
    setStatus("saving");
    setError(null);
    try {
      await onSave(next);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "The settings could not be saved.");
      setStatus("idle");
      return;
    }
    saveVoiceSettings(voice);
    if (next.theme !== saved.theme) onApplyTheme(next.theme);
    setSaved(next);
    setSavedVoice(voice);
    setStatus("saved");
  };

  const reset = () => {
    setDraft({ ...DEFAULT_SETTINGS, theme: draft.theme });
    setUsername("");
    setVoice({ ...DEFAULT_VOICE_SETTINGS });
    setStatus("idle");
  };

  const goTo = (id: string) => {
    setActive(id);
    sections.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const register = (id: string) => (el: HTMLElement | null) => {
    if (el) sections.current.set(id, el);
    else sections.current.delete(id);
  };

  return (
    <PageShell testMode={testMode}>
      <div className="reveal-children space-y-6">
        <PageHeader
          title="Settings"
          aside={
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1.5 text-meta text-muted-foreground" role="status">
                {status === "saving" ? <SpinnerIcon size={14} /> : status === "saved" ? <CheckIcon size={14} className="text-success" /> : null}
                {status === "saving" ? "Saving …" : status === "saved" ? "Saved" : dirty ? "You have unsaved changes." : ""}
              </span>
              <Button variant="ghost" onClick={reset}>
                Reset to defaults
              </Button>
              <Button variant="default" size="lg" busy={status === "saving"} disabled={!dirty || nameProblem !== null} onClick={() => void save()}>
                Save changes
              </Button>
            </div>
          }
        />
        {error ? (
          <Alert tone="bad" role="alert" icon={<WarnIcon size={16} />}>
            {error}
          </Alert>
        ) : null}

        <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
          <nav aria-label="Settings sections" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 lg:sticky lg:top-20 lg:flex-col lg:overflow-visible">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={active === id ? "true" : undefined}
                onClick={() => goTo(id)}
                className={cn(
                  "flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-ui font-medium transition-colors",
                  active === id ? "bg-primary-soft text-foreground ring-1 ring-inset ring-primary/40" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon size={16} />
                {label}
              </button>
            ))}
          </nav>

          <div className="flex max-w-[880px] flex-col gap-5">
            <Section id="plan" title="Weekly plan" help="Today picks its session from this. A redo of the day's track comes first." refFor={register}>
              <div className="py-4">
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {WEEKDAYS.map((day, index) => (
                    <div key={day} className="rounded-xl bg-sunken p-2.5 ring-1 ring-inset ring-border">
                      <span className="mb-1.5 block text-meta text-muted-foreground">{day}</span>
                      <Select
                        label={`${day} plan`}
                        className="w-full"
                        value={draft.weeklyPlan[index] ?? "rest"}
                        options={DAY_OPTIONS}
                        onChange={(value) => edit({ weeklyPlan: draft.weeklyPlan.map((d, i) => (i === index ? value : d)) })}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between text-meta text-muted-foreground">
                  <span>Each day: HLD, LLD, DSA, Redo or Rest</span>
                  <Button variant="ghost" size="sm" onClick={() => edit({ weeklyPlan: [...DEFAULT_WEEKLY_PLAN] })}>
                    Reset to default
                  </Button>
                </div>
              </div>
            </Section>

            <Section id="dsa" title="DSA and LeetCode" refFor={register}>
              <Field label="LeetCode username" hint="Public profile only, no login">
                <div className="space-y-1.5">
                  <Input
                    id="settings-leetcode"
                    aria-label="LeetCode username"
                    aria-invalid={nameProblem !== null}
                    aria-describedby={nameProblem ? "settings-leetcode-error" : undefined}
                    className="max-w-[260px]"
                    maxLength={40}
                    autoComplete="off"
                    spellCheck={false}
                    value={username}
                    onChange={(event) => {
                      setUsername(event.target.value.trim());
                      setStatus("idle");
                    }}
                  />
                  {nameProblem ? (
                    <p id="settings-leetcode-error" className="text-meta text-destructive">
                      {nameProblem}
                    </p>
                  ) : null}
                </div>
              </Field>
              <Field label="Weekly goal">
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center rounded-md border border-input/70 bg-card">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Fewer a week"
                      disabled={draft.dsaWeeklyGoal <= DSA_GOAL_MIN}
                      onClick={() => edit({ dsaWeeklyGoal: draft.dsaWeeklyGoal - 1 })}
                    >
                      <MinusIcon size={14} />
                    </Button>
                    <output aria-label="Mediums a week" className="w-10 text-center text-ui font-semibold tabular-nums">
                      {draft.dsaWeeklyGoal}
                    </output>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="More a week"
                      disabled={draft.dsaWeeklyGoal >= DSA_GOAL_MAX}
                      onClick={() => edit({ dsaWeeklyGoal: draft.dsaWeeklyGoal + 1 })}
                    >
                      <PlusIcon size={14} />
                    </Button>
                  </div>
                  <span className="text-ui text-muted-foreground">mediums a week</span>
                </div>
              </Field>
            </Section>

            <Section id="rounds" title="Rounds" help="Applies to rounds you start after the change. The step plan scales with it." refFor={register}>
              <Field label="System design">
                <Segmented
                  label="HLD round length"
                  value={String(draft.durations.hld)}
                  options={[
                    { value: "45", label: "45 min" },
                    { value: "60", label: "60 min" },
                  ]}
                  onChange={(value) => edit({ durations: { ...draft.durations, hld: value === "60" ? 60 : 45 } })}
                />
              </Field>
              <Field label="Machine coding">
                <Segmented
                  label="LLD round length"
                  value={String(draft.durations.lld)}
                  options={[
                    { value: "90", label: "90 min" },
                    { value: "120", label: "120 min" },
                  ]}
                  onChange={(value) => edit({ durations: { ...draft.durations, lld: value === "120" ? 120 : 90 } })}
                />
              </Field>
            </Section>

            <Section id="models" title="Models" help="Higher effort thinks longer. The judge gains most from it." refFor={register}>
              {ROLES.map((role) => (
                <Field key={role.key} label={role.label} hint={role.hint}>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,13rem)_minmax(0,10rem)]">
                    <Select
                      label={`${role.label} model`}
                      className="w-full"
                      value={draft.models[role.key]}
                      options={MODEL_OPTIONS}
                      onChange={(value) => edit({ models: { ...draft.models, [role.key]: value } })}
                    />
                    <Select
                      label={`${role.label} effort`}
                      className="w-full"
                      value={draft.effort[role.key]}
                      options={EFFORT_OPTIONS}
                      onChange={(value) => edit({ effort: { ...draft.effort, [role.key]: value } })}
                    />
                  </div>
                </Field>
              ))}
            </Section>

            <Section id="voice" title="Voice and theme" refFor={register}>
              <Field label="Theme" hint="Applies when you save">
                <Segmented
                  label="Theme"
                  value={draft.theme}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                  onChange={(value) => edit({ theme: value })}
                />
              </Field>
              <Field label="Speak replies" hint="Speed shows when this is on">
                <div className="flex flex-wrap items-center gap-4">
                  <Segmented
                    label="Speak replies"
                    value={voice.speakReplies ? "on" : "off"}
                    options={[
                      { value: "off", label: "Off" },
                      { value: "on", label: "On" },
                    ]}
                    onChange={(value) => editVoice({ speakReplies: value === "on" })}
                  />
                  {voice.speakReplies ? (
                    <Select
                      label="Speed"
                      className="w-32"
                      value={String(voice.kokoroSpeed)}
                      options={SPEED_OPTIONS}
                      onChange={(value) => editVoice({ kokoroSpeed: Number(value) })}
                    />
                  ) : null}
                </div>
              </Field>
              <Field label="Voice input" hint={voice.sendMode === "review" ? "The transcript lands in the box for review." : "Sends after about 2 seconds of silence."}>
                <Segmented
                  label="Voice input mode"
                  value={voice.sendMode}
                  options={[
                    { value: "review", label: "Review before sending" },
                    { value: "pause", label: "Send after a pause" },
                  ]}
                  onChange={(value) => editVoice({ sendMode: value })}
                />
              </Field>
              <Field
                label="I use headphones"
                hint={
                  voice.useHeadphones ? "The mic stays on while the interviewer speaks. Talk to interrupt." : "The mic pauses while the interviewer speaks. Press Esc to interrupt."
                }
              >
                <Switch id="settings-headphones" aria-label="I use headphones" checked={voice.useHeadphones} onCheckedChange={(checked) => editVoice({ useHeadphones: checked })} />
              </Field>
            </Section>

            <Section id="folder" title="Study folder" help="Tracker, review and notes edits are written here, only after you approve them." refFor={register}>
              <Field label="Folder">
                <code className="block break-all rounded-md bg-sunken px-3 py-2 font-mono text-ui text-foreground ring-1 ring-inset ring-border">{studyRoot}</code>
              </Field>
            </Section>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

export function SettingsPage({
  ctx,
  studyRoot,
  onSave,
  onApplyTheme,
}: {
  ctx: PageContext;
  studyRoot: string;
  onSave: (settings: Settings) => Promise<void>;
  onApplyTheme: (theme: Theme) => void;
}) {
  useEffect(() => {
    document.title = "Settings · Sparmate";
  }, []);
  return <SettingsView settings={ctx.settings} studyRoot={studyRoot} testMode={ctx.testMode} onSave={onSave} onApplyTheme={onApplyTheme} />;
}

function Section({
  id,
  title,
  help,
  refFor,
  children,
}: {
  id: string;
  title: string;
  help?: string;
  refFor: (id: string) => (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <Card variant="raised" className="scroll-mt-20 p-6 sm:p-7">
      <section id={`settings-${id}`} ref={refFor(id)} aria-labelledby={`settings-${id}-title`}>
        <h2 id={`settings-${id}-title`} className="text-title font-bold tracking-[-0.01em]">
          {title}
        </h2>
        {help ? <p className="mt-0.5 text-ui text-muted-foreground">{help}</p> : null}
        <div className="mt-2 divide-y divide-border">{children}</div>
      </section>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid items-center gap-x-6 gap-y-2 py-4 first:pt-2 sm:grid-cols-[200px_minmax(0,1fr)]">
      <div>
        <span className="block text-body font-semibold text-foreground">{label}</span>
        {hint ? <p className="mt-0.5 text-meta font-normal text-faint">{hint}</p> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}
