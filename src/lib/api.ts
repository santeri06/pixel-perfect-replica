import Fuse from "fuse.js";
import { assetLibrary, type AssetType } from "@/data/assets";
import { cvDetections, type Detection } from "@/data/detections";
import library from "@/data/asset_library.json";
import panoramas from "@/data/panoramas.json";

/**
 * Detections for a site: the output of the CV pipeline (cv/outputs/detections.json).
 * For live data, fetch GET /api/detections from cv/api.py instead.
 */
export async function getDetections(siteId: string): Promise<Detection[]> {
  void siteId;
  await new Promise((r) => setTimeout(r, 400));
  return cvDetections.map((d) => ({ ...d }));
}

/** Scan points of the site, each with its equirectangular panorama. */
export const scanPoints = panoramas.map((p) => ({
  id: p.scanPointId,
  panorama: `/panoramas/${p.equirectangular}`,
}));

export async function getAssetLibrary(): Promise<AssetType[]> {
  return assetLibrary;
}

const fuse = new Fuse(
  assetLibrary.flatMap((a) => a.identifiers.map((identifier) => ({ identifier, asset: a }))),
  { keys: ["identifier"], threshold: 0.45, includeScore: true },
);

/** Fuzzy-match OCR text against asset library identifiers. */
export function matchAsset(ocrText: string): { asset: AssetType; score: number; identifier: string } | null {
  const r = fuse.search(ocrText)[0];
  if (!r) return null;
  return { asset: r.item.asset, identifier: r.item.identifier, score: 1 - (r.score ?? 1) };
}

export function getAssetById(id: string) {
  return assetLibrary.find((a) => a.id === id);
}

export type LibraryAssetType = (typeof library.assetTypes)[number];
export type LibraryInstance = (typeof library.instances)[number];

/** Resolve a detection's assetTypeId + instanceId against asset_library.json. */
export function lookupLibrary(assetTypeId: string, instanceId?: string): { type: LibraryAssetType | undefined; instance: LibraryInstance | undefined } {
  return {
    type: library.assetTypes.find((t) => t.assetTypeId === assetTypeId),
    instance: instanceId ? library.instances.find((i) => i.instanceId === instanceId) : undefined,
  };
}
