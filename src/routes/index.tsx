import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PlayCircle, Clock, Zap, Tag, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, demoSteps } from "@/components/AppShell";
import { useStore, needsReview } from "@/lib/store";
import { MaintenanceSummary } from "@/components/MaintenanceSummary";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — VEO360 AutoTag" },
      { name: "description", content: "Overview of automatic asset tagging in your industrial digital twin." },
      { property: "og:title", content: "Dashboard — VEO360 AutoTag" },
      { property: "og:description", content: "Overview of automatic asset tagging in your industrial digital twin." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
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
        actions={<Button size="lg" className="w-full md:w-auto" onClick={startDemo}><PlayCircle className="mr-2 h-5 w-5" /> Start demo</Button>}
      />
      <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-4 md:gap-4">
        {[
          { icon: Tag, label: "Auto-tagged assets", value: tagged },
          { icon: AlertTriangle, label: "Need review", value: review },
          { icon: Zap, label: "Detection mAP", value: "0.91" },
          { icon: Clock, label: "Time saved / site", value: "7.6 h" },
        ].map((s) => (
          <Card key={s.label}><CardContent className="flex min-w-0 flex-col gap-2 p-3 min-[430px]:flex-row min-[430px]:items-center md:gap-4 md:p-5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><s.icon className="h-5 w-5" /></div>
            <div className="min-w-0"><div className="text-2xl font-semibold text-secondary-foreground">{s.value}</div><div className="text-sm leading-tight text-muted-foreground md:text-xs">{s.label}</div></div>
          </CardContent></Card>
        ))}
      </div>
      <MaintenanceSummary />

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
