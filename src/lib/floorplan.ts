/**
 * Floor plan data (src/data/floorplan.json, written by cv/floorplan/build_floorplan.py).
 *
 * The file may be missing (not generated yet, or rejected by a quality gate), so it is loaded with
 * import.meta.glob: a missing file gives `floorPlan = null` instead of a build error.
 * Positions are measured from the point cloud; nothing here is hand-written.
 */

export type DeviceStatus = "auto" | "review";

export interface FloorDevice {
  id: string;
  x: number;
  y: number;
  z: number;
  assetTypeId: string;
  status: DeviceStatus; // offline status at build time; the page recomputes it live (floorplanStatus.ts)
  detectionIds: string[];
  scanPointIds: string[];
  bestDetectionId: string;
  method: "raycast" | "triangulation";
  positionSpread: number;
  confidenceMax: number;
}

export interface Unlocated {
  detectionId: string;
  scanPointId: string | null;
  reason: string;
}

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface FloorPlan {
  version: 1;
  generatedAt: string;
  source: { e57: string; detectionsSha1: string; voxel: number; rayVoxel?: number };
  frame: string;
  image: string | null; // null = approximate layout without a point cloud image
  widthPx: number;
  heightPx: number;
  bounds: Bounds;
  metersPerPixel: number;
  floorZ: number;
  scanPoints: { id: string; x: number; y: number }[];
  devices: FloorDevice[];
  unlocated: Unlocated[];
  stats: Record<string, number | null>;
}

const mods = import.meta.glob("../data/floorplan.json", { eager: true, import: "default" });
export const floorPlan: FloorPlan | null =
  (Object.values(mods)[0] as FloorPlan | undefined) ?? null;

type Frame = Pick<FloorPlan, "bounds" | "metersPerPixel">;

/** World (x, y) in metres -> image pixel. +Y (yaw 0) points up on the map. */
export function worldToPx(fp: Frame, p: { x: number; y: number }): { px: number; py: number } {
  return {
    px: (p.x - fp.bounds.xMin) / fp.metersPerPixel,
    py: (fp.bounds.yMax - p.y) / fp.metersPerPixel,
  };
}

export function pxToWorld(fp: Frame, p: { px: number; py: number }): { x: number; y: number } {
  return {
    x: fp.bounds.xMin + p.px * fp.metersPerPixel,
    y: fp.bounds.yMax - p.py * fp.metersPerPixel,
  };
}

/**
 * Devices closer than `tolM` in x/y share one spot on the map (e.g. two relays mounted one above the
 * other). Returns stacks, each sorted top (highest z) first.
 */
export function groupStacked<T extends { x: number; y: number; z: number }>(
  devices: T[],
  tolM = 0.25,
): T[][] {
  const parent = devices.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < devices.length; i++) {
    for (let j = i + 1; j < devices.length; j++) {
      const a = devices[i]!;
      const b = devices[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < tolM) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, T[]>();
  devices.forEach((d, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), d]);
  });
  return [...groups.values()].map((g) => g.sort((a, b) => b.z - a.z));
}

/**
 * Fallback when floorplan.json is missing: scan points and the registered relays (positions
 * triangulated by scripts/build-registry.mjs) on a metre grid. No image, clearly labelled as approximate.
 */
export function approximateLayout(
  scanPoints: { scanPointId: string; position: number[] }[],
  relays: { id: string; position: [number, number, number] | null }[],
  widthPx = 1000,
): FloorPlan | null {
  const pts = [
    ...scanPoints.map((s) => ({ x: s.position[0]!, y: s.position[1]! })),
    ...relays.flatMap((r) => (r.position ? [{ x: r.position[0], y: r.position[1] }] : [])),
  ];
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const bounds = {
    xMin: Math.floor(Math.min(...xs)) - 1,
    xMax: Math.ceil(Math.max(...xs)) + 1,
    yMin: Math.floor(Math.min(...ys)) - 1,
    yMax: Math.ceil(Math.max(...ys)) + 1,
  };
  const mpp = (bounds.xMax - bounds.xMin) / widthPx;
  return {
    version: 1,
    generatedAt: "",
    source: { e57: "", detectionsSha1: "", voxel: 0 },
    frame: "panoramas.json world frame (z up, metres)",
    image: null,
    widthPx,
    heightPx: Math.round((bounds.yMax - bounds.yMin) / mpp),
    bounds,
    metersPerPixel: mpp,
    floorZ: 0,
    scanPoints: scanPoints.map((s) => ({
      id: s.scanPointId,
      x: s.position[0]!,
      y: s.position[1]!,
    })),
    devices: [],
    unlocated: [],
    stats: {},
  };
}
