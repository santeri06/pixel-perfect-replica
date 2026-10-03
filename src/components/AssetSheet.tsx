import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, CheckCircle2, Pencil, LifeBuoy, ExternalLink, AlertTriangle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Detection } from "@/data/detections";
import { getAssetById, lookupLibrary, matchAsset } from "@/lib/api";
import { confidenceLevel, useStore } from "@/lib/store";

const barColor = { high: "bg-success", mid: "bg-warning", low: "bg-destructive" } as const;

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

export function AssetSheet({ detection, onClose }: { detection: Detection | null; onClose: () => void }) {
  const { update, panorama, detections } = useStore();
  const live = detection ? detections.find((x) => x.id === detection.id) ?? detection : null;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const crop = useCrop(panorama, live);

  useEffect(() => { setEditing(false); setText(live?.label ?? ""); }, [live?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!live) return <Sheet open={false} />;
  const asset = getAssetById(live.assetTypeId);
  const { type, instance } = lookupLibrary(live.assetTypeId, live.instanceId);
  const name = type?.name ?? asset?.name ?? live.assetTypeId;
  const level = confidenceLevel(live.confidence);

  const saveEdit = () => {
    const m = matchAsset(text);
    update(live.id, { label: text, assetTypeId: m?.asset.id ?? live.assetTypeId, confidence: 1, status: "confirmed" });
    setEditing(false);
    toast.success(m ? `Matched to ${m.asset.name}` : "Label updated");
  };

  const docLink = (d: { title: string; url: string }, i: number) => (
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
            {live.status === "confirmed" && <Badge className="bg-primary">Vahvistettu</Badge>}
            {instance && <Badge variant="outline" className="font-mono">{instance.instanceId}</Badge>}
          </div>
          <SheetTitle className="text-xl">{name}</SheetTitle>
          <SheetDescription>{type?.manufacturer ?? asset?.manufacturer}</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground">OCR type code</div>
              {editing ? (
                <div className="mt-1 flex gap-1"><Input value={text} onChange={(e) => setText(e.target.value)} /><Button size="sm" onClick={saveEdit}>Save</Button></div>
              ) : (
                <div className="mt-1 font-mono text-lg font-semibold text-secondary-foreground">{live.label || name}</div>
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
            <section className="space-y-5 rounded-lg border p-4">
              <h3 className="text-base font-semibold text-secondary-foreground">Laitteen tiedot</h3>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">Sijainti</dt><dd className="font-medium text-secondary-foreground">{instance.location}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Sarjanumero</dt><dd className="font-mono text-secondary-foreground">{instance.serialNumber}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Elinkaaren tila</dt><dd><Badge variant="outline">{instance.lifecycleStatus}</Badge></dd></div>
                <div><dt className="text-xs text-muted-foreground">Asennettu</dt><dd className="text-secondary-foreground">{instance.installDate}</dd></div>
              </dl>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-secondary-foreground">Huoltohistoria</h4>
                <ol className="space-y-3 border-l-2 border-primary/30 pl-4">
                  {instance.maintenanceHistory.map((m) => (
                    <li key={m.date + m.title} className="relative">
                      <span className="absolute -left-[22px] top-1 h-3 w-3 rounded-full bg-primary" />
                      <div className="text-xs text-muted-foreground">{m.date}</div>
                      <div className="text-sm font-medium text-secondary-foreground">{m.title}</div>
                      <div className="text-sm">{m.note}</div>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-secondary-foreground">Varaosat</h4>
                <Table>
                  <TableHeader><TableRow><TableHead>Osanro</TableHead><TableHead>Kuvaus</TableHead><TableHead className="text-right">Varasto</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {instance.spareParts.map((p) => (
                      <TableRow key={p.partNo}>
                        <TableCell className="font-mono text-xs">{p.partNo}</TableCell>
                        <TableCell>{p.description}</TableCell>
                        <TableCell className={`text-right ${p.stock === 0 ? "text-destructive" : ""}`}>{p.stock}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-secondary-foreground">Laitekohtaiset dokumentit</h4>
                <div className="divide-y rounded-md border">{instance.documents.map(docLink)}</div>
              </div>
            </section>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-warning bg-warning/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span className="font-medium text-secondary-foreground">Laitetta ei yksilöity – vahvista tagi</span>
            </div>
          )}

          <section className="space-y-3 rounded-lg border p-4">
            <h3 className="text-base font-semibold text-secondary-foreground">Valmistajan dokumentaatio</h3>
            {type?.manufacturerDocs.length ? (
              <div className="divide-y rounded-md border">{type.manufacturerDocs.map(docLink)}</div>
            ) : (
              <p className="text-sm text-muted-foreground">Ei dokumentteja.</p>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { update(live.id, { status: "confirmed" }); toast.success("Tagi vahvistettu"); }} disabled={live.status === "confirmed"}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> Confirm tag
            </Button>
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="mr-1 h-4 w-4" /> Edit</Button>
            <Button variant="outline" onClick={() => toast.success(`Support ticket created for ${live.label}`)}><LifeBuoy className="mr-1 h-4 w-4" /> Create support ticket</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
