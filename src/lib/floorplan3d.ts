/**
 * 3D room layout for the floor plan (src/data/floorplan3d.json, written by
 * cv/floorplan/build_layout3d.py from the point cloud occupancy grid).
 * Optional like floorplan.json: a missing file gives `layout3d = null` and the page shows the 2D map.
 */

export type Ring = [number, number][];

export interface Poly {
  outer: Ring;
  holes: Ring[];
}

export type SolidKind = "wall" | "equipment" | "low";

export interface Solid extends Poly {
  kind: SolidKind;
  height: number; // metres above the floor
  inferred?: boolean; // body behind scanned fronts (the scanner sees fronts, not tops)
}

export interface Layout3D {
  version: 1;
  frame: string;
  floorZ: number;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  source: { source: string; cell: number; points?: number };
  wallHeight: number;
  floor: Poly[];
  unscanned: Poly[];
  solids: Solid[];
  devices: Record<string, { facing: [number, number]; top: number | null }>;
}

const mods = import.meta.glob("../data/floorplan3d.json", { eager: true, import: "default" });
export const layout3d: Layout3D | null = (Object.values(mods)[0] as Layout3D | undefined) ?? null;

/** Bounding box of all floor polygons (falls back to the layout bounds). */
export function floorExtent(l: Pick<Layout3D, "floor" | "bounds">) {
  const pts = l.floor.flatMap((p) => p.outer);
  if (!pts.length) return l.bounds;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

/**
 * Where a relay's number badge floats: above the cabinet it is mounted on, pulled slightly out of
 * the cabinet front (along `facing`). Stacked relays (same x/y) are spread sideways so both badges
 * stay readable and clickable.
 */
export function badgeAnchor(
  d: { x: number; y: number; z: number },
  info: { facing: [number, number]; top: number | null } | undefined,
  floorZ: number,
  stackIndex = 0,
  stackSize = 1,
): [number, number, number] {
  const [fx, fy] = info?.facing ?? [0, 0];
  const top = Math.max(info?.top ?? 0, d.z - floorZ);
  const side = (stackIndex - (stackSize - 1) / 2) * 0.34;
  // tangent = facing rotated 90 degrees
  return [d.x + fx * 0.25 - fy * side, d.y + fy * 0.25 + fx * side, top + 0.55];
}
