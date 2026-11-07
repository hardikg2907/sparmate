import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { cn } from "../../lib/utils";

/** A radio group drawn as a segmented control: arrow keys move and select, as in any radio group. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  name,
  disabled,
  size = "default",
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  name?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={label}
      name={name}
      value={value}
      disabled={disabled}
      orientation="horizontal"
      onValueChange={(next) => onChange(next as T)}
      className={cn("inline-flex gap-0.5 rounded-md bg-muted p-0.5 ring-1 ring-inset ring-border-strong/50", className)}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          title={option.title}
          className={cn(
            "inline-flex items-center rounded-[5px] px-3 text-ui font-semibold text-muted-foreground transition-[color,background-color,box-shadow] duration-150 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55 data-[state=checked]:bg-card data-[state=checked]:text-foreground data-[state=checked]:shadow-xs data-[state=checked]:ring-1 data-[state=checked]:ring-input/70",
            size === "sm" ? "h-7" : "h-8",
          )}
        >
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
