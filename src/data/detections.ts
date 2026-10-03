import raw from "./detections.json";

export interface Detection {
  id: string;
  assetTypeId: string;
  label: string; // OCR text
  confidence: number;
  pitch: number;
  yaw: number;
  status: "auto" | "confirmed" | "rejected";
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

export const cvDetections: Detection[] = (raw as CvDetection[]).map((d) => ({
  id: d.id,
  assetTypeId: d.assetTypeId ?? "relay-615",
  label: d.ocrText,
  confidence: d.confidence,
  pitch: d.pitch ?? 0,
  yaw: d.yaw ?? 0,
  status: "auto",
  position: d.scanPointId ? `Scan point ${d.scanPointId.replace("scan-", "")}` : "",
  ...(d.scanPointId ? { scanPointId: d.scanPointId } : {}),
}));

export const maintenanceHistory = [
  { date: "2026-06-12", title: "Annual inspection", note: "Thermal scan OK, firmware updated to 5.1." },
  { date: "2025-11-03", title: "Trip test", note: "Secondary injection test passed." },
  { date: "2024-09-21", title: "Installation", note: "Commissioned by field service team." },
];
