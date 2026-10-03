import { useEffect, useRef } from "react";
import type { Detection } from "@/data/detections";

interface Focus {
  id: string;
  yaw: number;
  pitch: number;
  key: number;
}

interface Props {
  image: string;
  detections: Detection[];
  onSelect: (d: Detection) => void;
  /** Turn to this tag, zoom in a little and highlight it for ~3 s (deep link from the Review Queue). */
  focus?: Focus | null | undefined;
}

const FOCUS_HFOV = 60;
const HIGHLIGHT_MS = 2800;

type Viewer = {
  addHotSpot: (h: unknown) => void;
  removeHotSpot: (id: string) => void;
  on: (event: string, cb: () => void) => void;
  destroy: () => void;
  lookAt: (pitch?: number, yaw?: number, hfov?: number, animated?: boolean | number) => void;
};

export default function PanoramaViewer({ image, detections, onSelect, focus }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const ids = useRef<string[]>([]);
  const loaded = useRef(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const detRef = useRef(detections);
  detRef.current = detections;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const highlight = useRef<{ id: string; until: number } | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);

  const sync = () => {
    const v = viewer.current;
    if (!v || !loaded.current) return;
    ids.current.forEach((id) => v.removeHotSpot(id));
    ids.current = [];
    detRef.current.forEach((d) => {
      const cls = d.status === "confirmed" ? "veo-confirmed" : d.status === "review" ? "veo-mid" : "veo-high";
      const h = highlight.current;
      const focused = h && h.id === d.id && Date.now() < h.until ? " veo-focus" : "";
      v.addHotSpot({
        id: d.id,
        pitch: d.pitch,
        yaw: d.yaw,
        cssClass: `veo-pin ${cls}${focused}`,
        createTooltipFunc: (div: HTMLElement) => {
          div.title = `${d.label || "Not readable"} ·${Math.round(d.confidence * 100)}%`;
        },
        clickHandlerFunc: () => selectRef.current(d),
      });
      ids.current.push(d.id);
    });
  };

  /** Pulse the tag for a few seconds, then return it to a normal pin. */
  const startHighlight = (id: string) => {
    highlight.current = { id, until: Date.now() + HIGHLIGHT_MS };
    sync();
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      highlight.current = null;
      sync();
    }, HIGHLIGHT_MS + 100);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await import("pannellum/build/pannellum.css");
      await import("pannellum/build/pannellum.js");
      if (cancelled || !ref.current) return;
      const p = (window as unknown as { pannellum: { viewer: (el: HTMLElement, cfg: unknown) => Viewer } }).pannellum;
      // start on the focused tag (deep link), otherwise on the strongest tag of this panorama
      const f = focusRef.current;
      const target = f && detRef.current.some((d) => d.id === f.id) ? f : null;
      const best = [...detRef.current].sort((a, b) => b.confidence - a.confidence)[0];
      viewer.current = p.viewer(ref.current, {
        type: "equirectangular",
        panorama: image,
        autoLoad: true,
        showControls: true,
        hfov: target ? FOCUS_HFOV : 100,
        yaw: target?.yaw ?? best?.yaw ?? 10,
        pitch: target?.pitch ?? best?.pitch ?? 5,
        hotSpots: [],
      });
      ids.current = [];
      // hot spots added before the scene has loaded are rendered twice by Pannellum
      viewer.current.on("load", () => {
        loaded.current = true;
        sync();
        if (pendingFocus.current) {
          startHighlight(pendingFocus.current);
          pendingFocus.current = null;
        }
      });
    })();
    return () => {
      cancelled = true;
      loaded.current = false;
      viewer.current?.destroy();
      viewer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  useEffect(() => {
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detections]);

  // A new focus request: turn there if the panorama is already shown, otherwise once it has loaded.
  useEffect(() => {
    if (!focus) return;
    const v = viewer.current;
    if (v && loaded.current) {
      v.lookAt(focus.pitch, focus.yaw, FOCUS_HFOV, 800);
      startHighlight(focus.id);
    } else {
      pendingFocus.current = focus.id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key]);

  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  return <div ref={ref} className="h-full w-full" />;
}
