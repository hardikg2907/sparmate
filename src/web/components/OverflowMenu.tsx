import type { ReactNode } from "react";
import { MoreIcon } from "./icons";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip } from "./ui/tooltip";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

/** A button that opens a short list of actions. Arrow keys move, Escape closes and hands focus back. */
export function OverflowMenu({ label, items, disabled }: { label: string; items: MenuItem[]; disabled?: boolean }) {
  return (
    <DropdownMenu modal={false}>
      <Tooltip content={label}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Button variant="outline" size="icon" aria-label={label}>
            <MoreIcon size={16} />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent aria-label={label}>
        {items.map((item) => (
          <DropdownMenuItem key={item.label} danger={item.danger} disabled={item.disabled} onSelect={item.onSelect}>
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
