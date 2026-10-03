/**
 * DEMO device registry (stand-in for the customer's component list).
 * Generated from the CV detections by scripts/build-registry.mjs - rerun it when
 * src/data/detections.json changes: `node scripts/build-registry.mjs`.
 */
import raw from "./registry.generated.json";
import panoramas from "./panoramas.json";
import type { AssetInstance, MaintenanceEntry } from "./maintenance";

export interface RegistryFile {
  schema: 1;
  sourceDetectionsSha1: string;
  params: { tolDeg: number; maxInstances: number };
  stats: Record<string, number>;
  instances: AssetInstance[];
  seedVersion: string;
  seedEntries: MaintenanceEntry[];
}

export const registry = raw as unknown as RegistryFile;
export const instances: AssetInstance[] = registry.instances;

/** World position of every scan point (camera centre), from the panorama index. */
export const scanPositions: Record<string, [number, number, number]> = Object.fromEntries(
  panoramas.map((p) => [p.scanPointId, p.position as [number, number, number]]),
);

export function getInstance(id: string | undefined): AssetInstance | undefined {
  return id ? instances.find((i) => i.id === id) : undefined;
}
