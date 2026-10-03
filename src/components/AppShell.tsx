import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { LayoutDashboard, Images, BrainCircuit, Box, ListChecks, Library, X, ArrowRight, BarChart3, Menu, Map as MapIcon } from "lucide-react";
import { useStore, needsReview } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/synthetic", label: "Synthetic Data", icon: Images },
  { to: "/training", label: "Training", icon: BrainCircuit },
  { to: "/twin", label: "Digital Twin", icon: Box },
  { to: "/floorplan", label: "Floor plan", icon: MapIcon },
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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const reviewCount = detections.filter(needsReview).length;
  const step = demoStep !== null ? demoSteps[demoStep] : null;
  const pageTitle = nav.find((item) => item.to === pathname)?.label ?? "Dashboard";
  const navigation = (closeOnClick: boolean) => nav.map((n) => (
    <Link
      key={n.to}
      to={n.to}
      onClick={closeOnClick ? () => setMenuOpen(false) : undefined}
      activeOptions={{ exact: n.to === "/" }}
      className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
      activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground font-medium" }}
    >
      <n.icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{n.label}</span>
      {n.to === "/review" && reviewCount > 0 && (
        <span className="rounded-full bg-warning px-2 text-xs font-semibold text-sidebar">{reviewCount}</span>
      )}
    </Link>
  ));

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-5 py-6">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">360</div>
          <div>
            <div className="text-sm font-semibold text-sidebar-accent-foreground">VEO360</div>
            <div className="text-xs opacity-70">AutoTag</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">{navigation(false)}</nav>
        <div className="px-5 py-4 text-xs opacity-60">Site: Helsinki Substation 01</div>
      </aside>
      <div className="sticky top-0 z-40 grid h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground md:hidden">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">360</div>
          <div className="min-w-0"><div className="truncate text-sm font-semibold text-sidebar-accent-foreground">VEO360 AutoTag</div><div className="truncate text-xs">{pageTitle}</div></div>
        </div>
        <Button variant="ghost" size="icon" className="h-11 w-11 text-sidebar-foreground" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu className="h-5 w-5" /></Button>
      </div>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-[min(320px,85vw)] bg-sidebar p-0 text-sidebar-foreground md:hidden">
          <SheetHeader className="px-5 py-6 text-left"><SheetTitle className="text-sidebar-accent-foreground">VEO360 AutoTag</SheetTitle></SheetHeader>
          <nav className="flex flex-col gap-1 px-3">{navigation(true)}</nav>
          <div className="px-5 py-4 text-sm opacity-70">Site: Helsinki Substation 01</div>
        </SheetContent>
      </Sheet>
      <main className="min-w-0 w-full flex-1 px-4 py-5 md:w-auto md:p-8">{children}</main>

      {step && (
        <div className="fixed bottom-4 left-1/2 z-[60] w-[calc(100%-32px)] max-w-[640px] -translate-x-1/2 rounded-lg border-2 border-primary bg-card p-4 shadow-2xl md:bottom-6 md:p-5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold uppercase text-primary">Demo mode · step {demoStep! + 1}/{demoSteps.length}</span>
            <Button variant="ghost" size="icon" className="h-11 w-11" onClick={() => setDemoStep(null)} aria-label="Exit demo"><X className="h-4 w-4" /></Button>
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
    <div className="mb-6 flex min-w-0 flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-secondary-foreground md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
