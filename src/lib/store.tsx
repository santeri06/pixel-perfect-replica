import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Detection } from "@/data/detections";
import { getDetections } from "@/lib/api";

interface Store {
  detections: Detection[];
  loading: boolean;
  update: (id: string, patch: Partial<Detection>) => void;
  panorama: string;
  setPanorama: (url: string) => void;
  demoStep: number | null;
  setDemoStep: (s: number | null) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [panorama, setPanorama] = useState("/panorama-switchgear.jpg");
  const [demoStep, setDemoStep] = useState<number | null>(null);

  useEffect(() => {
    getDetections("site-helsinki-01").then((d) => {
      setDetections(d);
      setLoading(false);
    });
  }, []);

  const update = (id: string, patch: Partial<Detection>) =>
    setDetections((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  return (
    <Ctx.Provider value={{ detections, loading, update, panorama, setPanorama, demoStep, setDemoStep }}>
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
