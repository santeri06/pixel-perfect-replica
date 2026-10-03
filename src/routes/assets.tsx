import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/AppShell";
import { assetLibrary } from "@/data/assets";
import { matchAsset } from "@/lib/api";

export const Route = createFileRoute("/assets")({
  head: () => ({
    meta: [
      { title: "Asset Library — VEO360 AutoTag" },
      { name: "description", content: "Asset types, identifiers and linked documentation used for OCR matching." },
      { property: "og:title", content: "Asset Library — VEO360 AutoTag" },
      { property: "og:description", content: "Asset types, identifiers and linked documentation used for OCR matching." },
    ],
  }),
  component: AssetsPage,
});

function AssetsPage() {
  const [q, setQ] = useState("");
  const [ocr, setOcr] = useState("REF6l5");
  const rows = useMemo(() => {
    const t = q.toLowerCase();
    return assetLibrary.filter((a) => !t || [a.name, a.category, ...a.identifiers].some((x) => x.toLowerCase().includes(t)));
  }, [q]);
  const m = ocr ? matchAsset(ocr) : null;

  return (
    <>
      <PageHeader title="Asset Library" subtitle="Reference identifiers the OCR output is fuzzy-matched against." />
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <div className="text-sm font-medium text-secondary-foreground">Try the matcher:</div>
          <Input className="w-48 font-mono" value={ocr} onChange={(e) => setOcr(e.target.value)} placeholder="OCR text" />
          <div className="text-sm">{m ? <>→ <b className="text-secondary-foreground">{m.asset.name}</b> via “{m.identifier}” ({Math.round(m.score * 100)}%)</> : "No match"}</div>
        </CardContent>
      </Card>
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="bg-card pl-9" placeholder="Search asset types…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card className="p-0">
        <Table>
          <TableHeader><TableRow><TableHead>Asset type</TableHead><TableHead>Identifiers</TableHead><TableHead>Documents</TableHead><TableHead>Lifecycle</TableHead><TableHead className="text-right">Sites</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((a) => (
              <TableRow key={a.id}>
                <TableCell><div className="font-medium text-secondary-foreground">{a.name}</div><div className="text-xs text-muted-foreground">{a.category}</div></TableCell>
                <TableCell><div className="flex flex-wrap gap-1">{a.identifiers.map((i) => <Badge key={i} variant="secondary" className="font-mono text-[10px]">{i}</Badge>)}</div></TableCell>
                <TableCell><div className="flex flex-col gap-0.5">{a.documents.map((d) => <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-primary hover:underline"><FileText className="h-3 w-3" />{d.title}</a>)}</div></TableCell>
                <TableCell><Badge variant="outline">{a.lifecycle}</Badge></TableCell>
                <TableCell className="text-right font-semibold">{a.siteCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
