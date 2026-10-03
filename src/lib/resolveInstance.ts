import type { AssetInstance } from "@/data/maintenance";

/** Great-circle distance in degrees; handles the ±180° yaw wrap (179° vs −179° = 2°). */
export function angularDistDeg(
  a: { yaw: number; pitch: number },
  b: { yaw: number; pitch: number },
): number {
  const r = Math.PI / 180;
  const c =
    Math.sin(a.pitch * r) * Math.sin(b.pitch * r) +
    Math.cos(a.pitch * r) * Math.cos(b.pitch * r) * Math.cos((a.yaw - b.yaw) * r);
  return Math.acos(Math.min(1, Math.max(-1, c))) / r;
}

/** Yaw/pitch (Pannellum convention: yaw 0 = world +Y, positive right; pitch positive up) and range from → to. */
export function viewDirection(
  from: readonly number[],
  to: readonly number[],
): { yaw: number; pitch: number; range: number } {
  const dx = (to[0] ?? 0) - (from[0] ?? 0);
  const dy = (to[1] ?? 0) - (from[1] ?? 0);
  const dz = (to[2] ?? 0) - (from[2] ?? 0);
  const range = Math.hypot(dx, dy, dz);
  const r = 180 / Math.PI;
  return { yaw: Math.atan2(dx, dy) * r, pitch: Math.asin(range ? dz / range : 0) * r, range };
}

export type Resolution =
  | { status: "linked"; instance: AssetInstance; distDeg: number }
  | { status: "ambiguous"; candidates: AssetInstance[] }
  | { status: "none" };

interface DetectionLike {
  scanPointId?: string | undefined;
  yaw: number;
  pitch: number;
}

const MAX_RANGE_M = 8;

/** Smallest angle between the detection and where the device is expected in that panorama. */
function distanceTo(
  d: DetectionLike & { scanPointId: string },
  inst: AssetInstance,
  scanPositions: Record<string, readonly number[]>,
): number {
  let best = Infinity;
  for (const a of inst.anchors) {
    if (a.scanPointId === d.scanPointId) best = Math.min(best, angularDistDeg(d, a));
  }
  const cam = scanPositions[d.scanPointId];
  if (inst.position && cam) {
    const v = viewDirection(cam, inst.position);
    if (v.range <= MAX_RANGE_M) best = Math.min(best, angularDistDeg(d, v));
  }
  return best;
}

/**
 * Links a detection to a physical device of the register.
 * A detection without a scan point (e.g. an uploaded panorama) is never linked, and two devices
 * within `ambiguityMarginDeg` of each other are reported as ambiguous instead of guessed:
 * a maintenance entry on the wrong relay is worse than no link.
 */
export function resolveInstance(
  d: DetectionLike,
  registry: AssetInstance[],
  scanPositions: Record<string, readonly number[]>,
  ambiguityMarginDeg = 1,
): Resolution {
  const scanPointId = d.scanPointId;
  if (!scanPointId) return { status: "none" };
  const hits = registry
    .map((instance) => ({
      instance,
      distDeg: distanceTo({ ...d, scanPointId }, instance, scanPositions),
    }))
    .filter((h) => h.distDeg <= h.instance.tolDeg)
    .sort((a, b) => a.distDeg - b.distDeg);
  const [first, second] = hits;
  if (!first) return { status: "none" };
  if (second && second.distDeg - first.distDeg < ambiguityMarginDeg) {
    return { status: "ambiguous", candidates: hits.map((h) => h.instance) };
  }
  return { status: "linked", instance: first.instance, distDeg: first.distDeg };
}
