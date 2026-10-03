import { createFileRoute } from "@tanstack/react-router";
import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/AppShell";
import { AssetSheet } from "@/components/AssetSheet";
import { useStore, needsReview } from "@/lib/store";
import type { Detection } from "@/data/detections";

const PanoramaViewer = lazy(() => import("@/components/PanoramaViewer"));

export const Route = createFileRoute("/twin")({
  head: () => ({
    meta: [
      { title: "Digital Twin Viewer — VEO360 AutoTag" },
      { name: "description", content: "360° switchgear room with automatically placed, clickable asset tags." },
      { property: "og:title", content: "Digital Twin Viewer — VEO360 AutoTag" },
      { property: "og:description", content: "360° switchgear room with automatically placed, clickable asset tags." },
    ],
  }),
  component: TwinPage,
});

function TwinPage() {
  const { detections, panorama, setPanorama, loading } = useStore();
  const [show, setShow] = useState(true);
  const [selected, setSelected] = useState<Detection | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const visible = detections.filter((d) => d.status !== "rejected");
  const review = visible.filter(needsReview).length;
  const auto = visible.length - review;

  return (
    <>
      <PageHeader
        title="Digital Twin"
        subtitle="Helsinki Substation 01 · Switchgear room B"
        actions={
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2"><Switch id="show" checked={show} onCheckedChange={setShow} /><Label htmlFor="show">Show auto-tags</Label></div>
            <Button variant="outline" onClick={() => input.current?.click()}><Upload className="mr-2 h-4 w-4" /> Upload panorama</Button>
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPanorama(URL.createObjectURL(f)); }} />
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
        <span className="rounded-md bg-card px-3 py-2 shadow-sm">
          {loading ? "Running detection…" : <><b className="text-secondary-foreground">{auto}</b> assets tagged automatically, <b className="text-secondary-foreground">{review}</b> need review</>}
        </span>
        <Legend cls="bg-success" label="≥ 80%" /><Legend cls="bg-warning" label="50–80%" /><Legend cls="bg-destructive" label="< 50%" /><Legend cls="bg-primary" label="Confirmed" />
      </div>
      <Card className="h-[calc(100vh-220px)] min-h-[480px] overflow-hidden p-0">
        <ClientOnly fallback={<div className="h-full animate-pulse bg-muted" />}>
          <Suspense fallback={<div className="h-full animate-pulse bg-muted" />}>
            <PanoramaViewer image={panorama} detections={show ? visible : []} onSelect={setSelected} />
          </Suspense>
        </ClientOnly>
      </Card>
      <AssetSheet detection={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="flex items-center gap-1.5 text-xs"><span className={`h-3 w-3 rounded-full ${cls}`} />{label}</span>;
}
