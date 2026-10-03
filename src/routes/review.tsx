import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Check, MapPin, Pencil, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/AppShell";
import { useStore, needsReview } from "@/lib/store";
import { getAssetById, matchAsset } from "@/lib/api";

export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Review Queue — VEO360 AutoTag" },
      { name: "description", content: "Approve, edit or reject low-confidence automatic tags." },
      { property: "og:title", content: "Review Queue — VEO360 AutoTag" },
      { property: "og:description", content: "Approve, edit or reject low-confidence automatic tags." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReviewPage,
});

function ReviewPage() {
  const { detections, update } = useStore();
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const rows = detections.filter(needsReview).sort((a, b) => a.confidence - b.confidence);

  const saveEdit = () => {
    if (!edit) return;
    const m = matchAsset(edit.text);
    update(edit.id, { label: edit.text, ...(m ? { assetTypeId: m.asset.id } : {}), confidence: 1, status: "confirmed" });
    toast.success(m ? `Matched “${edit.text}” → ${m.asset.name}` : "Tag updated");
    setEdit(null);
  };

  return (
    <>
      <PageHeader title="Review Queue" subtitle="Detections below 75% confidence. Approved tags are confirmed in the Digital Twin." />
      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">All caught up — nothing to review.</p>}
        {rows.map((d) => {
          const m = d.label ? matchAsset(d.label) : null;
          return (
            <Card key={d.id} className="min-w-0 gap-3 p-4">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words font-medium text-secondary-foreground">{getAssetById(d.assetTypeId)?.name ?? d.assetTypeId}</div>
                  {edit?.id === d.id ? <Input className="mt-2 min-h-11 w-full" autoFocus value={edit.text} onChange={(e) => setEdit({ id: d.id, text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEdit()} /> : <div className="mt-1 break-all font-mono text-sm">{d.label || "Not readable"}</div>}
                </div>
                <span className="shrink-0 rounded-full bg-warning/20 px-2 py-1 text-sm font-semibold text-secondary-foreground">{Math.round(d.confidence * 100)}%</span>
              </div>
              {m && <div className="text-sm text-muted-foreground">Match: {m.identifier} ({Math.round(m.score * 100)}%)</div>}
              {d.scanPointId ? (
                <Link to="/twin" search={{ scan: d.scanPointId, detection: d.id, from: "review" }} className="inline-flex min-h-11 items-center gap-2 text-sm text-primary" title="Show this tag in the digital twin"><MapPin className="h-4 w-4 shrink-0" /> Scan point {d.scanPointId.replace("scan-", "")} · {d.position}</Link>
              ) : <div className="text-sm">{d.position || "—"}</div>}
              <div className="grid grid-cols-3 gap-2">
                {edit?.id === d.id ? <Button className="col-span-3 min-h-11" onClick={saveEdit}>Save</Button> : <>
                  <Button className="min-h-11 min-w-0 px-1 text-sm" onClick={() => { update(d.id, { status: "confirmed" }); toast.success(`${d.label || "Tag"} approved`); }}><Check className="h-4 w-4 shrink-0" />Approve</Button>
                  <Button className="min-h-11 min-w-0 px-1 text-sm" variant="outline" onClick={() => setEdit({ id: d.id, text: d.label })}><Pencil className="h-4 w-4 shrink-0" />Edit</Button>
                  <Button className="min-h-11 min-w-0 px-1 text-sm text-destructive" variant="outline" onClick={() => { update(d.id, { status: "rejected" }); toast("Tag rejected"); }}><X className="h-4 w-4 shrink-0" />Reject</Button>
                </>}
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="hidden p-0 md:block">
        <Table>
          <TableHeader>
            <TableRow><TableHead>OCR text</TableHead><TableHead>Suggested asset</TableHead><TableHead>Fuzzy match</TableHead><TableHead>Position</TableHead><TableHead>Confidence</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">All caught up — nothing to review.</TableCell></TableRow>}
            {rows.map((d) => {
              const m = d.label ? matchAsset(d.label) : null;
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-mono">
                    {edit?.id === d.id ? <Input className="h-8 w-36" autoFocus value={edit.text} onChange={(e) => setEdit({ id: d.id, text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEdit()} /> : d.label || <span className="font-sans text-muted-foreground">Not readable</span>}
                  </TableCell>
                  <TableCell>{getAssetById(d.assetTypeId)?.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m ? `${m.identifier} (${Math.round(m.score * 100)}%)` : "—"}</TableCell>
                  <TableCell className="text-sm">
                    {d.scanPointId ? (
                      <Link
                        to="/twin"
                        search={{ scan: d.scanPointId, detection: d.id, from: "review" }}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                        title="Show this tag in the digital twin"
                      >
                        <MapPin className="h-3.5 w-3.5" /> {d.position}
                      </Link>
                    ) : (
                      d.position || "—"
                    )}
                  </TableCell>
                  <TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-semibold bg-warning/20 text-secondary-foreground`}>{Math.round(d.confidence * 100)}%</span></TableCell>
                  <TableCell className="space-x-1 text-right">
                    {edit?.id === d.id ? (
                      <Button size="sm" onClick={saveEdit}>Save</Button>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => { update(d.id, { status: "confirmed" }); toast.success(`${d.label || "Tag"} approved`); }}><Check className="mr-1 h-3.5 w-3.5" />Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => setEdit({ id: d.id, text: d.label })}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => { update(d.id, { status: "rejected" }); toast("Tag rejected"); }}><X className="mr-1 h-3.5 w-3.5" />Reject</Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
