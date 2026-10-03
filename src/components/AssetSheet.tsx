import { useEffect, useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { FileText, CheckCircle2, Pencil, LifeBuoy, ExternalLink, AlertTriangle, ArrowLeft } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MaintenanceForm, type FormPreset } from "@/components/MaintenanceForm";
import { MaintenanceLog, docsForVariant, type Doc } from "@/components/MaintenanceLog";
import type { Detection } from "@/data/detections";
import type { MaintenanceEntry } from "@/data/maintenance";
import { getInstance, instances, scanPositions } from "@/data/registry";
import { getAssetById, lookupLibrary, matchAsset } from "@/lib/api";
import { resolveInstance } from "@/lib/resolveInstance";
import { confidenceLevel, useStore } from "@/lib/store";

const barColor = { high: "bg-success", mid: "bg-warning" } as const;

function useCrop(src: string, d: Detection | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!d) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 240; c.height = 150;
      const x = (d.yaw / 360 + 0.5) * img.width;
      const y = (0.5 - d.pitch / 180) * img.height;
      const sw = img.width * 0.06, sh = sw * 0.625;
      c.getContext("2d")!.drawImage(img, x - sw / 2, y - sh / 2, sw, sh, 0, 0, 240, 150);
      setUrl(c.toDataURL());
    };
    img.src = src;
  }, [src, d]);
  return url;
}

export function AssetSheet({ detection, onClose, backToReview = false }: { detection: Detection | null; onClose: () => void; backToReview?: boolean | undefined }) {
  const router = useRouter();
  const navigate = useNavigate();
  // came here from the Review Queue: go back in history (keeps the browser back button consistent)
  const backToQueue = () => (window.history.length > 1 ? router.history.back() : navigate({ to: "/review" }));
  const { update, panorama, detections } = useStore();
  const live = detection ? detections.find((x) => x.id === detection.id) ?? detection : null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [form, setForm] = useState<{ entry: MaintenanceEntry | null; preset: FormPreset } | null>(null);
  const crop = useCrop(panorama, live);

  useEffect(() => { setEditing(false); setText(live?.label ?? ""); setForm(null); }, [live?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!live) return <Sheet open={false} />;
  const asset = getAssetById(live.assetTypeId);
  const { type } = lookupLibrary(live.assetTypeId);
  // type comes from the image, the individual device from its position in the device register
  const instance = getInstance(live.instanceId);
  const unlinked = instance ? null : resolveInstance(live, instances, scanPositions);
  const docs = docsForVariant(type?.manufacturerDocs ?? [], instance?.variant);
  const name = type?.name ?? asset?.name ?? live.assetTypeId;
  const level = confidenceLevel(live.confidence);

  const saveEdit = () => {
    const m = matchAsset(text);
    update(live.id, { label: text, assetTypeId: m?.asset.id ?? live.assetTypeId, confidence: 1, status: "confirmed" });
    setEditing(false);
    toast.success(m ? `Matched to ${m.asset.name}` : "Label updated");
  };

  const docLink = (d: Doc, i: number) => (
    <a key={`${d.title}-${i}`} href={d.url} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm hover:bg-accent">
      <FileText className="h-4 w-4 text-primary" /> <span className="flex-1">{d.title}</span>
      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
    </a>
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[85dvh] w-full overflow-x-hidden overflow-y-auto p-4 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:h-full sm:max-h-none sm:max-w-lg sm:border-l sm:border-t-0 sm:p-6 sm:data-[state=closed]:slide-out-to-right sm:data-[state=open]:slide-in-from-right">
        <SheetHeader>
          {backToReview && (
            <Button variant="ghost" size="sm" className="-ml-2 w-fit text-primary" onClick={backToQueue}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to review queue
            </Button>
          )}
          <div className="flex items-center gap-2">
            {live.status === "confirmed" && <Badge className="bg-primary">Confirmed</Badge>}
            {instance && <Badge variant="outline" className="font-mono">{instance.id}</Badge>}
          </div>
          <SheetTitle className="text-xl">{name}</SheetTitle>
          <SheetDescription>{type?.manufacturer ?? asset?.manufacturer}</SheetDescription>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <div>Detected: <span className="font-mono text-secondary-foreground">{live.label || "615 series"}</span> (from image)</div>
            {instance && (
              <div>Device: <span className="font-mono text-secondary-foreground">{instance.variant}</span> · {instance.functionalLocation} · S/N {instance.serialNo ?? "-"} (from device registry)</div>
            )}
          </div>
        </SheetHeader>

        <div className="space-y-6 px-0 pb-6 sm:px-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <div className="min-w-0">
              <div className="text-xs uppercase text-muted-foreground">OCR type code</div>
              {editing ? (
                <div className="mt-1 flex flex-wrap gap-1"><Input className="min-w-0 flex-1" value={text} onChange={(e) => setText(e.target.value)} /><Button size="sm" className="min-h-11" onClick={saveEdit}>Save</Button></div>
              ) : (
                <div className="mt-1 font-mono text-lg font-semibold text-secondary-foreground">{live.label || <span className="font-sans text-base font-normal text-muted-foreground">Not readable</span>}</div>
              )}
              <div className="mt-3 text-xs uppercase text-muted-foreground">Confidence</div>
              <div className="mt-1 h-2 w-full rounded-full bg-muted">
                <div className={`h-2 rounded-full ${barColor[level]}`} style={{ width: `${live.confidence * 100}%` }} />
              </div>
              <div className="mt-1 text-sm font-medium">{Math.round(live.confidence * 100)}%</div>
            </div>
            <div className="overflow-hidden rounded-md border bg-muted">
              {crop ? <img src={crop} alt="Detected label crop" className="h-full w-full object-cover" /> : <div className="h-full min-h-24" />}
            </div>
          </div>

          {instance ? (
            <MaintenanceLog
              instance={instance}
              onAdd={(preset = {}) => setForm({ entry: null, preset })}
              onUpdate={(entry) => setForm({ entry, preset: {} })}
            />
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-warning bg-warning/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span className="text-secondary-foreground">
                <span className="font-medium">{unlinked?.status === "ambiguous" ? "Several devices match this tag." : "Not linked to a device yet."}</span>{" "}
                The image tells the type, not which relay this is. Maintenance entries can only be added to a linked device.
              </span>
            </div>
          )}

          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-base font-semibold text-secondary-foreground">Manufacturer documentation</h3>
            {docs.warning && (
              <p className="flex items-start gap-2 rounded-md bg-warning/10 p-2 text-xs text-secondary-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" /> {docs.warning}
              </p>
            )}
            {docs.docs.length ? (
              <div className="divide-y rounded-md border">{docs.docs.map(docLink)}</div>
            ) : (
              <p className="text-sm text-muted-foreground">No documents.</p>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { update(live.id, { status: "confirmed" }); toast.success("Tag confirmed"); }} disabled={live.status === "confirmed"}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> Confirm tag
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" /> Edit</Button>
            <Button variant="outline" disabled={!instance} title={instance ? "Creates an open fault notice on this device" : "Link the tag to a device first"} onClick={() => setForm({ entry: null, preset: { kind: "fault", status: "open" } })}><LifeBuoy className="mr-1 h-4 w-4" /> Create support ticket</Button>
          </div>
        </div>

        {instance && (
          <MaintenanceForm
            instance={instance}
            open={form !== null}
            onOpenChange={(o) => !o && setForm(null)}
            entry={form?.entry ?? null}
            preset={form?.preset}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
