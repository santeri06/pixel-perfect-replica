import { describe, expect, it } from "vitest";
import {
  approximateLayout,
  floorPlan,
  groupStacked,
  pxToWorld,
  worldToPx,
  type FloorDevice,
} from "@/lib/floorplan";
import { liveDevices, liveStatus, majorityInstance, summarize } from "@/lib/floorplanStatus";
import type { Detection } from "@/data/detections";
import type { AssetInstance, MaintenanceEntry } from "@/data/maintenance";
import detectionsRaw from "@/data/detections.json";
import panoramas from "@/data/panoramas.json";

const frame = {
  bounds: { xMin: -9.3, xMax: 0.7, yMin: -9.1, yMax: 0.6 },
  metersPerPixel: 10 / 1600,
};
const widthPx = 1600;
const heightPx = (frame.bounds.yMax - frame.bounds.yMin) / frame.metersPerPixel;

const det = (
  id: string,
  status: Detection["status"],
  extra: Partial<Detection> = {},
): Detection => ({
  id,
  status,
  assetTypeId: "relay-615",
  label: "",
  confidence: status === "auto" ? 0.9 : 0.6,
  pitch: 0,
  yaw: 0,
  position: "",
  ...extra,
});

const device = (
  id: string,
  x: number,
  y: number,
  z: number,
  detectionIds: string[] = [],
): FloorDevice => ({
  id,
  x,
  y,
  z,
  assetTypeId: "relay-615",
  status: "auto",
  detectionIds,
  scanPointIds: [],
  bestDetectionId: detectionIds[0] ?? "",
  method: "raycast",
  positionSpread: 0.02,
  confidenceMax: 0.9,
});

describe("floor plan coordinates", () => {
  it("worldToPx and pxToWorld are inverse (error < 1e-6)", () => {
    for (const p of [
      { x: -5.72, y: -3.78 },
      { x: 0, y: 0 },
      { x: -9.3, y: 0.6 },
      { x: 0.5, y: -9 },
    ]) {
      const back = pxToWorld(frame, worldToPx(frame, p));
      expect(Math.abs(back.x - p.x)).toBeLessThan(1e-6);
      expect(Math.abs(back.y - p.y)).toBeLessThan(1e-6);
    }
  });

  it("puts the bounds corners on the image edges", () => {
    const { xMin, xMax, yMin, yMax } = frame.bounds;
    expect(worldToPx(frame, { x: xMin, y: yMax })).toEqual({ px: 0, py: 0 });
    const br = worldToPx(frame, { x: xMax, y: yMin });
    expect(br.px).toBeCloseTo(widthPx, 6);
    expect(br.py).toBeCloseTo(heightPx, 6);
  });

  it("draws +Y (yaw 0) upwards: py decreases as y grows", () => {
    expect(worldToPx(frame, { x: -3, y: -1 }).py).toBeLessThan(
      worldToPx(frame, { x: -3, y: -2 }).py,
    );
    expect(worldToPx(frame, { x: -2, y: -1 }).px).toBeGreaterThan(
      worldToPx(frame, { x: -3, y: -1 }).px,
    );
  });
});

