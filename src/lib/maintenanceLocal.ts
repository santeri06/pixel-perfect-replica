/**
 * Local maintenance repository (P0, "local" mode): localStorage shared by AutoTag and the
 * Field App (public/field/index.html) on the same origin. Other tabs are notified through the
 * browser's `storage` event; the same tab through CHANGE_EVENT.
 *
 * Storage format (the Field App reads and writes exactly this):
 *   localStorage["veo.maintenance.v1"] = { schema: 1, seedVersion, entries: MaintenanceEntry[] }
 *
 * The same interface will get a server implementation (Supabase + /api/v1) in P0-5…P0-7.
 */
import { defaultNextDue, type MaintenanceEntry, type MaintenanceInput } from "@/data/maintenance";
import { fieldErrors, maintenanceInputSchema } from "@/data/maintenance.schema";

export const STORAGE_KEY = "veo.maintenance.v1";
export const CHANGE_EVENT = "veo-maintenance-change";

export interface StoreFile {
  schema: 1;
  seedVersion: string;
  entries: MaintenanceEntry[];
}

export class ValidationError extends Error {
  constructor(public fields: Record<string, string>) {
    super("Invalid maintenance entry");
  }
}
export class VersionConflictError extends Error {
  constructor(public current: MaintenanceEntry) {
    super("The entry was changed elsewhere");
  }
}
export class NotFoundError extends Error {}

export interface MaintenanceRepo {
  read(): StoreFile;
  listEntries(instanceId: string): MaintenanceEntry[];
  createEntry(input: MaintenanceInput): MaintenanceEntry;
  updateEntry(
    id: string,
    patch: Partial<MaintenanceInput>,
    expectedVersion: number,
  ): MaintenanceEntry;
  reset(): void;
}

interface Options {
  storage: Pick<Storage, "getItem" | "setItem">;
  seed: { seedVersion: string; entries: MaintenanceEntry[] };
  instances: { id: string; maintenanceIntervalMonths: number | null }[];
  now?: () => Date;
  uuid?: () => string;
  notify?: () => void;
}

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // randomUUID needs a secure context (https/localhost); fall back for plain-http LAN demos
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function createLocalRepo(opts: Options): MaintenanceRepo {
  const now = opts.now ?? (() => new Date());
  const uuid = opts.uuid ?? newId;
  const ids = new Set(opts.instances.map((i) => i.id));
  const seeded = (): StoreFile => ({
    schema: 1,
    seedVersion: opts.seed.seedVersion,
    entries: [...opts.seed.entries],
  });

  const write = (file: StoreFile) => {
    opts.storage.setItem(STORAGE_KEY, JSON.stringify(file));
    opts.notify?.();
  };

  /** Reads the store; seeds it on first use and refreshes the demo seed when the registry changes. */
  const read = (): StoreFile => {
    let file: StoreFile | null = null;
    try {
      const raw = opts.storage.getItem(STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as StoreFile) : null;
      if (parsed && parsed.schema === 1 && Array.isArray(parsed.entries)) file = parsed;
    } catch {
      file = null; // corrupted value: start again from the demo seed
    }
    if (!file) {
      file = seeded();
      opts.storage.setItem(STORAGE_KEY, JSON.stringify(file));
    } else if (file.seedVersion !== opts.seed.seedVersion) {
      // new registry: replace untouched demo entries, keep everything people recorded or edited
      // (an edited demo entry, e.g. a closed fault notice, has version > 1) for devices that still exist
      const own = file.entries.filter(
        (e) => (e.source !== "import" || e.version > 1) && ids.has(e.instanceId),
      );
      const ownIds = new Set(own.map((e) => e.id));
      file = {
        schema: 1,
        seedVersion: opts.seed.seedVersion,
        entries: [...opts.seed.entries.filter((e) => !ownIds.has(e.id)), ...own],
      };
      opts.storage.setItem(STORAGE_KEY, JSON.stringify(file));
    }
    return file;
  };

  const validate = (input: MaintenanceInput) => {
    const r = maintenanceInputSchema.safeParse(input);
    if (!r.success) throw new ValidationError(fieldErrors(r.error));
    if (!ids.has(r.data.instanceId)) throw new NotFoundError(`Unknown device ${r.data.instanceId}`);
    return r.data;
  };

  const intervalOf = (id: string) =>
    opts.instances.find((i) => i.id === id)?.maintenanceIntervalMonths ?? null;

  return {
    read,
    listEntries: (instanceId) => read().entries.filter((e) => e.instanceId === instanceId),

    createEntry(input) {
      const data = validate(input);
      const ts = now().toISOString();
      const entry: MaintenanceEntry = {
        ...data,
        nextDueAt: data.nextDueAt ?? defaultNextDue(data, intervalOf(data.instanceId)),
        id: uuid(),
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      };
      const file = read();
      write({ ...file, entries: [...file.entries, entry] });
      return entry;
    },

    updateEntry(id, patch, expectedVersion) {
      const file = read();
      const current = file.entries.find((e) => e.id === id);
      if (!current) throw new NotFoundError(`Unknown entry ${id}`);
      if (current.version !== expectedVersion) throw new VersionConflictError(current);
      const { id: _id, version, createdAt, updatedAt, ...rest } = current;
      // an entry never moves to another device
      const data = validate({ ...rest, ...patch, instanceId: current.instanceId });
      const entry: MaintenanceEntry = {
        ...data,
        nextDueAt: data.nextDueAt ?? defaultNextDue(data, intervalOf(data.instanceId)),
        id,
        version: version + 1,
        createdAt,
        updatedAt: now().toISOString(),
      };
      write({ ...file, entries: file.entries.map((e) => (e.id === id ? entry : e)) });
      return entry;
    },

    reset() {
      write(seeded());
    },
  };
}
