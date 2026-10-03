import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Upload, List } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/AppShell";
import { AssetSheet } from "@/components/AssetSheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore, needsReview } from "@/lib/store";
import { scanPoints } from "@/lib/api";
import type { Detection } from "@/data/detections";

const PanoramaViewer = lazy(() => import("@/components/PanoramaViewer"));

/** Deep link, e.g. /twin?scan=scan-06&detection=d14&from=review (all optional). */
type TwinSearch = { scan?: string; detection?: string; from?: "review" };

export const Route = createFileRoute("/twin")({
  validateSearch: (s: Record<string, unknown>): TwinSearch => ({
    ...(typeof s["scan"] === "string" ? { scan: s["scan"] } : {}),
    ...(typeof s["detection"] === "string" ? { detection: s["detection"] } : {}),
    ...(s["from"] === "review" ? { from: "review" as const } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Digital Twin Viewer — VEO360 AutoTag" },
      { name: "description", content: "360° switchgear room with automatically placed, clickable asset tags." },
      { property: "og:title", content: "Digital Twin Viewer — VEO360 AutoTag" },
      { property: "og:description", content: "360° switchgear room with automatically placed, clickable asset tags." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TwinPage,
});

function TwinPage() {
  const { detections, panorama, setPanorama, scanPointId, setScanPoint, loading } = useStore();
  const [show, setShow] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [selected, setSelected] = useState<Detection | null>(null);
  const [focus, setFocus] = useState<{ id: string; yaw: number; pitch: number; key: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const search = Route.useSearch();
  const applied = useRef<string | null>(null);

  // Deep link from the Review Queue: select the scan point, turn to the tag, highlight it and open its panel.
  useEffect(() => {
    if (loading || (!search.scan && !search.detection)) return;
    const key = `${search.scan ?? ""}|${search.detection ?? ""}`;
    if (applied.current === key) return;
    applied.current = key;
    const d = search.detection ? detections.find((x) => x.id === search.detection) : undefined;
    const scan = d?.scanPointId ?? search.scan;
    if (scan) setScanPoint(scan);
    if (d) {
      setSelected(d);
      setFocus({ id: d.id, yaw: d.yaw, pitch: d.pitch, key: Date.now() });
    }
  }, [loading, search.scan, search.detection, detections]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = detections.filter((d) => d.status !== "rejected");
  const visible = active.filter((d) => d.scanPointId === scanPointId);
  const review = visible.filter(needsReview).length;
  const auto = visible.length - review;

  return (
    <>
      <PageHeader
        title="Digital Twin"
        subtitle="Helsinki Substation 01 · Switchgear room B"
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:gap-4">
            <Select value={scanPointId} onValueChange={setScanPoint}>
              <SelectTrigger className="h-11 w-full min-[430px]:w-52 md:h-9"><SelectValue placeholder="Scan point" /></SelectTrigger>
              <SelectContent>
                {scanPoints.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    Scan point {s.id.replace("scan-", "")} · {active.filter((d) => d.scanPointId === s.id).length} tags
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex min-h-11 items-center gap-2"><Switch id="show" checked={show} onCheckedChange={setShow} /><Label htmlFor="show">Show auto-tags</Label></div>
            <Button variant="outline" className="min-h-11 md:min-h-0" onClick={() => input.current?.click()}><Upload className="mr-2 h-4 w-4" /> Upload panorama</Button>
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPanorama(URL.createObjectURL(f)); }} />
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm md:gap-4">
        <span className="w-full rounded-md bg-card px-3 py-2 shadow-sm md:w-auto">
          {loading ? "Running detection…" : <><b className="text-secondary-foreground">{auto}</b> assets tagged automatically, <b className="text-secondary-foreground">{review}</b> need review</>}
        </span>
        <Button variant="outline" className="min-h-11 md:hidden" aria-expanded={showLegend} onClick={() => setShowLegend((value) => !value)}><List className="mr-2 h-4 w-4" /> Legend</Button>
        <div className={`${showLegend ? "flex" : "hidden"} w-full flex-wrap gap-3 md:flex md:w-auto md:gap-4`}>
          <Legend cls="bg-success" label="Auto-tagged (≥ 75%)" /><Legend cls="bg-warning" label="Needs review (< 75%)" /><Legend cls="bg-primary" label="Confirmed" />
        </div>
      </div>
      <Card className="h-[60dvh] min-h-[420px] w-full overflow-hidden p-0 md:h-[calc(100vh-220px)] md:min-h-[480px]">
        <ClientOnly fallback={<div className="h-full animate-pulse bg-muted" />}>
          <Suspense fallback={<div className="h-full animate-pulse bg-muted" />}>
            <PanoramaViewer image={panorama} detections={show ? visible : []} onSelect={setSelected} focus={focus} />
          </Suspense>
        </ClientOnly>
      </Card>
      <AssetSheet detection={selected} onClose={() => setSelected(null)} backToReview={search.from === "review"} />
    </>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1.5 text-xs"><span className={`h-3 w-3 rounded-full ${cls}`} />{label}</span>;
}
