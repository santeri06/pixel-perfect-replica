import { useMemo, useSyncExternalStore } from "react";
import { registry, instances } from "@/data/registry";
import { sortEntries, type MaintenanceEntry } from "@/data/maintenance";
import {
  CHANGE_EVENT,
  STORAGE_KEY,
  createLocalRepo,
  memoryStorage,
  type MaintenanceRepo,
  type StoreFile,
} from "@/lib/maintenanceLocal";

type KV = Pick<Storage, "getItem" | "setItem">;
let backend: { storage: KV; persistent: boolean } | null = null;
let repo: MaintenanceRepo | null = null;

/** localStorage if it works, otherwise an in-memory store (entries then last until reload). */
function getBackend() {
  if (!backend) {
    try {
      const ls = window.localStorage;
      const probe = "veo.probe";
      ls.setItem(probe, "1");
      ls.removeItem(probe);
      backend = { storage: ls, persistent: true };
    } catch {
      backend = { storage: memoryStorage(), persistent: false };
    }
  }
  return backend;
}

/** False when the browser blocks localStorage: show a warning, data is lost on reload. */
export function isStoragePersistent(): boolean {
  return typeof window === "undefined" ? true : getBackend().persistent;
}

/** Browser-only singleton. */
export function getMaintenanceRepo(): MaintenanceRepo {
  if (!repo) {
    repo = createLocalRepo({
      storage: getBackend().storage,
      seed: { seedVersion: registry.seedVersion, entries: registry.seedEntries },
      instances,
      notify: () => window.dispatchEvent(new Event(CHANGE_EVENT)),
    });
  }
  return repo;
}

const EMPTY: StoreFile = { schema: 1, seedVersion: "", entries: [] };
let cache: { raw: string | null; file: StoreFile } = { raw: null, file: EMPTY };

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) cb();
  };
  window.addEventListener("storage", onStorage); // other tabs, e.g. the Field App
  window.addEventListener(CHANGE_EVENT, cb); // this tab
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}

function readRaw(): string | null {
  try {
    return getBackend().storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Same object until the stored value changes (required by useSyncExternalStore). */
function getSnapshot(): StoreFile {
  const raw = readRaw();
  if (raw === cache.raw && raw !== null) return cache.file;
  const file = getMaintenanceRepo().read(); // seeds on first use
  cache = { raw: readRaw(), file };
  return file;
}

const getServerSnapshot = () => EMPTY;

/** The whole log; `seedVersion === ""` means "not loaded yet" (server render). */
export function useMaintenanceFile(): StoreFile {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Entries of one device, newest first; updates live when the Field App saves. */
export function useMaintenanceEntries(instanceId: string | undefined): MaintenanceEntry[] {
  const file = useMaintenanceFile();
  return useMemo(
    () => (instanceId ? sortEntries(file.entries.filter((e) => e.instanceId === instanceId)) : []),
    [file, instanceId],
  );
}
