import raw from "./detections.json";

export interface Detection {
  id: string;
  assetTypeId: string;
  label: string; // OCR text
  confidence: number;
  pitch: number;
  yaw: number;
  status: "auto" | "review" | "confirmed" | "rejected";
  position: string;
  instanceId?: string;
  scanPointId?: string;
}

/** Row format of detections.json, written by cv/infer.py. */
interface CvDetection {
  id: string;
  scanPointId: string | null;
  image: string;
  assetTypeId: string | null;
  ocrText: string;
  confidence: number;
  bbox: number[];
  pitch: number | null;
  yaw: number | null;
}

/** Detections at or above this confidence are tagged automatically; the rest go to the review queue. */
export const AUTO_TAG_CONFIDENCE = 0.75;

export const cvDetections: Detection[] = (raw as CvDetection[]).map((d) => ({
  id: d.id,
  assetTypeId: d.assetTypeId ?? "relay-615",
  label: d.ocrText,
  confidence: d.confidence,
  pitch: d.pitch ?? 0,
  yaw: d.yaw ?? 0,
  status: d.confidence >= AUTO_TAG_CONFIDENCE ? "auto" : "review",
  position: d.scanPointId ? `Scan point ${d.scanPointId.replace("scan-", "")}` : "",
  ...(d.scanPointId ? { scanPointId: d.scanPointId } : {}),
}));
