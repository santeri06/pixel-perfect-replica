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
}

export const mockDetections: Detection[] = [
  { id: "d1", assetTypeId: "relay-615", label: "REF615", confidence: 0.94, pitch: 26, yaw: 15, status: "auto", position: "SWG-04 / Panel 1", instanceId: "J03-REL-01" },
  { id: "d2", assetTypeId: "breaker-emax", label: "EMAX2 E2.2", confidence: 0.88, pitch: -13, yaw: 14, status: "auto", position: "SWG-04 / Panel 1", instanceId: "J03-ACB-01" },
  { id: "d3", assetTypeId: "meter-m4m", label: "M4M 3O", confidence: 0.72, pitch: 15, yaw: 7, status: "auto", position: "SWG-04 / Panel 1" },
  { id: "d4", assetTypeId: "lv-section", label: "SWG-04", confidence: 0.91, pitch: 44, yaw: 15, status: "auto", position: "Row B", instanceId: "SWG-04" },
  { id: "d5", assetTypeId: "relay-615", label: "RE?615", confidence: 0.63, pitch: 30, yaw: -163, status: "auto", position: "SWG-01 / Panel 1" },
  { id: "d6", assetTypeId: "breaker-emax", label: "E2.2N", confidence: 0.83, pitch: -11, yaw: -164, status: "auto", position: "SWG-01 / Panel 1" },
  { id: "d7", assetTypeId: "relay-615", label: "REF6l5", confidence: 0.44, pitch: 26, yaw: -125, status: "auto", position: "SWG-01 / Panel 2" },
  { id: "d8", assetTypeId: "breaker-emax", label: "EMAX", confidence: 0.58, pitch: -11, yaw: -126, status: "auto", position: "SWG-01 / Panel 2" },
  { id: "d9", assetTypeId: "relay-615", label: "REF615", confidence: 0.86, pitch: 28, yaw: 165, status: "auto", position: "SWG-06 / Panel 1" },
  { id: "d10", assetTypeId: "breaker-emax", label: "E?.2", confidence: 0.39, pitch: -15, yaw: 165, status: "auto", position: "SWG-06 / Panel 1" },
  { id: "d11", assetTypeId: "relay-615", label: "RET615", confidence: 0.81, pitch: 28, yaw: 135, status: "auto", position: "SWG-06 / Panel 2" },
];

export const maintenanceHistory = [
  { date: "2026-06-12", title: "Annual inspection", note: "Thermal scan OK, firmware updated to 5.1." },
  { date: "2025-11-03", title: "Trip test", note: "Secondary injection test passed." },
  { date: "2024-09-21", title: "Installation", note: "Commissioned by field service team." },
];
