/**
 * Live state of the floor plan devices, computed from the store detections so that Review Queue
 * decisions and Field App maintenance entries show up immediately. Pure functions (tested).
 */
import { AUTO_TAG_CONFIDENCE, type Detection } from "@/data/detections";
import { deviceStatus, type AssetInstance, type MaintenanceEntry } from "@/data/maintenance";
import type { FloorDevice } from "@/lib/floorplan";

export type LiveStatus = "auto" | "review" | "confirmed";

export interface LiveDevice {
  device: FloorDevice;
  status: LiveStatus;
  members: Detection[]; // non-rejected detections of the device
  instance: AssetInstance | undefined;
  overdue: boolean;
  openCount: number;
  nextDueAt: string | null;
}

/**
 * All members rejected -> hidden (null). Any confirmed -> confirmed. Else any auto -> auto. Else review.
 * A device whose detections are not in the store (stale floorplan.json) keeps its build-time status.
 */
export function liveStatus(
  members: Pick<Detection, "status">[],
  fallback: LiveStatus = "review",
): LiveStatus | null {
  if (!members.length) return fallback;
  const active = members.filter((d) => d.status !== "rejected");
  if (!active.length) return null;
  if (active.some((d) => d.status === "confirmed")) return "confirmed";
  if (active.some((d) => d.status === "auto")) return "auto";
  return "review";
}

/** Register device of the floor plan device: majority of the members' instanceId (set by the store). */
export function majorityInstance(members: Pick<Detection, "instanceId">[]): string | undefined {
  const n = new Map<string, number>();
  for (const d of members) if (d.instanceId) n.set(d.instanceId, (n.get(d.instanceId) ?? 0) + 1);
  let best: string | undefined;
  for (const [id, c] of n) if (best === undefined || c > n.get(best)!) best = id;
  return best;
}

export function liveDevices(
  devices: FloorDevice[],
  detections: Detection[],
  instances: AssetInstance[],
  entries: MaintenanceEntry[],
  today?: string,
): LiveDevice[] {
  const byId = new Map(detections.map((d) => [d.id, d]));
  const rows = devices.flatMap((device) => {
    const all = device.detectionIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    const status = liveStatus(all, device.status);
    if (status === null) return [];
    const members = all.filter((d) => d.status !== "rejected");
    const instanceId = majorityInstance(members);
    return [
      {
        device,
        status,
        members,
        instance: instanceId ? instances.find((i) => i.id === instanceId) : undefined,
      },
    ];
  });
  // One register device per floor plan device. The angular link (resolveInstance, 5 deg) can give two
  // relays mounted 0.3 m apart the same register device; keep it on the device closest to its position.
  const owner = new Map<string, (typeof rows)[number]>();
  const dist = (r: (typeof rows)[number]) => {
    const p = r.instance?.position;
    return p
      ? Math.hypot(r.device.x - p[0], r.device.y - p[1], r.device.z - p[2])
      : -r.members.length;
  };
  for (const r of rows) {
    if (!r.instance) continue;
    const cur = owner.get(r.instance.id);
    if (!cur || dist(r) < dist(cur)) owner.set(r.instance.id, r);
  }
  const out: LiveDevice[] = [];
  for (const { device, status, members, instance: claimed } of rows) {
    const instance = claimed && owner.get(claimed.id)?.device === device ? claimed : undefined;
    const m = instance ? deviceStatus(instance, entries, today) : null;
    out.push({
      device,
      status,
      members,
      instance,
      overdue: m?.overdue ?? false,
      openCount: m?.openCount ?? 0,
      nextDueAt: m?.nextDueAt ?? null,
    });
  }
  return out;
}

/** Detection the side panel opens for a device: highest-confidence member that is not rejected. */
export function panelDetection(live: LiveDevice): Detection | undefined {
  const best = live.members.find((d) => d.id === live.device.bestDetectionId);
  return best ?? [...live.members].sort((a, b) => b.confidence - a.confidence)[0];
}

export function summarize(list: LiveDevice[]) {
  return {
    relays: list.length,
    auto: list.filter((d) => d.status === "auto").length,
    review: list.filter((d) => d.status === "review").length,
    confirmed: list.filter((d) => d.status === "confirmed").length,
    overdue: list.filter((d) => d.overdue).length,
    detections: list.reduce((n, d) => n + d.members.length, 0),
  };
}

/** Tooltip / list name: register location and variant, else a generic relay. */
export function deviceName(d: LiveDevice): string {
  if (!d.instance) return "Unregistered relay · 615 series";
  return `${d.instance.functionalLocation} · ${d.instance.variant === "unknown" ? "615 series" : d.instance.variant}`;
}

export type FloorFilter = "all" | "review" | "overdue";

export function matchesFilter(d: LiveDevice, f: FloorFilter): boolean {
  return f === "all" || (f === "review" ? d.status === "review" : d.overdue);
}

/** Approximate layout: one device per registered relay with a position, members via Detection.instanceId. */
export function registryDevices(
  instances: AssetInstance[],
  detections: Detection[],
): FloorDevice[] {
  return instances.flatMap((inst) => {
    if (!inst.position) return [];
    const members = detections.filter((d) => d.instanceId === inst.id);
    const best = [...members].sort((a, b) => b.confidence - a.confidence)[0];
    if (!best) return [];
    return [
      {
        id: inst.id,
        x: inst.position[0],
        y: inst.position[1],
        z: inst.position[2],
        assetTypeId: inst.assetTypeId,
        status: members.some((d) => d.confidence >= AUTO_TAG_CONFIDENCE) ? "auto" : "review",
        detectionIds: members.map((d) => d.id),
        scanPointIds: [
          ...new Set(members.flatMap((d) => (d.scanPointId ? [d.scanPointId] : []))),
        ].sort(),
        bestDetectionId: best.id,
        method: "triangulation",
        positionSpread: 0,
        confidenceMax: best.confidence,
      } satisfies FloorDevice,
    ];
  });
}
