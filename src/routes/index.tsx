import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PlayCircle, Clock, Zap, Tag, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, demoSteps } from "@/components/AppShell";
import { useStore, needsReview } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — VEO360 AutoTag" },
      { name: "description", content: "Overview of automatic asset tagging in your industrial digital twin." },
      { property: "og:title", content: "Dashboard — VEO360 AutoTag" },
      { property: "og:description", content: "Overview of automatic asset tagging in your industrial digital twin." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { detections, setDemoStep } = useStore();
  const navigate = useNavigate();
  const review = detections.filter(needsReview).length;
  const tagged = detections.filter((d) => d.status !== "rejected").length - review;

  const startDemo = () => { setDemoStep(0); navigate({ to: demoSteps[0]!.to }); };

  return (
    <>
      <PageHeader
        title="Helsinki Substation 01"
        subtitle="Automatic product & label recognition for the Matterport digital twin"
        actions={<Button size="lg" onClick={startDemo}><PlayCircle className="mr-2 h-5 w-5" /> Start demo</Button>}
      />
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { icon: Tag, label: "Auto-tagged assets", value: tagged },
          { icon: AlertTriangle, label: "Need review", value: review },
          { icon: Zap, label: "Detection mAP", value: "0.91" },
          { icon: Clock, label: "Time saved / site", value: "7.6 h" },
        ].map((s) => (
          <Card key={s.label}><CardContent className="flex items-center gap-4 p-5">
            <div className="grid h-10 w-10 place-items-center rounded-md bg-accent text-accent-foreground"><s.icon className="h-5 w-5" /></div>
            <div><div className="text-2xl font-semibold text-secondary-foreground">{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></div>
          </CardContent></Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>Before / after: tagging one switchgear room</CardTitle></CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div className="rounded-lg border p-5">
            <div className="text-xs font-semibold uppercase text-muted-foreground">Manual tagging</div>
            <div className="mt-2 text-4xl font-bold text-secondary-foreground">8 h</div>
            <div className="mt-3 h-3 w-full rounded-full bg-destructive/80" />
            <p className="mt-3 text-sm">Technician walks the scan, reads each nameplate, searches the document archive and places tags by hand.</p>
          </div>
          <div className="rounded-lg border-2 border-primary p-5">
            <div className="text-xs font-semibold uppercase text-primary">VEO360 AutoTag</div>
            <div className="mt-2 text-4xl font-bold text-secondary-foreground">24 min</div>
            <div className="mt-3 h-3 w-[5%] rounded-full bg-primary" />
            <p className="mt-3 text-sm">Detection + OCR places tags automatically and links documentation. Humans only review low-confidence tags.</p>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {demoSteps.map((s) => (
          <Link key={s.to} to={s.to} className="rounded-lg border bg-card p-5 transition-shadow hover:shadow-md">
            <div className="font-semibold text-secondary-foreground">{s.title}</div>
            <p className="mt-1 text-sm">{s.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
