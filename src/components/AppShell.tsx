import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LayoutDashboard, Images, BrainCircuit, Box, ListChecks, Library, X, ArrowRight, BarChart3 } from "lucide-react";
import { useStore, needsReview } from "@/lib/store";
import { Button } from "@/components/ui/button";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/synthetic", label: "Synthetic Data", icon: Images },
  { to: "/training", label: "Training", icon: BrainCircuit },
  { to: "/twin", label: "Digital Twin", icon: Box },
  { to: "/review", label: "Review Queue", icon: ListChecks },
  { to: "/assets", label: "Asset Library", icon: Library },
  { to: "/results", label: "Results", icon: BarChart3 },
] as const;

export const demoSteps = [
  { to: "/synthetic", title: "1. Synthetic data", text: "One reference image becomes hundreds of labelled training images with varied lighting, angle, wear and background." },
  { to: "/training", title: "2. Training", text: "A detector and OCR check are trained on synthetic data only, then tested on real scan images." },
  { to: "/twin", title: "3. Digital Twin", text: "Detected devices appear as clickable tags in the 360° scan, linked to their documentation." },
  { to: "/review", title: "4. Review Queue", text: "Uncertain detections go to a human, and every decision can become new training data." },
  { to: "/results", title: "5. Results", text: "High-confidence, OCR-confirmed tags were correct every time; the rest were safely routed to review." },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { detections, demoStep, setDemoStep } = useStore();
  const navigate = useNavigate();
  const reviewCount = detections.filter(needsReview).length;
  const step = demoStep !== null ? demoSteps[demoStep] : null;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 px-5 py-6">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">360</div>
          <div>
            <div className="text-sm font-semibold text-sidebar-accent-foreground">VEO360</div>
            <div className="text-xs opacity-70">AutoTag</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              activeOptions={{ exact: n.to === "/" }}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium" }}
            >
              <n.icon className="h-4 w-4" />
              <span className="flex-1">{n.label}</span>
              {n.to === "/review" && reviewCount > 0 && (
                <span className="rounded-full bg-warning px-2 text-xs font-semibold text-sidebar">{reviewCount}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="px-5 py-4 text-xs opacity-60">Site: Helsinki Substation 01</div>
      </aside>
      <main className="min-w-0 flex-1 p-8">{children}</main>

      {step && (
        <div className="fixed bottom-6 left-1/2 z-[60] w-[min(640px,90vw)] -translate-x-1/2 rounded-xl border-2 border-primary bg-card p-5 shadow-2xl">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary">Demo mode · step {demoStep! + 1}/{demoSteps.length}</span>
            <button onClick={() => setDemoStep(null)} aria-label="Exit demo"><X className="h-4 w-4" /></button>
          </div>
          <h3 className="text-lg font-semibold text-secondary-foreground">{step.title}</h3>
          <p className="mt-1 text-sm">{step.text}</p>
          <div className="mt-4 flex justify-end gap-2">
            {demoStep! > 0 && (
              <Button variant="outline" onClick={() => { setDemoStep(demoStep! - 1); navigate({ to: demoSteps[demoStep! - 1]!.to }); }}>Back</Button>
            )}
            {demoStep! < demoSteps.length - 1 ? (
              <Button onClick={() => { setDemoStep(demoStep! + 1); navigate({ to: demoSteps[demoStep! + 1]!.to }); }}>
                Next <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={() => setDemoStep(null)}>Finish demo</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-secondary-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
