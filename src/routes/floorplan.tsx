import { ClientOnly, createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/AppShell";
import { AssetSheet } from "@/components/AssetSheet";
import { FloorPlanMap } from "@/components/FloorPlanMap";
import { approximateLayout, floorPlan } from "@/lib/floorplan";
import { layout3d } from "@/lib/floorplan3d";
import {
  deviceName,
  liveDevices,
  matchesFilter,
  panelDetection,
  registryDevices,
  summarize,
  type FloorFilter,
  type LiveDevice,
} from "@/lib/floorplanStatus";
import { useStore } from "@/lib/store";
import { useMaintenanceFile } from "@/lib/useMaintenance";
import { instances } from "@/data/registry";
import panoramas from "@/data/panoramas.json";

const FloorPlan3D = lazy(() => import("@/components/FloorPlan3D"));

export const Route = createFileRoute("/floorplan")({
  // ?device=DEMO-REL-01 (register id) or dev-07 (floor plan id) selects that relay
  validateSearch: (s: Record<string, unknown>): { device?: string } =>
    typeof s["device"] === "string" ? { device: s["device"] } : {},
  head: () => ({
    meta: [
      { title: "Floor Plan — VEO360 AutoTag" },
      {
        name: "description",
        content:
          "Every relay of the switchgear room on a floor plan measured from the point cloud.",
      },
      { property: "og:title", content: "Floor Plan — VEO360 AutoTag" },
      {
        property: "og:description",
        content:
          "Every relay of the switchgear room on a floor plan measured from the point cloud.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FloorPlanPage,
});

const STATUS_BADGE = {
  auto: { cls: "bg-success text-white", label: "Auto-tagged" },
  review: { cls: "bg-warning text-white", label: "Needs review" },
  confirmed: { cls: "bg-primary", label: "Confirmed" },
} as const;

function FloorPlanPage() {
  const { detections, loading } = useStore();
  const file = useMaintenanceFile();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FloorFilter>("all");
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"3d" | "2d">(floorPlan && layout3d ? "3d" : "2d");

  // without floorplan.json: scan points + registered relays on a metre grid, clearly marked approximate
  const plan = floorPlan ?? approximateLayout(panoramas, instances);
  const devices = useMemo(() => {
    const src = floorPlan ? floorPlan.devices : registryDevices(instances, detections);
    return liveDevices(src, detections, instances, file.entries);
  }, [detections, file.entries]);
  const sum = summarize(devices);
  const { device: wanted } = Route.useSearch();
  // select once when the relay is found (register links need the detections to be loaded first)
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (!wanted || applied.current === wanted) return;
    const hit = devices.find((d) => d.device.id === wanted || d.instance?.id === wanted);
    if (hit) {
      applied.current = wanted;
      setSelected(hit.device.id);
    }
  }, [wanted, devices]);
  // list: registered relays by location, then unregistered ones (auto-tagged before review)
  const listed = [...devices].sort((a, b) =>
    a.instance && b.instance
      ? a.instance.functionalLocation.localeCompare(b.instance.functionalLocation)
      : a.instance
        ? -1
        : b.instance
          ? 1
          : (a.status === "review" ? 1 : 0) - (b.status === "review" ? 1 : 0) ||
            a.device.id.localeCompare(b.device.id),
  );
  // the same number on the map badge and in the list
  const numbers = new Map(listed.map((d, i) => [d.device.id, i + 1]));
  const sel = devices.find((d) => d.device.id === selected) ?? null;
  const selDetection = sel ? (panelDetection(sel) ?? null) : null;
  const unlocated = (floorPlan?.unlocated ?? []).filter(
    (u) => detections.find((d) => d.id === u.detectionId)?.status !== "rejected",
  );
  const toScan = (scan: string) => navigate({ to: "/twin", search: { scan, from: "floorplan" } });

  return (
    <>
      <PageHeader
        title="Floor plan"
        subtitle={`Demo site · Switchgear room B · ${floorPlan ? (layout3d ? "3D model from the point cloud" : "top view from the point cloud") : "approximate layout"}`}
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-md bg-card px-3 py-2 shadow-sm">
            {loading ? (
              "Loading detections…"
            ) : (
              <>
                <b className="text-secondary-foreground">{sum.relays}</b> relays in this room ·{" "}
                <b className="text-secondary-foreground">{sum.auto}</b> auto-tagged ·{" "}
                <b className="text-secondary-foreground">{sum.review}</b> need review
                {sum.confirmed > 0 && (
                  <>
                    {" "}
                    · <b className="text-secondary-foreground">{sum.confirmed}</b> confirmed
                  </>
                )}{" "}
                · <b className="text-secondary-foreground">{sum.overdue}</b> overdue maintenance
                <span className="ml-2 text-xs text-muted-foreground">
                  from {sum.detections} detections
                </span>
              </>
            )}
          </span>
          <Badge
            variant="outline"
            className="border-warning text-secondary-foreground"
            title="Device register and maintenance history are example data; positions come from the scan."
          >
            Example data
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {floorPlan && layout3d && (
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as "3d" | "2d")}
              variant="outline"
              size="sm"
              aria-label="Floor plan view"
              className="justify-start"
            >
              <ToggleGroupItem value="3d" className="min-h-11 md:min-h-0">
                3D
              </ToggleGroupItem>
              <ToggleGroupItem value="2d" className="min-h-11 md:min-h-0">
                2D
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(v) => v && setFilter(v as FloorFilter)}
            variant="outline"
            size="sm"
            aria-label="Highlight relays"
            className="justify-start"
          >
            <ToggleGroupItem value="all" className="min-h-11 md:min-h-0">
              All
            </ToggleGroupItem>
            <ToggleGroupItem value="review" className="min-h-11 md:min-h-0">
              Needs review
            </ToggleGroupItem>
            <ToggleGroupItem value="overdue" className="min-h-11 md:min-h-0">
              Overdue
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {!floorPlan && (
        <Card className="mb-4 border-warning bg-warning/10 p-4 text-sm text-secondary-foreground">
          Floor plan not generated yet. Run{" "}
          <code className="font-mono">cv/floorplan/build_floorplan.py</code> to create it from the
          point cloud.
          {plan && (
            <span className="mt-1 block text-xs text-muted-foreground">
              Approximate layout (no floor plan): scan points and registered relays on a 1 m grid.
            </span>
          )}
        </Card>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="min-w-0 overflow-hidden p-2 md:p-4">
          {mode === "3d" && floorPlan && layout3d ? (
            <div className="h-[calc(100vh-260px)] min-h-[480px]">
              <ClientOnly fallback={<div className="h-full animate-pulse rounded-md bg-muted" />}>
                <Suspense fallback={<div className="h-full animate-pulse rounded-md bg-muted" />}>
                  <FloorPlan3D
                    plan={floorPlan}
                    layout={layout3d}
                    devices={devices}
                    numbers={numbers}
                    filter={filter}
                    selectedId={selected}
                    hoveredId={hovered}
                    onHover={setHovered}
                    onSelect={(d) => setSelected(d.device.id)}
                    onScan={toScan}
                    onUnsupported={() => setMode("2d")}
                  />
                </Suspense>
              </ClientOnly>
            </div>
          ) : plan ? (
            <FloorPlanMap
              plan={plan}
              devices={devices}
              filter={filter}
              selectedId={selected}
              hoveredId={hovered}
              onHover={setHovered}
              onSelect={(d) => setSelected(d.device.id)}
              onScan={toScan}
              grid={!floorPlan}
            />
          ) : (
            <p className="p-6 text-sm text-muted-foreground">No scan points available.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-3 px-1 text-xs">
            <Legend style={{ background: "var(--success)" }} label="Auto-tagged" />
            <Legend style={{ background: "var(--warning)" }} label="Needs review" />
            <Legend style={{ background: "var(--primary)" }} label="Confirmed" />
            <Legend
              style={{ boxShadow: "0 0 0 2px var(--destructive)" }}
              label="Maintenance overdue"
            />
            <Legend
              style={{ background: "var(--muted-foreground)", opacity: 0.6, width: 8, height: 8 }}
              label="Scan point"
            />
          </div>
        </Card>

        <Card className="min-w-0 p-0">
          <h2 className="border-b px-4 py-3 text-base font-semibold text-secondary-foreground">
            Relays ({devices.length})
          </h2>
          <ul className="divide-y">
            {listed.map((d) => (
              <DeviceRow
                key={d.device.id}
                d={d}
                n={numbers.get(d.device.id) ?? 0}
                active={hovered === d.device.id || selected === d.device.id}
                dim={!matchesFilter(d, filter)}
                onHover={setHovered}
                onOpen={() => setSelected(d.device.id)}
              />
            ))}
          </ul>
          {unlocated.length > 0 && (
            <div className="border-t px-4 py-3">
              <h3 className="text-sm font-medium text-secondary-foreground">
                Detections without a position ({unlocated.length})
              </h3>
              <ul className="mt-2 space-y-1">
                {unlocated.map((u) => (
                  <li key={u.detectionId}>
                    <Link
                      to="/twin"
                      search={{
                        ...(u.scanPointId ? { scan: u.scanPointId } : {}),
                        detection: u.detectionId,
                        from: "floorplan",
                      }}
                      className="inline-flex min-h-11 items-center gap-2 text-sm text-primary md:min-h-0"
                    >
                      <MapPin className="h-4 w-4 shrink-0" /> {u.detectionId} ·{" "}
                      {u.scanPointId
                        ? `Scan point ${u.scanPointId.replace("scan-", "")}`
                        : "no scan point"}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <AssetSheet
        detection={selDetection}
        onClose={() => setSelected(null)}
        twinLink={
          selDetection?.scanPointId
            ? { scan: selDetection.scanPointId, detection: selDetection.id }
            : undefined
        }
      />
    </>
  );
}

function DeviceRow({
  d,
  n,
  active,
  dim,
  onHover,
  onOpen,
}: {
  d: LiveDevice;
  n: number;
  active: boolean;
  dim: boolean;
  onHover: (id: string | null) => void;
  onOpen: () => void;
}) {
  const st = STATUS_BADGE[d.status];
  const seen = d.device.scanPointIds.length;
  return (
    <li>
      <button
        type="button"
        className={`flex min-h-11 w-full flex-col gap-1 px-4 py-2.5 text-left transition-colors hover:bg-accent ${active ? "bg-accent" : ""} ${dim ? "opacity-40" : ""}`}
        onPointerEnter={() => onHover(d.device.id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(d.device.id)}
        onBlur={() => onHover(null)}
        onClick={onOpen}
      >
        <span className="flex w-full items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
              style={{
                background: `var(${d.status === "review" ? "--warning" : d.status === "auto" ? "--success" : "--primary"})`,
              }}
              aria-hidden
            >
              {n}
            </span>
            <span className="truncate text-sm font-medium text-secondary-foreground">
              {d.instance ? d.instance.functionalLocation : "Unregistered relay"}
            </span>
          </span>
          <Badge className={`shrink-0 ${st.cls}`}>{st.label}</Badge>
        </span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Seen from {seen} scan point{seen === 1 ? "" : "s"}
          </span>
          {d.instance && <span className="font-mono">{d.instance.variant}</span>}
          {d.overdue && <Badge variant="destructive">Overdue</Badge>}
          {!d.overdue && d.nextDueAt && <span>Next due {d.nextDueAt}</span>}
          {d.openCount > 0 && (
            <Badge variant="outline" className="border-destructive text-destructive">
              {d.openCount} open notice{d.openCount === 1 ? "" : "s"}
            </Badge>
          )}
        </span>
        <span className="sr-only">{deviceName(d)}</span>
      </button>
    </li>
  );
}

function Legend({ style, label }: { style: CSSProperties; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-full border-2 border-white" style={style} />
      {label}
    </span>
  );
}
