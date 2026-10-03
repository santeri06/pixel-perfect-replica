import { describe, expect, it } from "vitest";
import {
  asRect,
  badgeAnchor,
  cabinetParts,
  floorExtent,
  layout3d,
  type Part,
} from "@/lib/floorplan3d";
import { floorPlan } from "@/lib/floorplan";

describe("3D floor plan", () => {
  it("puts the badge above the cabinet, pulled out of the front", () => {
    const [x, y, h] = badgeAnchor({ x: 1, y: 2, z: 1.8 }, { facing: [1, 0], top: 2.2 }, 0);
    expect(x).toBeCloseTo(1.25);
    expect(y).toBeCloseTo(2);
    expect(h).toBeCloseTo(2.75);
  });

  it("spreads stacked relays sideways (perpendicular to the facing)", () => {
    const a = badgeAnchor({ x: 0, y: 0, z: 1.7 }, { facing: [1, 0], top: 2 }, 0, 0, 2);
    const b = badgeAnchor({ x: 0, y: 0, z: 1.4 }, { facing: [1, 0], top: 2 }, 0, 1, 2);
    expect(a[0]).toBeCloseTo(b[0]);
    expect(Math.abs(a[1] - b[1])).toBeGreaterThan(0.3);
  });

  it("uses the floor polygons for the extent", () => {
    const e = floorExtent({
      floor: [{ outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [] }],
      bounds: { xMin: -9, xMax: 9, yMin: -9, yMax: 9 },
    });
    expect(e).toEqual({ xMin: 0, xMax: 4, yMin: 0, yMax: 3 });
  });

  it("recognises axis-aligned rectangles only", () => {
    expect(asRect([[0, 0], [2, 0], [2, 1], [0, 1]])).toEqual({ xa: 0, ya: 0, xb: 2, yb: 1 });
    expect(asRect([[0, 0], [2, 0.1], [2, 1], [0, 1]])).toBeNull();
    expect(asRect([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]])).toBeNull();
  });

  it("builds a cabinet panel inside its footprint with doors on the front", () => {
    // panel 1 m wide (y), 0.8 m deep (x), front facing -x at x = 0
    const parts = cabinetParts({
      outer: [[0, 0], [0.8, 0], [0.8, 1], [0, 1]],
      height: 2.2,
      front: [-1, 0],
    });
    const kinds = parts.map((p) => p.kind);
    expect(kinds.filter((k) => k === "door")).toHaveLength(2);
    expect(kinds).toContain("plinth");
    const body = parts.find((p) => p.kind === "body")!;
    expect(body.xa).toBeCloseTo(0);
    expect(body.xb).toBeCloseTo(0.8);
    expect(body.ya).toBeGreaterThan(0); // seam to the next panel
    expect(body.yb).toBeLessThan(1);
    expect(body.z1).toBeCloseTo(2.2);
    const doors = parts.filter((p): p is Part => p.kind === "door");
    for (const d of doors) {
      expect(d.xb).toBeCloseTo(0); // on the front face ...
      expect(d.xa).toBeLessThan(0); // ... standing out of it
      expect(d.ya).toBeGreaterThan(body.ya);
      expect(d.yb).toBeLessThan(body.yb);
      expect(d.z1).toBeLessThanOrEqual(2.2);
    }
    expect(doors[0]!.z1).toBeLessThan(doors[1]!.z0); // lower door, upper LV door
  });

  it.runIf(layout3d && floorPlan)("matches floorplan.json (rerun build_layout3d.py if not)", () => {
    const l = layout3d!;
    const ids = new Set(floorPlan!.devices.map((d) => d.id));
    expect(Object.keys(l.devices).sort()).toEqual([...ids].sort());
    expect(l.floor.length).toBeGreaterThan(0);
    for (const s of l.solids) {
      expect(s.outer.length).toBeGreaterThanOrEqual(3);
      expect(s.height).toBeGreaterThan(0);
      expect(s.height).toBeLessThanOrEqual(l.wallHeight);
      if (s.kind === "cabinet") {
        expect(asRect(s.outer)).not.toBeNull();
        expect(s.front).toBeDefined();
      }
    }
    // every relay on a cabinet row sits on the face of one of its panels
    for (const [id, info] of Object.entries(l.devices)) {
      if (!info.front) continue;
      const onPanel = l.solids.some((s) => {
        const r = s.kind === "cabinet" ? asRect(s.outer) : null;
        if (!r) return false;
        const [x, y] = info.front!;
        return x >= r.xa - 0.01 && x <= r.xb + 0.01 && y >= r.ya - 0.01 && y <= r.yb + 0.01;
      });
      expect(onPanel, id).toBe(true);
    }
  });
});
