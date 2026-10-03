import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTO_TAG_CONFIDENCE as SCRIPT_THRESHOLD,
  buildRegistry,
  clusterDetections,
  type GeneratedRegistry,
} from "../../scripts/build-registry.mjs";
import { AUTO_TAG_CONFIDENCE, cvDetections } from "@/data/detections";
import { maintenanceEntrySchema } from "@/data/maintenance.schema";
import { instances, registry, scanPositions } from "@/data/registry";
import { resolveInstance } from "@/lib/resolveInstance";
import detectionsRaw from "@/data/detections.json";
import panoramas from "@/data/panoramas.json";

const root = resolve(__dirname, "../..");
const readText = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("demo device registry", () => {
  it("ships the same register to AutoTag and the Field App", () => {
    expect(readText("public/field/registry.json")).toBe(
      readText("src/data/registry.generated.json"),
    );
  });

  it("uses the same auto-tag threshold as the frontend", () => {
    expect(SCRIPT_THRESHOLD).toBe(AUTO_TAG_CONFIDENCE);
  });

  it("has unique, anchored DEMO devices", () => {
    expect(new Set(instances.map((i) => i.id)).size).toBe(instances.length);
    for (const i of instances) {
      expect(i.anchors.length > 0).toBe(true);
      expect(i.tolDeg >= 3).toBe(true);
      expect(i.isDemo).toBe(true);
    }
  });

  it("never registers the same physical relay twice", () => {
    const pos = instances.flatMap((i) => (i.position ? [i.position] : []));
    for (let a = 0; a < pos.length; a++) {
      for (let b = a + 1; b < pos.length; b++) {
        const [p, q] = [pos[a]!, pos[b]!];
        expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 0.5).toBe(true);
      }
    }
  });

  it("has valid demo history on registered devices only", () => {
    const ids = new Set(instances.map((i) => i.id));
    for (const e of registry.seedEntries) {
      expect(maintenanceEntrySchema.safeParse(e).success).toBe(true);
      expect(ids.has(e.instanceId)).toBe(true);
    }
  });

  it("links current auto-tagged detections without ambiguity", () => {
    const autos = cvDetections.filter((d) => d.status === "auto");
    const results = autos.map((d) => resolveInstance(d, instances, scanPositions));
    expect(results.some((r) => r.status === "ambiguous")).toBe(false);
    const linkedDevices = new Set(
      results.flatMap((r) => (r.status === "linked" ? [r.instance.id] : [])),
    );
    expect(linkedDevices.size >= Math.min(3, instances.length)).toBe(true);
  });

  it("keeps device IDs stable when the generator is run again", () => {
    const prev = registry as unknown as GeneratedRegistry;
    const { registry: next } = buildRegistry(detectionsRaw, panoramas, prev);
    expect(next.instances.map((i) => `${i.id}:${i.variant}`)).toEqual(
      prev.instances.map((i) => `${i.id}:${i.variant}`),
    );
    const sha = createHash("sha1").update(JSON.stringify(detectionsRaw)).digest("hex").slice(0, 12);
    if (sha !== registry.sourceDetectionsSha1) {
      console.warn(
        "detections.json changed since the registry was generated - run: node scripts/build-registry.mjs",
      );
    }
  });

  it("triangulates one device seen from two scan points into one cluster", () => {
    // device at (0, 2, 2); cameras at (0,0,1.5) and (2,0,1.5)
    const dir = (from: number[], to: number[]) => {
      const [dx, dy, dz] = [to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!];
      const r = Math.hypot(dx, dy, dz);
      return {
        yaw: (Math.atan2(dx, dy) * 180) / Math.PI,
        pitch: (Math.asin(dz / r) * 180) / Math.PI,
      };
    };
    const cams = { a: [0, 0, 1.5], b: [2, 0, 1.5] };
    const dets = [
      { id: "1", scanPointId: "a", confidence: 0.9, ...dir(cams.a, [0, 2, 2]) },
      { id: "2", scanPointId: "b", confidence: 0.4, ...dir(cams.b, [0, 2, 2]) },
      { id: "3", scanPointId: "b", confidence: 0.9, ...dir(cams.b, [3, 2, 1]) },
    ];
    const clusters = clusterDetections(dets, cams);
    const multi = clusters.filter((c) => c.position);
    expect(multi).toHaveLength(1);
    expect(multi[0]!.members.map((m) => m.id).sort()).toEqual(["1", "2"]);
    const p = multi[0]!.position!;
    expect(Math.hypot(p[0]! - 0, p[1]! - 2, p[2]! - 2) < 0.01).toBe(true);
  });
});
