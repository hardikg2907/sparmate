import { useId } from "react";
import { cn } from "../lib/utils";
import { Label } from "./ui/label";
import { SelectContent, SelectItem, SelectRoot, SelectTrigger, SelectValue } from "./ui/select";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  id?: string;
  label: string;
  hideLabel?: boolean;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** A single-choice list. The label names the trigger for screen readers even when it is not shown. */
export function Select<T extends string>({ id, label, hideLabel = true, value, options, onChange, disabled = false, size = "md", className }: SelectProps<T>) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const trigger = (
    <SelectRoot value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
      <SelectTrigger id={selectId} aria-label={label} size={size === "sm" ? "sm" : "default"} className={cn(className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled} hint={option.hint}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </SelectRoot>
  );
  if (hideLabel) return trigger;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={selectId}>{label}</Label>
      {trigger}
    </div>
  );
}
