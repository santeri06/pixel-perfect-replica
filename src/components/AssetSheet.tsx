import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, CheckCircle2, Pencil, LifeBuoy } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Detection } from "@/data/detections";
import { maintenanceHistory } from "@/data/detections";
import { getAssetById, matchAsset } from "@/lib/api";
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
  const level = confidenceLevel(live.confidence);

  const saveEdit = () => {
    const m = matchAsset(text);
    update(live.id, { label: text, assetTypeId: m?.asset.id ?? live.assetTypeId, confidence: 1, status: "confirmed" });
    setEditing(false);
    toast.success(m ? `Matched to ${m.asset.name}` : "Label updated");
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{asset?.lifecycle} lifecycle</Badge>
            {live.status === "confirmed" && <Badge className="bg-primary">Confirmed</Badge>}
          </div>
          <SheetTitle className="text-xl">{asset?.name}</SheetTitle>
          <SheetDescription>{live.position} · {asset?.manufacturer}</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase text-muted-foreground">OCR type code</div>
              {editing ? (
                <div className="mt-1 flex gap-1"><Input value={text} onChange={(e) => setText(e.target.value)} /><Button size="sm" onClick={saveEdit}>Save</Button></div>
              ) : (
                <div className="mt-1 font-mono text-lg font-semibold text-secondary-foreground">{live.label}</div>
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

          <section>
            <h4 className="mb-2 text-sm font-semibold text-secondary-foreground">Documents</h4>
            <div className="divide-y rounded-md border">
              {asset?.documents.map((doc) => (
                <a key={doc.id} href={doc.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent">
                  <FileText className="h-4 w-4 text-primary" /> <span className="flex-1">{doc.title}</span>
                  <span className="text-xs text-muted-foreground">PDF</span>
                </a>
              ))}
            </div>
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-secondary-foreground">Maintenance history</h4>
            <ol className="space-y-3 border-l-2 border-primary/30 pl-4">
              {maintenanceHistory.map((m) => (
                <li key={m.date} className="relative">
                  <span className="absolute -left-[22px] top-1 h-3 w-3 rounded-full bg-primary" />
                  <div className="text-xs text-muted-foreground">{m.date}</div>
                  <div className="text-sm font-medium text-secondary-foreground">{m.title}</div>
                  <div className="text-sm">{m.note}</div>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-secondary-foreground">Spare parts</h4>
            <Table>
              <TableHeader><TableRow><TableHead>Part no.</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Stock</TableHead></TableRow></TableHeader>
              <TableBody>
                {asset?.spareParts.map((p) => (
                  <TableRow key={p.partNo}>
                    <TableCell className="font-mono text-xs">{p.partNo}</TableCell>
                    <TableCell>{p.description}</TableCell>
                    <TableCell className={`text-right ${p.stock === 0 ? "text-destructive" : ""}`}>{p.stock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { update(live.id, { status: "confirmed" }); toast.success("Tag confirmed"); }} disabled={live.status === "confirmed"}>
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
