import { describe, expect, it } from "vitest";
import { badgeAnchor, floorExtent, layout3d } from "@/lib/floorplan3d";
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

  it.runIf(layout3d && floorPlan)("matches floorplan.json (rerun build_layout3d.py if not)", () => {
    const l = layout3d!;
    const ids = new Set(floorPlan!.devices.map((d) => d.id));
    expect(Object.keys(l.devices).sort()).toEqual([...ids].sort());
    expect(l.floor.length).toBeGreaterThan(0);
    for (const s of l.solids) {
      expect(s.outer.length).toBeGreaterThanOrEqual(3);
      expect(s.height).toBeGreaterThan(0);
      expect(s.height).toBeLessThanOrEqual(l.wallHeight);
    }
  });
});
