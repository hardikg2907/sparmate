import type { Tone } from "../../lib/format";

export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-muted-foreground",
  accent: "text-primary-text",
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
};

export const TONE_FILL: Record<Tone, string> = {
  neutral: "bg-input",
  accent: "bg-primary",
  good: "bg-success-fill",
  warn: "bg-warning-fill",
  bad: "bg-destructive-fill",
};

export const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-primary-soft text-primary-soft-foreground",
  good: "bg-success-soft text-success",
  warn: "bg-warning-soft text-warning",
  bad: "bg-destructive-soft text-destructive",
};
