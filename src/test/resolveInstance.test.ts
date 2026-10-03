import { describe, expect, it } from "vitest";
import type { Anchor, AssetInstance } from "@/data/maintenance";
import { angularDistDeg, resolveInstance, viewDirection } from "@/lib/resolveInstance";

const inst = (
  id: string,
  anchors: Anchor[],
  position: [number, number, number] | null = null,
  tolDeg = 3,
): AssetInstance => ({
  id,
  assetTypeId: "relay-615",
  variant: "REF615",
  functionalLocation: id,
  serialNo: null,
  site: "test",
  position,
  anchors,
  tolDeg,
  commissionedAt: null,
  maintenanceIntervalMonths: 12,
  isDemo: true,
});

const scans: Record<string, [number, number, number]> = {
  "scan-a": [0, 0, 1.5],
  "scan-b": [2, 0, 1.5],
};
const linkedId = (r: ReturnType<typeof resolveInstance>) =>
  r.status === "linked" ? r.instance.id : r.status;

describe("angularDistDeg / viewDirection", () => {
  it("handles the ±180° yaw wrap", () => {
    expect(
      Math.abs(angularDistDeg({ yaw: 179, pitch: 0 }, { yaw: -179, pitch: 0 }) - 2) < 1e-9,
    ).toBe(true);
  });

  it("uses the Pannellum convention: yaw 0 = +Y, positive to the right (+X), pitch up", () => {
    const right = viewDirection([0, 0, 0], [1, 0, 0]);
    expect(Math.round(right.yaw)).toBe(90);
    expect(Math.round(right.pitch)).toBe(0);
    expect(Math.round(viewDirection([0, 0, 0], [0, 0, 2]).pitch)).toBe(90);
  });
});

describe("resolveInstance", () => {
  const a = inst("A", [{ scanPointId: "scan-a", yaw: 10, pitch: 20 }]);

  it("links an exact anchor hit", () => {
    expect(
      linkedId(resolveInstance({ scanPointId: "scan-a", yaw: 10, pitch: 20 }, [a], scans)),
    ).toBe("A");
  });

  it("respects the tolerance boundary", () => {
    expect(
      linkedId(resolveInstance({ scanPointId: "scan-a", yaw: 12.9, pitch: 20 }, [a], scans)),
    ).toBe("A");
    expect(
      linkedId(resolveInstance({ scanPointId: "scan-a", yaw: 14, pitch: 20 }, [a], scans)),
    ).toBe("none");
  });

  it("links across the yaw wrap (179° vs −179°)", () => {
    const w = inst("W", [{ scanPointId: "scan-a", yaw: 179, pitch: 0 }]);
    expect(
      linkedId(resolveInstance({ scanPointId: "scan-a", yaw: -179, pitch: 0 }, [w], scans)),
    ).toBe("W");
  });

  it("does not link an anchor of another panorama", () => {
    expect(
      linkedId(resolveInstance({ scanPointId: "scan-b", yaw: 10, pitch: 20 }, [a], scans)),
    ).toBe("none");
  });

  it("never links a detection without a scan point (uploaded panorama)", () => {
    expect(linkedId(resolveInstance({ yaw: 10, pitch: 20 }, [a], scans))).toBe("none");
  });

  it("links a new scan point through the triangulated 3D position", () => {
    // device at (0, 2, 1.5): seen from scan-b (2, 0, 1.5) at yaw -45°, pitch 0 - no anchor for scan-b
    const p = inst("P", [{ scanPointId: "scan-a", yaw: 0, pitch: 0 }], [0, 2, 1.5]);
    expect(
      linkedId(resolveInstance({ scanPointId: "scan-b", yaw: -44, pitch: 1 }, [p], scans)),
    ).toBe("P");
  });

  it("maps two overlapping-view detections of one relay to the same device", () => {
    const r1 = resolveInstance({ scanPointId: "scan-a", yaw: 10.8, pitch: 19.5 }, [a], scans);
    const r2 = resolveInstance({ scanPointId: "scan-a", yaw: 9.1, pitch: 20.6 }, [a], scans);
    expect(linkedId(r1)).toBe("A");
    expect(linkedId(r2)).toBe("A");
  });

  it("reports two equally close devices as ambiguous instead of guessing", () => {
    const b = inst("B", [{ scanPointId: "scan-a", yaw: 11, pitch: 20 }]);
    expect(
      resolveInstance({ scanPointId: "scan-a", yaw: 10.5, pitch: 20 }, [a, b], scans).status,
    ).toBe("ambiguous");
    expect(
      linkedId(resolveInstance({ scanPointId: "scan-a", yaw: 13.5, pitch: 20 }, [a, b], scans)),
    ).toBe("B");
  });
});
