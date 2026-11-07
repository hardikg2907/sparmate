import { createWriteStream, type WriteStream } from "node:fs";

export interface Logger {
  info(message: string): void;
  warn(message: string, err?: unknown): void;
  error(message: string, err?: unknown): void;
  /** Adds a secret that must never reach the log in clear text (for example the CSRF token). */
  addSecret(secret: string): void;
  close(): Promise<void>;
}

const MAX_LINE = 2000;

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const frames = (err.stack ?? "").split("\n").slice(1, 4).map((l) => l.trim()).join(" | ");
    return frames ? `${err.name}: ${err.message} (${frames})` : `${err.name}: ${err.message}`;
  }
  return String(err);
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… [${text.length - max} more chars]`;
}

export interface LoggerOptions {
  file: string;
  redact: (text: string) => string;
  /** Echo warnings and errors to stderr as well. */
  echo?: boolean;
}

export function createLogger(options: LoggerOptions): Logger {
  const stream: WriteStream = createWriteStream(options.file, { flags: "a", mode: 0o600 });
  const secrets: string[] = [];
  stream.on("error", () => {
    // A broken log file must never take the server down.
  });

  const clean = (text: string): string => {
    let out = text;
    for (const s of secrets) out = out.split(s).join("[secret]");
    out = options.redact(out);
    return truncate(out.replace(/\r?\n/g, " ⏎ "), MAX_LINE);
  };

  const write = (level: "info" | "warn" | "error", message: string, err?: unknown) => {
    const line = clean(err === undefined ? message : `${message}: ${describeError(err)}`);
    stream.write(`${new Date().toISOString()} ${level.toUpperCase()} ${line}\n`);
    if (options.echo !== false && level !== "info") process.stderr.write(`[interview-room] ${level}: ${line}\n`);
  };

  return {
    info: (m) => write("info", m),
    warn: (m, e) => write("warn", m, e),
    error: (m, e) => write("error", m, e),
    addSecret: (s) => {
      if (s) secrets.push(s);
    },
    close: () => new Promise<void>((resolve) => stream.end(resolve)),
  };
}

/** A logger that only collects lines, for tests. */
export function memoryLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`INFO ${m}`),
    warn: (m, e) => lines.push(`WARN ${m}${e === undefined ? "" : `: ${describeError(e)}`}`),
    error: (m, e) => lines.push(`ERROR ${m}${e === undefined ? "" : `: ${describeError(e)}`}`),
    addSecret: () => {},
    close: async () => {},
  };
}
