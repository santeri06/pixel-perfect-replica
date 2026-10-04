import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PlayCircle, MapPin, Zap, Tag, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, demoSteps } from "@/components/AppShell";
import { useStore, needsReview } from "@/lib/store";
import { MaintenanceSummary } from "@/components/MaintenanceSummary";
import { MaintenanceDue } from "@/components/MaintenanceDue";
import { floorPlan } from "@/lib/floorplan";
import { trainingStats } from "@/data/training";

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
        title="Demo site"
        subtitle="Automatic product & label recognition for the Matterport digital twin"
        actions={<Button size="lg" className="w-full md:w-auto" onClick={startDemo}><PlayCircle className="mr-2 h-5 w-5" /> Start demo</Button>}
      />
      <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-4 md:gap-4">
        {[
          { icon: Tag, label: "Auto-tagged assets", value: tagged },
          { icon: AlertTriangle, label: "Need review", value: review },
          { icon: MapPin, label: "Devices located", value: floorPlan ? floorPlan.devices.length : "–" },
          { icon: Zap, label: "Detection mAP (synthetic val.)", value: trainingStats.map.toFixed(3) },
        ].map((s) => (
          <Card key={s.label}><CardContent className="flex min-w-0 flex-col gap-2 p-3 min-[430px]:flex-row min-[430px]:items-center md:gap-4 md:p-5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><s.icon className="h-5 w-5" /></div>
            <div className="min-w-0"><div className="text-2xl font-semibold text-secondary-foreground">{s.value}</div><div className="text-sm leading-tight text-muted-foreground md:text-xs">{s.label}</div></div>
          </CardContent></Card>
        ))}
      </div>
      <MaintenanceSummary />

      <MaintenanceDue />

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
