import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, CheckCircle2, Pencil, LifeBuoy, ExternalLink, AlertTriangle, Plus, Smartphone, Wrench } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MaintenanceForm, type FormPreset } from "@/components/MaintenanceForm";
import type { Detection } from "@/data/detections";
import { KIND_LABELS, RESULT_LABELS, STATUS_LABELS, deviceStatus, type AssetInstance, type MaintenanceEntry } from "@/data/maintenance";
import { getInstance, instances, scanPositions } from "@/data/registry";
import { getAssetById, lookupLibrary, matchAsset } from "@/lib/api";
import { resolveInstance } from "@/lib/resolveInstance";
import { confidenceLevel, useStore } from "@/lib/store";
import { useMaintenanceEntries } from "@/lib/useMaintenance";

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

type Doc = { title: string; url: string };
const VARIANT_DOC = /^(RE[A-Z]615)\b/;

/**
 * REF615, RET615 and REM615 have their own product guide and application manual; the front panel
 * only shows "615", so the variant must come from the component list, never from the image.
 */
function docsForVariant(docs: Doc[], variant: string | undefined): { docs: Doc[]; warning: string | null } {
  const specific = docs.filter((d) => VARIANT_DOC.test(d.title));
  if (specific.length === 0) return { docs, warning: null };
  const common = docs.filter((d) => !VARIANT_DOC.test(d.title));
  if (!variant || variant === "unknown") {
    return { docs, warning: "Variant unknown - check the rating plate before using a variant-specific manual." };
  }
  const own = specific.filter((d) => d.title.startsWith(variant));
  const others = [...new Set(specific.map((d) => d.title.match(VARIANT_DOC)?.[1]))].join(", ");
  return {
    docs: [...own, ...common],
    warning: own.length ? null : `No ${variant} product guide or application manual in the library yet. Do not use the ${others} documents for this device.`,
  };
}

const resultCls = { ok: "bg-success text-white", remarks: "bg-warning text-secondary-foreground", fault: "bg-destructive text-white" } as const;

function EntryRow({ e, onUpdate }: { e: MaintenanceEntry; onUpdate: (e: MaintenanceEntry) => void }) {
  const date = e.performedAt ?? `reported ${e.createdAt.slice(0, 10)}`;
  return (
    <li className="relative">
      <span className={`absolute -left-[22px] top-1 h-3 w-3 rounded-full ${e.status === "done" ? "bg-primary" : "bg-warning"}`} />
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{date}</span>
        <span>· {KIND_LABELS[e.kind]}</span>
        {e.status !== "done" ? (
          <Badge className="bg-warning text-secondary-foreground">{STATUS_LABELS[e.status]}</Badge>
        ) : (
          e.result && <Badge className={resultCls[e.result]}>{RESULT_LABELS[e.result]}</Badge>
        )}
        {e.source === "field-app" && <Badge variant="outline">Field App</Badge>}
      </div>
      <div className="text-sm font-medium text-secondary-foreground">{e.title}</div>
      {e.findings && <div className="text-sm">{e.findings}</div>}
      {e.actions && e.actions !== "-" && <div className="text-sm text-muted-foreground">Actions: {e.actions}</div>}
      {(e.firmwareBefore || e.firmwareAfter) && (
        <div className="text-xs text-muted-foreground">Firmware {e.firmwareBefore ?? "?"} → {e.firmwareAfter ?? "?"}</div>
      )}
      <div className="text-xs text-muted-foreground">
        {e.performedBy}{e.company ? ` · ${e.company}` : ""}{e.nextDueAt ? ` · next due ${e.nextDueAt}` : ""}
      </div>
      {e.status !== "done" && (
        <Button size="sm" variant="outline" className="mt-1 h-7" onClick={() => onUpdate(e)}>
          <Wrench className="mr-1 h-3.5 w-3.5" /> Update / close
        </Button>
      )}
    </li>
  );
}

