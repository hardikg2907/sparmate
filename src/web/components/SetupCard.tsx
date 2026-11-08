import { useState } from "react";
import type { SetupCheck } from "../../shared/protocol";
import { CheckIcon, CopyIcon, WarnIcon } from "./icons";
import { Button, Card, cn, toast } from "./ui";

function FixCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(command).then(
      () => {
        setCopied(true);
        toast.success("Command copied");
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div className="mt-2 flex items-center gap-2 rounded-md bg-sunken px-3 py-1.5">
      <code className="min-w-0 flex-1 break-words font-mono text-meta text-foreground">{command}</code>
      <Button variant="ghost" size="sm" onClick={copy} className="h-6 shrink-0 px-1.5 text-meta text-primary-text hover:text-primary-text">
        {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Lists what is still missing and the command that fixes each item. It runs nothing itself. Shows only when a required check fails. */
export function SetupCard({ checks }: { checks: SetupCheck[] }) {
  const missing = checks.filter((check) => !check.ok);
  if (!missing.some((check) => !check.optional)) return null;
  return (
    <section aria-labelledby="setup-heading" className="reveal">
      <Card variant="raised" className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-warning">
            <WarnIcon size={16} />
          </span>
          <div className="min-w-0">
            <h2 id="setup-heading" className="text-lead font-semibold text-foreground">
              Finish setting up
            </h2>
            <p className="text-ui text-muted-foreground">Run these in a terminal in the sparmate folder, then reload this page.</p>
          </div>
        </div>
        <ul className="space-y-3">
          {missing.map((check) => (
            <li key={check.id} className={cn("text-ui", check.optional && "text-muted-foreground")}>
              <p>
                <span className={cn("font-semibold", check.optional ? "text-muted-foreground" : "text-foreground")}>{check.title}</span>
                {check.optional ? <span className="ml-2 text-meta">Optional</span> : null}
              </p>
              <p className={check.optional ? undefined : "text-foreground/90"}>{check.detail}</p>
              {check.fix ? <FixCommand command={check.fix} /> : null}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
