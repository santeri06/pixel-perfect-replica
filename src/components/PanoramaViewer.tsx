import { useEffect, useRef } from "react";
import type { Detection } from "@/data/detections";
import { confidenceLevel } from "@/lib/store";

interface Props {
  image: string;
  detections: Detection[];
  onSelect: (d: Detection) => void;
}

type Viewer = {
  addHotSpot: (h: unknown) => void;
  removeHotSpot: (id: string) => void;
  destroy: () => void;
};

export default function PanoramaViewer({ image, detections, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const ids = useRef<string[]>([]);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const detRef = useRef(detections);
  detRef.current = detections;

  const sync = () => {
    const v = viewer.current;
    if (!v) return;
    ids.current.forEach((id) => v.removeHotSpot(id));
    ids.current = [];
    detRef.current.forEach((d) => {
      const cls = d.status === "confirmed" ? "veo-confirmed" : `veo-${confidenceLevel(d.confidence)}`;
      v.addHotSpot({
        id: d.id,
        pitch: d.pitch,
        yaw: d.yaw,
        cssClass: `veo-pin ${cls}`,
        createTooltipFunc: (div: HTMLElement) => {
          div.title = `${d.label} · ${Math.round(d.confidence * 100)}%`;
        },
        clickHandlerFunc: () => selectRef.current(d),
      });
      ids.current.push(d.id);
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await import("pannellum/build/pannellum.css");
      await import("pannellum/build/pannellum.js");
      if (cancelled || !ref.current) return;
      const p = (window as unknown as { pannellum: { viewer: (el: HTMLElement, cfg: unknown) => Viewer } }).pannellum;
      viewer.current = p.viewer(ref.current, {
        type: "equirectangular",
        panorama: image,
        autoLoad: true,
        showControls: true,
        hfov: 100,
        yaw: 10,
        pitch: 5,
      });
      ids.current = [];
      sync();
    })();
    return () => {
      cancelled = true;
      viewer.current?.destroy();
      viewer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  useEffect(() => {
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detections]);

  return <div ref={ref} className="h-full w-full" />;
}
