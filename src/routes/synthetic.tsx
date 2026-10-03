import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { Upload, Wand2, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/AppShell";
import { SyntheticShowcase } from "@/components/PipelineShowcase";
import { generateVariants, downloadZip, loadImage, type AugmentSettings, type Variant } from "@/lib/augment";

export const Route = createFileRoute("/synthetic")({
  head: () => ({
    meta: [
      { title: "Synthetic Data Generator — VEO360 AutoTag" },
      { name: "description", content: "Generate labelled augmented training images from one reference photo." },
      { property: "og:title", content: "Synthetic Data Generator — VEO360 AutoTag" },
      { property: "og:description", content: "Generate labelled augmented training images from one reference photo." },
    ],
  }),
  component: SyntheticPage,
});

const defaults: AugmentSettings = {
  count: 24, brightness: [70, 130], contrast: [80, 125], rotation: 20, skew: 0.2, scale: [0.7, 1.2],
  noise: 15, blur: 1.5, occlusion: 2, wear: 0.4, randomBackground: true,
};

function SyntheticPage() {
  const [src, setSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState("object");
  const [s, setS] = useState(defaults);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const onFile = (f?: File) => {
    if (!f || !f.type.startsWith("image/")) return;
    setFileName(f.name.replace(/\.[^.]+$/, ""));
    setSrc(URL.createObjectURL(f));
    setVariants([]);
  };

  const generate = async () => {
    if (!src) return;
    setBusy(true); setProgress(0);
    const img = await loadImage(src);
    const v = await generateVariants(img, s, setProgress);
    setVariants(v); setBusy(false);
  };

  const set = <K extends keyof AugmentSettings>(k: K, v: AugmentSettings[K]) => setS((p) => ({ ...p, [k]: v }));

  const range = (label: string, k: "brightness" | "contrast" | "scale", min: number, max: number, step: number, unit = "") => (
    <div className="space-y-2">
      <div className="flex justify-between text-sm"><Label>{label}</Label><span className="text-muted-foreground">{s[k][0]}{unit} – {s[k][1]}{unit}</span></div>
      <Slider min={min} max={max} step={step} value={s[k]} onValueChange={(v) => set(k, [v[0]!, v[1]!] as [number, number])} />
    </div>
  );
  const single = (label: string, k: "rotation" | "skew" | "noise" | "blur" | "occlusion" | "wear", min: number, max: number, step: number, unit = "") => (
    <div className="space-y-2">
      <div className="flex justify-between text-sm"><Label>{label}</Label><span className="text-muted-foreground">{s[k]}{unit}</span></div>
      <Slider min={min} max={max} step={step} value={[s[k]]} onValueChange={(v) => set(k, v[0]!)} />
    </div>
  );

  return (
    <>
      <PageHeader title="Synthetic Data" subtitle="One reference image becomes a labelled training dataset." />
      <SyntheticShowcase />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-secondary-foreground">Try it yourself</h2>
          <p className="text-sm text-muted-foreground">Runs fully in your browser.</p>
        </div>
        {variants.length > 0 && (
          <Button onClick={() => downloadZip(variants, fileName)}><Download className="mr-2 h-4 w-4" /> Download ZIP ({variants.length} + labels.json)</Button>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
                onClick={() => input.current?.click()}
                className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition-colors ${drag ? "border-primary bg-accent" : "border-border"}`}
              >
                {src ? <img src={src} alt="Reference" className="max-h-40 rounded" /> : (
                  <><Upload className="mb-2 h-8 w-8 text-primary" /><div className="text-sm font-medium">Drop a reference image</div><div className="text-xs text-muted-foreground">e.g. a relay nameplate · PNG / JPG</div></>
                )}
              </div>
              <input ref={input} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Augmentations</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between"><Label>Variants (N)</Label><Input type="number" min={1} max={500} className="w-24" value={s.count} onChange={(e) => set("count", Math.max(1, Math.min(500, +e.target.value || 1)))} /></div>
              {range("Brightness", "brightness", 30, 180, 5, "%")}
              {range("Contrast", "contrast", 40, 180, 5, "%")}
              {single("Rotation ±", "rotation", 0, 45, 1, "°")}
              {single("Perspective skew ±", "skew", 0, 0.5, 0.05)}
              {range("Scale", "scale", 0.4, 1.6, 0.05, "×")}
              {single("Gaussian noise", "noise", 0, 60, 1)}
              {single("Blur max", "blur", 0, 5, 0.25, "px")}
              {single("Occlusion rects max", "occlusion", 0, 6, 1)}
              {single("Label wear", "wear", 0, 1, 0.05)}
              <div className="flex items-center justify-between"><Label>Random background</Label><Switch checked={s.randomBackground} onCheckedChange={(v) => set("randomBackground", v)} /></div>
              <Button className="w-full" disabled={!src || busy} onClick={generate}><Wand2 className="mr-2 h-4 w-4" /> {busy ? "Generating…" : "Generate"}</Button>
              {busy && <Progress value={(progress / s.count) * 100} />}
            </CardContent>
          </Card>
        </div>

        <div>
          <div className="mb-3 text-sm"><span className="font-semibold text-secondary-foreground">{busy ? progress : variants.length}</span> / {s.count} images generated</div>
          {variants.length === 0 ? (
            <Card><CardContent className="grid min-h-80 place-items-center text-sm text-muted-foreground">Upload a reference image and press Generate.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {variants.map((v) => (
                <Card key={v.name} className="overflow-hidden">
                  <div className="relative">
                    <img src={v.dataUrl} alt={v.name} className="w-full" />
                    <div className="absolute border-2 border-primary" style={{ left: `${(v.bbox.x / 512) * 100}%`, top: `${(v.bbox.y / 512) * 100}%`, width: `${(v.bbox.w / 512) * 100}%`, height: `${(v.bbox.h / 512) * 100}%` }} />
                  </div>
                  <div className="space-y-0.5 p-2 font-mono text-[10px] text-muted-foreground">
                    <div className="text-foreground">{v.name}</div>
                    <div>rot {v.params["rotation"]}° · scale {v.params["scale"]} · skew {v.params["skewX"]}</div>
                    <div>bri {v.params["brightness"]}% · con {v.params["contrast"]}% · occ {v.params["occlusions"]}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
