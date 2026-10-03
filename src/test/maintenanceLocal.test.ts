import { describe, expect, it } from "vitest";
import type { MaintenanceEntry } from "@/data/maintenance";
import { maintenanceEntrySchema } from "@/data/maintenance.schema";
import {
  NotFoundError,
  STORAGE_KEY,
  ValidationError,
  VersionConflictError,
  createLocalRepo,
  type StoreFile,
} from "@/lib/maintenanceLocal";
import { validInput } from "./fixtures";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

const seedEntry: MaintenanceEntry = {
  ...validInput({ source: "import", performedAt: "2025-06-10", nextDueAt: "2026-06-10" }),
  id: "seed-1",
  version: 1,
  createdAt: "2025-06-10T08:00:00.000Z",
  updatedAt: "2025-06-10T08:00:00.000Z",
};

function setup(storage = memoryStorage(), seedVersion = "v1") {
  let notified = 0;
  let n = 0;
  const repo = createLocalRepo({
    storage,
    seed: { seedVersion, entries: [seedEntry] },
    instances: [
      { id: "DEV-1", maintenanceIntervalMonths: 12 },
      { id: "DEV-2", maintenanceIntervalMonths: 12 },
    ],
    now: () => new Date("2026-10-03T10:00:00.000Z"),
    uuid: () => `id-${++n}`,
    notify: () => void notified++,
  });
  return { repo, storage, notified: () => notified };
}

const stored = (s: ReturnType<typeof memoryStorage>) =>
  JSON.parse(s.data.get(STORAGE_KEY) ?? "null") as StoreFile;

describe("local maintenance repository", () => {
  it("seeds the demo history on first use", () => {
    const { repo, storage } = setup();
    expect(repo.listEntries("DEV-1").map((e) => e.id)).toEqual(["seed-1"]);
    expect(stored(storage).seedVersion).toBe("v1");
  });

  it("creates an entry on the right device only, with version 1, and notifies", () => {
    const { repo, notified } = setup();
    const e = repo.createEntry(validInput({ instanceId: "DEV-2", performedAt: "2026-10-03" }));
    expect(e.version).toBe(1);
    expect(repo.listEntries("DEV-2").map((x) => x.id)).toEqual([e.id]);
    expect(repo.listEntries("DEV-1").map((x) => x.id)).toEqual(["seed-1"]);
    expect(notified()).toBe(1);
  });

  it("defaults the next due date for periodic work, not for faults", () => {
    const { repo } = setup();
    expect(repo.createEntry(validInput({ performedAt: "2026-10-03" })).nextDueAt).toBe(
      "2027-10-03",
    );
    expect(
      repo.createEntry(validInput({ kind: "repair", performedAt: "2026-10-03" })).nextDueAt,
    ).toBe(null);
  });

  it("rejects invalid input with field errors", () => {
    const { repo } = setup();
    let err: unknown = null;
    try {
      repo.createEntry(validInput({ result: null }));
    } catch (e) {
      err = e;
    }
    expect(err instanceof ValidationError).toBe(true);
    expect((err as ValidationError).fields["result"]).toBe("Required when the work is done");
  });

  it("rejects an unknown device", () => {
    const { repo } = setup();
    expect(() => repo.createEntry(validInput({ instanceId: "NOPE" }))).toThrow(NotFoundError);
  });

  it("closes an open notice with a version check (409-style conflict)", () => {
    const { repo } = setup();
    const open = repo.createEntry(
      validInput({
        kind: "fault",
        status: "open",
        performedAt: null,
        result: null,
        title: "HMI flickers",
      }),
    );
    const closed = repo.updateEntry(
      open.id,
      { status: "done", performedAt: "2026-10-03", result: "ok", actions: "HMI replaced" },
      1,
    );
    expect(closed.version).toBe(2);
    expect(closed.status).toBe("done");
    expect(() => repo.updateEntry(open.id, { title: "stale write" }, 1)).toThrow(
      VersionConflictError,
    );
  });

  it("never moves an entry to another device", () => {
    const { repo } = setup();
    const e = repo.createEntry(validInput());
    expect(repo.updateEntry(e.id, { instanceId: "DEV-2" }, 1).instanceId).toBe("DEV-1");
  });

  it("refreshes the demo seed but keeps recorded entries when the registry changes", () => {
    const s = memoryStorage();
    const first = setup(s, "v1");
    const mine = first.repo.createEntry(validInput({ instanceId: "DEV-2" }));
    const gone = { ...mine, id: "gone", instanceId: "REMOVED" };
    const file = stored(s);
    s.setItem(STORAGE_KEY, JSON.stringify({ ...file, entries: [...file.entries, gone] }));

    const second = setup(s, "v2");
    const ids = second.repo
      .read()
      .entries.map((e) => e.id)
      .sort();
    expect(ids).toEqual([mine.id, "seed-1"].sort());
    expect(stored(s).seedVersion).toBe("v2");
  });

  it("keeps an edited demo entry (e.g. a closed seeded fault) when the registry changes", () => {
    const s = memoryStorage();
    const first = setup(s, "v1");
    first.repo.updateEntry("seed-1", { actions: "Edited on site" }, 1);
    const second = setup(s, "v2");
    const entries = second.repo.listEntries("DEV-1");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actions).toBe("Edited on site");
  });

  it("recovers from a corrupted value by reseeding", () => {
    const { repo } = setup(memoryStorage({ [STORAGE_KEY]: "{not json" }));
    expect(repo.listEntries("DEV-1")).toHaveLength(1);
  });

  it("accepts an entry exactly as the Field App writes it (shared contract)", () => {
    // mirrors toInput() + store.save() in public/field/index.html
    const fromFieldApp = {
      instanceId: "DEV-1",
      kind: "inspection",
      status: "done",
      title: "Inspection",
      performedAt: "2026-10-03",
      performedBy: "Field Tech",
      company: null,
      findings: "",
      actions: "",
      result: "ok",
      nextDueAt: "2027-10-03",
      firmwareBefore: null,
      firmwareAfter: null,
      workPermitRef: null,
      attachments: [],
      source: "field-app",
      id: "0b6f3f8e-1d2c-4b7a-9a8e-1f2e3d4c5b6a",
      version: 1,
      createdAt: "2026-10-03T10:00:00.000Z",
      updatedAt: "2026-10-03T10:00:00.000Z",
    };
    expect(maintenanceEntrySchema.safeParse(fromFieldApp).success).toBe(true);
  });
});
