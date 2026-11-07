import { readFile } from "node:fs/promises";
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from "../../shared/types";
import { writeFileAtomic } from "./fsutil";
import type { Logger } from "./log";

export class SettingsStore {
  private current: Settings = structuredClone(DEFAULT_SETTINGS);

  constructor(
    private readonly path: string,
    private readonly log: Logger,
  ) {}

  async load(): Promise<Settings> {
    try {
      const parsed = SettingsSchema.safeParse(JSON.parse(await readFile(this.path, "utf8")));
      if (parsed.success) this.current = parsed.data;
      else this.log.warn("settings.json does not match the settings format; using defaults");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") this.log.warn("Could not read settings.json; using defaults", err);
    }
    return this.get();
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  async save(next: Settings): Promise<Settings> {
    const parsed = SettingsSchema.parse(next);
    await writeFileAtomic(this.path, `${JSON.stringify(parsed, null, 2)}\n`);
    this.current = parsed;
    return this.get();
  }
}
