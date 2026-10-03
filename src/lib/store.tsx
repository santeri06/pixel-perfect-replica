import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Detection } from "@/data/detections";
import { getDetections, scanPoints } from "@/lib/api";

interface Store {
  detections: Detection[];
  loading: boolean;
  update: (id: string, patch: Partial<Detection>) => void;
  panorama: string;
  setPanorama: (url: string) => void;
  scanPointId: string;
  setScanPoint: (id: string) => void;
  demoStep: number | null;
  setDemoStep: (s: number | null) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanPointId, setScanPointId] = useState(scanPoints[0]?.id ?? "");
  const [panorama, setPanorama] = useState(scanPoints[0]?.panorama ?? "/panorama-switchgear.jpg");
  const [demoStep, setDemoStep] = useState<number | null>(null);

  const setScanPoint = (id: string) => {
    const p = scanPoints.find((s) => s.id === id);
    if (!p) return;
    setScanPointId(id);
    setPanorama(p.panorama);
  };

  useEffect(() => {
    getDetections("site-helsinki-01").then((d) => {
      setDetections(d);
      setLoading(false);
      // open the scan point with the strongest detection
      const best = [...d].sort((a, b) => b.confidence - a.confidence)[0];
      if (best?.scanPointId) setScanPoint(best.scanPointId);
    });
  }, []);

  const update = (id: string, patch: Partial<Detection>) =>
    setDetections((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <Ctx.Provider value={{ detections, loading, update, panorama, setPanorama, scanPointId, setScanPoint, demoStep, setDemoStep }}>
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

export const confidenceLevel = (c: number) => (c >= 0.8 ? "high" : c >= 0.5 ? "mid" : "low");
export const needsReview = (d: Detection) => d.status === "auto" && d.confidence < 0.8;
