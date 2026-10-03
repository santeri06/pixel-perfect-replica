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

export type SolidKind = "wall" | "cabinet" | "equipment" | "low";

export interface Solid extends Poly {
  kind: SolidKind;
  height: number; // metres above the floor
  /** cabinet panels: the axis the front (doors, relays) faces */
  front?: [number, number];
  inferred?: boolean; // body behind scanned fronts (the scanner sees fronts, not tops)
}

export interface CabinetRow {
  facing: [number, number];
  front: number;
  from: number;
  to: number;
  depth: number;
  height: number;
  panels: number;
}

export interface Layout3D {
  version: 1;
  frame: string;
  floorZ: number;
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  source: { source: string; cell: number; points?: number };
  wallHeight: number;
  wallThickness?: number;
  grid?: number;
  floor: Poly[];
  unscanned: Poly[];
  rows?: CabinetRow[];
  solids: Solid[];
  devices: Record<
    string,
    { facing: [number, number]; top: number | null; front?: [number, number] }
  >;
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

export interface Rect {
  xa: number;
  ya: number;
  xb: number;
  yb: number;
}

/** The axis-aligned rectangle a ring describes, or null when it is not one. */
export function asRect(ring: Ring): Rect | null {
  if (ring.length !== 4) return null;
  const xs = [...new Set(ring.map((p) => p[0]))];
  const ys = [...new Set(ring.map((p) => p[1]))];
  if (xs.length !== 2 || ys.length !== 2) return null;
  for (let i = 0; i < 4; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % 4]!;
    if (a[0] !== b[0] && a[1] !== b[1]) return null; // diagonal side
  }
  return { xa: Math.min(...xs), ya: Math.min(...ys), xb: Math.max(...xs), yb: Math.max(...ys) };
}

export type PartKind = "plinth" | "body" | "door" | "handle";

/** A box of a cabinet model: footprint (world x/y) and height range above the floor. */
export interface Part extends Rect {
  kind: PartKind;
  z0: number;
  z1: number;
}

const SEAM = 0.008; // half the gap between neighbouring panels
const PLINTH = 0.1;
const DOOR = 0.012; // door leaf thickness in front of the body

/**
 * One switchgear / relay panel as boxes: a recessed plinth, the body, and on the front a lower
 * door and an upper low-voltage door (where protection relays sit) with handles. The panel
 * footprint is the measured one; only the seams between panels are cut out of it.
 */
export function cabinetParts(s: Pick<Solid, "outer" | "height" | "front">): Part[] {
  const r = asRect(s.outer);
  if (!r) return [];
  const [fx, fy] = s.front ?? [0, -1];
  const h = s.height;
  // local frame: along (tangent) and n = depth behind the front face (negative = in front of it)
  const tx = -fy;
  const ty = fx;
  const corners: [number, number][] = [
    [r.xa, r.ya],
    [r.xb, r.yb],
  ];
  const front = Math.max(...corners.map(([x, y]) => x * fx + y * fy));
  const back = Math.min(...corners.map(([x, y]) => x * fx + y * fy));
  const along = corners.map(([x, y]) => x * tx + y * ty);
  const s0 = Math.min(...along);
  const s1 = Math.max(...along);
  const box = (
    kind: PartKind,
    a: number,
    b: number,
    n0: number,
    n1: number,
    z0: number,
    z1: number,
  ): Part => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const sv of [a, b])
      for (const n of [n0, n1]) {
        xs.push(sv * tx + (front - n) * fx);
        ys.push(sv * ty + (front - n) * fy);
      }
    const q = (v: number) => Math.round(v * 1e4) / 1e4;
    return {
      kind,
      xa: q(Math.min(...xs)),
      xb: q(Math.max(...xs)),
      ya: q(Math.min(...ys)),
      yb: q(Math.max(...ys)),
      z0,
      z1,
    };
  };
  const a = s0 + SEAM;
  const b = s1 - SEAM;
  const depth = front - back;
  const parts: Part[] = [
    box("plinth", a, b, 0.04, depth, 0, PLINTH),
    box("body", a, b, 0, depth, PLINTH, h),
  ];
  const inset = Math.min(0.05, (b - a) / 6);
  const top = h - 0.08;
  if (top - (PLINTH + 0.1) < 0.3) return parts;
  const split = h >= 1.9 ? Math.min(1.55, h - 0.6) : null;
  const doors: [number, number][] = split
    ? [
        [PLINTH + 0.08, split - 0.03],
        [split + 0.03, top],
      ]
    : [[PLINTH + 0.08, top]];
  for (const [z0, z1] of doors) {
    parts.push(box("door", a + inset, b - inset, -DOOR, 0, z0, z1));
    // handle near the right edge (seen from the aisle) at a reachable height
    const hz = Math.min(Math.max((z0 + z1) / 2, z0 + 0.1), z1 - 0.1);
    const hs = b - inset - 0.07;
    parts.push(box("handle", hs, hs + 0.03, -DOOR - 0.025, -DOOR, hz - 0.09, hz + 0.09));
  }
  return parts;
}
