// Types for scripts/build-registry.mjs (imported by src/test/registry.test.ts).
import type { AssetInstance, MaintenanceEntry } from "../src/data/maintenance";

export const AUTO_TAG_CONFIDENCE: number;
export const DEFAULTS: {
  maxInstances: number;
  tolDeg: number;
  gapM: number;
  minRangeM: number;
  maxRangeM: number;
  minRayAngleDeg: number;
  supportDeg: number;
  matchExistingM: number;
};

export interface CvDetectionRow {
  id: string;
  scanPointId: string | null;
  assetTypeId?: string | null;
  confidence: number;
  yaw: number | null;
  pitch: number | null;
  status?: string;
}

export interface GeneratedRegistry {
  schema: 1;
  sourceDetectionsSha1: string;
  params: { tolDeg: number; maxInstances: number };
  stats: Record<string, number>;
  instances: AssetInstance[];
  seedVersion: string;
  seedEntries: MaintenanceEntry[];
}

export function clusterDetections(
  detections: CvDetectionRow[],
  scanPositions: Record<string, number[]>,
  opts?: typeof DEFAULTS,
): { position: number[] | null; members: CvDetectionRow[] }[];

export function buildRegistry(
  detections: CvDetectionRow[],
  panoramas: { scanPointId: string; position: number[] }[],
  previous?: GeneratedRegistry | null,
  opts?: typeof DEFAULTS,
): { registry: GeneratedRegistry; log: string[] };
