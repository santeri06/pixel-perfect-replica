import { useMemo, useSyncExternalStore } from "react";
import { registry, instances } from "@/data/registry";
import { sortEntries, type MaintenanceEntry } from "@/data/maintenance";
import {
  CHANGE_EVENT,
  STORAGE_KEY,
  createLocalRepo,
  type MaintenanceRepo,
  type StoreFile,
} from "@/lib/maintenanceLocal";

let repo: MaintenanceRepo | null = null;

/** Browser-only singleton. */
export function getMaintenanceRepo(): MaintenanceRepo {
  if (!repo) {
    repo = createLocalRepo({
      storage: window.localStorage,
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

/** Same object until the stored value changes (required by useSyncExternalStore). */
function getSnapshot(): StoreFile {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cache.raw && raw !== null) return cache.file;
  const file = getMaintenanceRepo().read(); // seeds on first use
  cache = { raw: window.localStorage.getItem(STORAGE_KEY), file };
  return file;
}

const getServerSnapshot = () => EMPTY;

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