function DevicePanel({ instance, onAdd, onUpdate }: { instance: AssetInstance; onAdd: (p?: FormPreset) => void; onUpdate: (e: MaintenanceEntry) => void }) {
  const entries = useMaintenanceEntries(instance.id);
  const st = deviceStatus(instance, entries);
  return (
    <section className="space-y-5 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-secondary-foreground">Device</h3>
        {instance.isDemo && <Badge variant="outline" className="border-warning text-secondary-foreground">Example data</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-muted-foreground">Location</dt><dd className="font-medium text-secondary-foreground">{instance.functionalLocation}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Variant</dt><dd className="font-mono text-secondary-foreground">{instance.variant}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Serial number</dt><dd className="font-mono text-secondary-foreground">{instance.serialNo ?? "-"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Commissioned</dt><dd className="text-secondary-foreground">{instance.commissionedAt ?? "-"}</dd></div>
        <div>
          <dt className="text-xs text-muted-foreground">Next maintenance</dt>
          <dd className="flex items-center gap-1.5 text-secondary-foreground">
            {st.nextDueAt ?? "not planned"}
            {st.overdue && <Badge variant="destructive">Overdue</Badge>}
          </dd>
        </div>
        <div><dt className="text-xs text-muted-foreground">Open notices</dt><dd className={st.openCount ? "font-semibold text-destructive" : "text-secondary-foreground"}>{st.openCount}</dd></div>
      </dl>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-secondary-foreground">Maintenance log</h4>
          <Button size="sm" onClick={() => onAdd()}><Plus className="mr-1 h-3.5 w-3.5" /> Add maintenance entry</Button>
        </div>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No maintenance recorded for this device yet.</p>
        ) : (
          <ol className="space-y-3 border-l-2 border-primary/30 pl-4">
            {entries.map((e) => <EntryRow key={e.id} e={e} onUpdate={onUpdate} />)}
          </ol>
        )}
      </div>

      <a href={`/field/index.html?asset=${encodeURIComponent(instance.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
        <Smartphone className="h-4 w-4" /> Open this device in the Field App
      </a>
    </section>
  );
}

export function AssetSheet({ detection, onClose }: { detection: Detection | null; onClose: () => void }) {
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
  const instance = getInstance(live.instanceId);
  const unlinked = instance ? null : resolveInstance(live, instances, scanPositions);
  const name = type?.name ?? asset?.name ?? live.assetTypeId;
  const level = confidenceLevel(live.confidence);
  const docs = docsForVariant(type?.manufacturerDocs ?? [], instance?.variant);

  const saveEdit = () => {
    const m = matchAsset(text);
    update(live.id, { label: text, assetTypeId: m?.asset.id ?? live.assetTypeId, confidence: 1, status: "confirmed" });
    setEditing(false);
    toast.success(m ? `Matched to ${m.asset.name}` : "Label updated");
  };

  const docLink = (d: Doc, i: number) => (
    <a key={`${d.title}-${i}`} href={d.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent">
      <FileText className="h-4 w-4 text-primary" /> <span className="flex-1">{d.title}</span>
      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
    </a>
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-2">
            {live.status === "confirmed" && <Badge className="bg-primary">Confirmed</Badge>}
            {instance && <Badge variant="outline" className="font-mono">{instance.id}</Badge>}
          </div>
          <SheetTitle className="text-xl">{name}</SheetTitle>
          <SheetDescription>{type?.manufacturer ?? asset?.manufacturer}</SheetDescription>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <div>Detected: <span className="font-mono text-secondary-foreground">{live.label || "615 series"}</span> (from image)</div>
            {instance && (
              <div>
                Device: <span className="font-mono text-secondary-foreground">{instance.variant}</span> · {instance.functionalLocation} · S/N {instance.serialNo ?? "-"} (from component list)
              </div>
            )}
          </div>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground">OCR type code</div>
              {editing ? (
                <div className="mt-1 flex gap-1"><Input value={text} onChange={(e) => setText(e.target.value)} /><Button size="sm" onClick={saveEdit}>Save</Button></div>
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
            <DevicePanel
              instance={instance}
              onAdd={(preset = {}) => setForm({ entry: null, preset })}
              onUpdate={(entry) => setForm({ entry, preset: {} })}
            />
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-warning bg-warning/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span className="text-secondary-foreground">
                <span className="font-medium">
                  {unlinked?.status === "ambiguous" ? "Several devices match this tag." : "Not linked to a device in the component list."}
                </span>{" "}
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
            <Button
              variant="outline"
              disabled={!instance}
              title={instance ? undefined : "Link the tag to a device first"}
              onClick={() => setForm({ entry: null, preset: { kind: "fault", status: "open" } })}
            >
              <LifeBuoy className="mr-1 h-4 w-4" /> Report a fault
            </Button>
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
