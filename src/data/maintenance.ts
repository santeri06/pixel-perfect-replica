/**
 * Maintenance log data model.
 *
 * Core rule: a maintenance entry belongs to a physical device (AssetInstance.id), never to a
 * detection. Detection IDs change on every CV run; the device stays.
 * Type comes from the image ("615"), the individual device from its position + component list.
 */

export const MAINTENANCE_KINDS = [
  "inspection",
  "secondary_injection_test",
  "trip_test",
  "firmware_update",
  "settings_change",
  "fault",
  "repair",
  "other",
] as const;
export const ENTRY_STATUS = ["open", "in_progress", "done"] as const;
export const ENTRY_RESULT = ["ok", "remarks", "fault"] as const;
export const ENTRY_SOURCES = ["autotag", "field-app", "import"] as const;

export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];
export type EntryStatus = (typeof ENTRY_STATUS)[number];
export type EntryResult = (typeof ENTRY_RESULT)[number];
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const KIND_LABELS: Record<MaintenanceKind, string> = {
  inspection: "Inspection",
  secondary_injection_test: "Secondary injection test",
  trip_test: "Trip test",
  firmware_update: "Firmware update",
  settings_change: "Settings change",
  fault: "Fault notice",
  repair: "Repair",
  other: "Other",
};
export const STATUS_LABELS: Record<EntryStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
};
export const RESULT_LABELS: Record<EntryResult, string> = {
  ok: "OK",
  remarks: "Remarks",
  fault: "Fault",
};

/** Kinds that restart the periodic maintenance interval when completed. */
export const PERIODIC_KINDS: readonly MaintenanceKind[] = [
  "inspection",
  "secondary_injection_test",
  "trip_test",
];

/** Viewing direction of the device in one panorama (Pannellum convention, degrees). */
export interface Anchor {
  scanPointId: string;
  yaw: number;
  pitch: number;
}

export interface AssetInstance {
  id: string; // permanent, e.g. "DEMO-REL-01"
  assetTypeId: string; // "relay-615" -> asset library
  variant: string; // "REF615" | "RET615" | "REM615" | ... | "unknown" - SOURCE: component list, NOT OCR
  functionalLocation: string;
  serialNo: string | null;
  site: string;
  position: [number, number, number] | null; // world position triangulated from several scan points
  anchors: Anchor[];
  tolDeg: number;
  commissionedAt: string | null; // YYYY-MM-DD
  maintenanceIntervalMonths: number | null;
  demoProfile?: string;
  isDemo: boolean;
}

export interface Attachment {
  name: string;
  url: string;
}

export interface MaintenanceEntry {
  id: string;
  instanceId: string;
  kind: MaintenanceKind;
  status: EntryStatus; // open = notice, done = completed maintenance record
  title: string;
  performedAt: string | null; // YYYY-MM-DD, required when status = done
  performedBy: string;
  company: string | null;
  findings: string;
  actions: string;
  result: EntryResult | null; // required when status = done
  nextDueAt: string | null;
  firmwareBefore: string | null;
  firmwareAfter: string | null;
  workPermitRef: string | null; // work permit / switching programme reference
  attachments: Attachment[];
  source: EntrySource;
  version: number;
  createdAt: string; // ISO timestamp
  updatedAt: string;
}

export type MaintenanceInput = Omit<MaintenanceEntry, "id" | "version" | "createdAt" | "updatedAt">;

// ---------------------------------------------------------------- dates
/** Local calendar date as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Adds calendar months to a YYYY-MM-DD date (clamped to the last day of the month). */
export function addMonths(date: string, months: number): string {
  const [y = 0, m = 1, d = 1] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${ny}-${p(nm)}-${p(Math.min(d, last))}`;
}

// ---------------------------------------------------------------- derived state
/** Newest first: by performed date, then by creation time. */
export function sortEntries(entries: MaintenanceEntry[]): MaintenanceEntry[] {
  const key = (e: MaintenanceEntry) => e.performedAt ?? e.createdAt.slice(0, 10);
  return [...entries].sort(
    (a, b) => key(b).localeCompare(key(a)) || b.createdAt.localeCompare(a.createdAt),
  );
}

/** Default next due date for a completed periodic task. */
export function defaultNextDue(
  input: Pick<MaintenanceInput, "kind" | "status" | "performedAt">,
  intervalMonths: number | null,
): string | null {
  if (input.status !== "done" || !input.performedAt || !intervalMonths) return null;
  return PERIODIC_KINDS.includes(input.kind) ? addMonths(input.performedAt, intervalMonths) : null;
}

export interface DeviceMaintenanceStatus {
  nextDueAt: string | null;
  overdue: boolean;
  openCount: number;
  lastDone: MaintenanceEntry | null;
}

export function deviceStatus(
  instance: AssetInstance,
  entries: MaintenanceEntry[],
  today: string = todayISO(),
): DeviceMaintenanceStatus {
  const own = sortEntries(entries.filter((e) => e.instanceId === instance.id));
  const done = own.filter((e) => e.status === "done");
  const planned = done.find((e) => e.nextDueAt);
  let nextDueAt = planned?.nextDueAt ?? null;
  if (
    !nextDueAt &&
    done.length === 0 &&
    instance.commissionedAt &&
    instance.maintenanceIntervalMonths
  ) {
    nextDueAt = addMonths(instance.commissionedAt, instance.maintenanceIntervalMonths);
  }
  return {
    nextDueAt,
    overdue: nextDueAt !== null && nextDueAt < today,
    openCount: own.filter((e) => e.status !== "done").length,
    lastDone: done[0] ?? null,
  };
}