describe("live device status", () => {
  it("hides a device whose detections are all rejected", () => {
    expect(liveStatus([det("a", "rejected"), det("b", "rejected")])).toBeNull();
  });
  it("one confirmed member makes it confirmed", () => {
    expect(liveStatus([det("a", "review"), det("b", "confirmed"), det("c", "rejected")])).toBe(
      "confirmed",
    );
  });
  it("auto + review -> auto", () => {
    expect(liveStatus([det("a", "review"), det("b", "auto")])).toBe("auto");
  });
  it("only review -> review", () => {
    expect(liveStatus([det("a", "review"), det("b", "rejected")])).toBe("review");
  });
  it("keeps the build-time status when the store has none of its detections (stale data)", () => {
    expect(liveStatus([], "auto")).toBe("auto");
  });

  it("picks the majority register device and reflects overdue maintenance + rejections", () => {
    expect(
      majorityInstance([{ instanceId: "A" }, { instanceId: "B" }, { instanceId: "B" }, {}]),
    ).toBe("B");
    const inst = {
      id: "R1",
      commissionedAt: "2020-01-01",
      maintenanceIntervalMonths: 12,
    } as AssetInstance;
    const dets = [
      det("d1", "auto", { instanceId: "R1" }),
      det("d2", "review", { instanceId: "R1" }),
      det("d3", "rejected"),
    ];
    const devices = [
      device("dev-01", 0, 0, 1.8, ["d1", "d2"]),
      device("dev-02", 1, 0, 1.8, ["d3"]),
    ];
    const live = liveDevices(devices, dets, [inst], [] as MaintenanceEntry[], "2026-10-03");
    expect(live.map((d) => d.device.id)).toEqual(["dev-01"]);
    expect(live[0]!.instance?.id).toBe("R1");
    expect(live[0]!.overdue).toBe(true);
    const done = {
      instanceId: "R1",
      status: "done",
      performedAt: "2026-10-03",
      nextDueAt: "2027-10-03",
      createdAt: "2026-10-03T10:00:00Z",
    } as MaintenanceEntry;
    expect(liveDevices(devices, dets, [inst], [done], "2026-10-03")[0]!.overdue).toBe(false);
    expect(summarize(live)).toMatchObject({
      relays: 1,
      auto: 1,
      review: 0,
      overdue: 1,
      detections: 2,
    });
  });

  it("gives a register device to only one of two stacked relays (the one closest to its position)", () => {
    const inst = {
      id: "R5",
      position: [-2.75, -5.93, 1.43],
      commissionedAt: null,
      maintenanceIntervalMonths: null,
    } as AssetInstance;
    const dets = [det("lo", "auto", { instanceId: "R5" }), det("hi", "auto", { instanceId: "R5" })];
    const live = liveDevices(
      [device("upper", -2.74, -5.93, 1.73, ["hi"]), device("lower", -2.75, -5.93, 1.43, ["lo"])],
      dets,
      [inst],
      [],
    );
    expect(live.find((d) => d.device.id === "lower")!.instance?.id).toBe("R5");
    expect(live.find((d) => d.device.id === "upper")!.instance).toBeUndefined();
  });
});

describe("groupStacked", () => {
  it("stacks devices closer than 0.25 m in x/y, highest first", () => {
    const g = groupStacked(
      [device("low", -2.75, -5.93, 1.43), device("high", -2.74, -5.9, 1.73)],
      0.25,
    );
    expect(g).toHaveLength(1);
    expect(g[0]!.map((d) => d.id)).toEqual(["high", "low"]);
  });
  it("keeps devices 1 m apart separate", () => {
    expect(
      groupStacked([device("a", -5.72, -3.78, 1.84), device("b", -5.72, -2.78, 1.84)], 0.25),
    ).toHaveLength(2);
  });
});

describe("approximate layout (no floorplan.json)", () => {
  it("contains every scan point inside the image", () => {
    const plan = approximateLayout(panoramas, [{ id: "R", position: [-5.72, -3.78, 1.84] }])!;
    for (const s of plan.scanPoints) {
      const p = worldToPx(plan, s);
      expect(p.px).toBeGreaterThan(0);
      expect(p.px).toBeLessThan(plan.widthPx);
      expect(p.py).toBeGreaterThan(0);
      expect(p.py).toBeLessThan(plan.heightPx);
    }
  });
});

const STALE = "detections.json changed – rerun cv/floorplan/build_floorplan.py";

describe.skipIf(!floorPlan)("src/data/floorplan.json", () => {
  const fp = floorPlan!;
  const detIds = new Set((detectionsRaw as { id: string }[]).map((d) => d.id));

  it("every detectionIds reference exists in detections.json", () => {
    const missing = fp.devices.flatMap((d) => d.detectionIds).filter((id) => !detIds.has(id));
    expect(missing, STALE).toEqual([]);
  });
  it("every scan point exists in panoramas.json", () => {
    const ids = new Set(panoramas.map((p) => p.scanPointId));
    expect(fp.scanPoints.filter((s) => !ids.has(s.id))).toEqual([]);
  });
  it("device ids are unique", () => {
    const ids = fp.devices.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("every detection is in exactly one device or in unlocated", () => {
    const seen = new Map<string, number>();
    for (const id of [
      ...fp.devices.flatMap((d) => d.detectionIds),
      ...fp.unlocated.map((u) => u.detectionId),
    ])
      seen.set(id, (seen.get(id) ?? 0) + 1);
    expect(
      [...seen].filter(([, n]) => n !== 1),
      "a detection is listed twice",
    ).toEqual([]);
    expect(
      [...detIds].filter((id) => !seen.has(id)),
      STALE,
    ).toEqual([]);
  });
});
