import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/AppShell";
import { useStore, needsReview, confidenceLevel } from "@/lib/store";
import { getAssetById, matchAsset } from "@/lib/api";

export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Review Queue — VEO360 AutoTag" },
      { name: "description", content: "Approve, edit or reject low-confidence automatic tags." },
      { property: "og:title", content: "Review Queue — VEO360 AutoTag" },
      { property: "og:description", content: "Approve, edit or reject low-confidence automatic tags." },
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
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow><TableHead>OCR text</TableHead><TableHead>Suggested asset</TableHead><TableHead>Fuzzy match</TableHead><TableHead>Position</TableHead><TableHead>Confidence</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">All caught up — nothing to review.</TableCell></TableRow>}
            {rows.map((d) => {
              const m = matchAsset(d.label);
              const lvl = confidenceLevel(d.confidence);
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-mono">
                    {edit?.id === d.id ? <Input className="h-8 w-36" autoFocus value={edit.text} onChange={(e) => setEdit({ id: d.id, text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && saveEdit()} /> : d.label}
                  </TableCell>
                  <TableCell>{getAssetById(d.assetTypeId)?.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m ? `${m.identifier} (${Math.round(m.score * 100)}%)` : "—"}</TableCell>
                  <TableCell className="text-sm">{d.position}</TableCell>
                  <TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${lvl === "low" ? "bg-destructive/15 text-destructive" : "bg-warning/20 text-secondary-foreground"}`}>{Math.round(d.confidence * 100)}%</span></TableCell>
                  <TableCell className="space-x-1 text-right">
                    {edit?.id === d.id ? (
                      <Button size="sm" onClick={saveEdit}>Save</Button>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => { update(d.id, { status: "confirmed" }); toast.success(`${d.label} approved`); }}><Check className="mr-1 h-3.5 w-3.5" />Approve</Button>
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
