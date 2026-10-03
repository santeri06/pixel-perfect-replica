import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { groupStacked, worldToPx, type FloorPlan } from "@/lib/floorplan";
import {
  deviceName,
  matchesFilter,
  type FloorFilter,
  type LiveDevice,
} from "@/lib/floorplanStatus";

/** Marker sizes in screen pixels; divided by the current zoom so they stay the same size on screen. */
const R = 8;
const SCAN_R = 4;
const STACK_STEP = 2 * R + 4; // centre distance of stacked markers: both stay clickable without overlap

const FILL = {
  auto: "var(--success)",
  review: "var(--warning)",
  confirmed: "var(--primary)",
} as const;

type View = { x: number; y: number; w: number; h: number };

interface Props {
  plan: FloorPlan;
  devices: LiveDevice[];
  filter: FloorFilter;
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (d: LiveDevice) => void;
  onScan: (scanPointId: string) => void;
  /** Draw a 1 m grid (approximate layout without a point cloud image). */
  grid?: boolean;
}

export function FloorPlanMap({
  plan,
  devices,
  filter,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
  onScan,
  grid = false,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const full: View = useMemo(
    () => ({ x: 0, y: 0, w: plan.widthPx, h: plan.heightPx }),
    [plan.widthPx, plan.heightPx],
  );
  const [view, setView] = useState<View>(full);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const drag = useRef<{ px: number; py: number; view: View; moved: boolean } | null>(null);

  useEffect(() => setView(full), [full]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // screen px per viewBox unit (aspect ratio is fixed, so one factor is enough)
  const k = width > 0 ? width / view.w : 1;
  const s = (px: number) => px / k;

  // wheel zoom around the cursor (non-passive listener so the page does not scroll)
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => {
        const f = Math.exp(e.deltaY * 0.0015);
        const w = Math.min(full.w, Math.max(full.w / 12, v.w * f));
        const h = (w / full.w) * full.h;
        const cx = v.x + ((e.clientX - r.left) / r.width) * v.w;
        const cy = v.y + ((e.clientY - r.top) / r.height) * v.h;
        return clampView(
          { x: cx - ((cx - v.x) * w) / v.w, y: cy - ((cy - v.y) * h) / v.h, w, h },
          full,
        );
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [full]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { px: e.clientX, py: e.clientY, view, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || view.w >= full.w) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setView(clampView({ ...d.view, x: d.view.x - dx / k, y: d.view.y - dy / k }, full));
  };
  const endDrag = () => {
    window.setTimeout(() => (drag.current = null), 0); // let a click after a drag see `moved`
  };
  const clickable = (fn: () => void) => () => {
    if (!drag.current?.moved) fn();
  };

  const showTip = (x: number, y: number, lines: string[]) =>
    setTip({ x: (x - view.x) * k, y: (y - view.y) * k, lines });

  const at = (p: { x: number; y: number }) => worldToPx(plan, p);
  const scans = [...plan.scanPoints].sort((a, b) => a.id.localeCompare(b.id));
  const stacks = groupStacked(
    devices.map((d) => ({ ...d, x: d.device.x, y: d.device.y, z: d.device.z })),
  );
  // Marker centres (stacks fanned out vertically, highest relay on top). The DOM order of the markers never
  // changes on hover/select: moving a node between pointerdown and click swallows the click (taps on touch
  // screens fire both within one frame). The selected / hovered marker is raised by a copy in an overlay.
  const centre = new Map<string, { cx: number; cy: number }>();
  for (const g of stacks) {
    const base = at(g[0]!);
    g.forEach((d, i) =>
      centre.set(d.device.id, {
        cx: base.px,
        cy: base.py + s((i - (g.length - 1) / 2) * STACK_STEP),
      }),
    );
  }
  const raised = [hoveredId, selectedId].flatMap((id) =>
    devices.filter((d) => d.device.id === id && id !== null),
  );

  const key = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
  const gridLines = grid ? gridOf(plan) : null;
  const zoomed = view.w < full.w - 1e-6;

  return (
    <div
      ref={box}
      className="relative w-full select-none"
      style={{ aspectRatio: `${plan.widthPx} / ${plan.heightPx}` }}
    >
      <svg
        ref={svg}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className={`h-full w-full touch-none ${zoomed ? "cursor-grab" : ""}`}
        role="img"
        aria-label="Floor plan of the room with relay positions"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={() => {
          endDrag();
          setTip(null);
        }}
      >
        {plan.image && (
          <image href={plan.image} x={0} y={0} width={plan.widthPx} height={plan.heightPx} />
        )}
        {gridLines && (
          <g style={{ stroke: "var(--border)" }} strokeWidth={s(1)}>
            {gridLines.map((l, i) => (
              <line key={i} {...l} />
            ))}
          </g>
        )}

        {/* scan points + walking route */}
        <polyline
          points={scans
            .map((p) => {
              const q = at(p);
              return `${q.px},${q.py}`;
            })
            .join(" ")}
          fill="none"
          style={{ stroke: "var(--muted-foreground)" }}
          strokeOpacity={0.35}
          strokeWidth={s(1)}
        />
        {scans.map((p) => {
          const q = at(p);
          const label = `Scan point ${p.id.replace("scan-", "")}`;
          return (
            <circle
              key={p.id}
              cx={q.px}
              cy={q.py}
              r={s(SCAN_R)}
              style={{ fill: "var(--muted-foreground)" }}
              fillOpacity={0.6}
              className="cursor-pointer outline-none focus-visible:stroke-[var(--ring)]"
              strokeWidth={s(2)}
              role="button"
              tabIndex={0}
              aria-label={`${label}, open in digital twin`}
              onClick={clickable(() => onScan(p.id))}
              onKeyDown={key(() => onScan(p.id))}
              onPointerEnter={() => showTip(q.px, q.py, [label])}
              onPointerLeave={() => setTip(null)}
              onFocus={() => showTip(q.px, q.py, [label])}
              onBlur={() => setTip(null)}
            />
          );
        })}

        {stacks.map((g) => {
          const base = at(g[0]!);
          return (
            <g key={g.map((d) => d.device.id).join("+")}>
              {g.map((d) => {
                const { cx, cy } = centre.get(d.device.id)!;
                const sel = d.device.id === selectedId;
                const dim = !matchesFilter(d, filter);
                const seen = d.device.scanPointIds.length;
                const lines = [
                  deviceName(d),
                  `Seen from ${seen} scan point${seen === 1 ? "" : "s"} · ${Math.round(d.device.confidenceMax * 100)}%`,
                  ...(d.device.method === "triangulation" ? ["Position: triangulated"] : []),
                  ...(d.overdue ? ["Maintenance overdue"] : []),
                  ...(d.openCount
                    ? [`${d.openCount} open notice${d.openCount === 1 ? "" : "s"}`]
                    : []),
                ];
                const open = () => onSelect(d);
                return (
                  <g
                    key={d.device.id}
                    opacity={dim ? 0.2 : 1}
                    className="cursor-pointer outline-none"
                    role="button"
                    tabIndex={0}
                    aria-label={`${lines.join(", ")}. Open details`}
                    aria-pressed={sel}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={open}
                    onKeyDown={key(open)}
                    onPointerEnter={() => {
                      onHover(d.device.id);
                      showTip(cx, cy, lines);
                    }}
                    onPointerLeave={() => {
                      onHover(null);
                      setTip(null);
                    }}
                    onFocus={() => {
                      onHover(d.device.id);
                      showTip(cx, cy, lines);
                    }}
                    onBlur={() => {
                      onHover(null);
                      setTip(null);
                    }}
                  >
                    {d.overdue && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={s(R + 4)}
                        fill="none"
                        style={{ stroke: "var(--destructive)" }}
                        strokeWidth={s(3)}
                      />
                    )}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={s(R)}
                      style={{
                        fill: FILL[d.status],
                        stroke: sel ? "var(--secondary-foreground)" : "white",
                      }}
                      strokeWidth={s(sel ? 3.5 : 2.5)}
                    />
                    {d.openCount > 0 && (
                      <g>
                        <circle
                          cx={cx + s(R * 0.8)}
                          cy={cy - s(R * 0.8)}
                          r={s(5)}
                          style={{ fill: "var(--destructive)", stroke: "white" }}
                          strokeWidth={s(1.2)}
                        />
                        <text
                          x={cx + s(R * 0.8)}
                          y={cy - s(R * 0.8)}
                          fontSize={s(8)}
                          fontWeight={700}
                          fill="white"
                          textAnchor="middle"
                          dominantBaseline="central"
                        >
                          !
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
              {g.length > 1 && (
                <g pointerEvents="none">
                  <circle
                    cx={base.px + s(R + 9)}
                    cy={base.py}
                    r={s(6.5)}
                    style={{ fill: "var(--secondary-foreground)" }}
                  />
                  <text
                    x={base.px + s(R + 9)}
                    y={base.py}
                    fontSize={s(9)}
                    fontWeight={700}
                    fill="white"
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {g.length}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* raised copy of the hovered / selected marker (no pointer events, see above) */}
        <g pointerEvents="none">
          {raised.map((d) => {
            const { cx, cy } = centre.get(d.device.id)!;
            const sel = d.device.id === selectedId;
            return (
              <g key={`raised-${d.device.id}-${sel ? "s" : "h"}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={s(R + 7)}
                  style={{ fill: "var(--primary)" }}
                  fillOpacity={0.18}
                />
                {d.overdue && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={s(R + 4)}
                    fill="none"
                    style={{ stroke: "var(--destructive)" }}
                    strokeWidth={s(3)}
                  />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={s(R)}
                  style={{
                    fill: FILL[d.status],
                    stroke: sel ? "var(--secondary-foreground)" : "white",
                  }}
                  strokeWidth={s(sel ? 3.5 : 2.5)}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {tip && (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] -translate-x-1/2 -translate-y-full rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md"
          style={{ left: Math.min(Math.max(tip.x, 70), Math.max(width - 70, 70)), top: tip.y - 14 }}
        >
          {tip.lines.map((l, i) => (
            <div key={i} className={i === 0 ? "font-medium" : "opacity-90"}>
              {l}
            </div>
          ))}
        </div>
      )}
      {zoomed && (
        <Button
          size="sm"
          variant="outline"
          className="absolute right-2 top-2 min-h-11 bg-card md:min-h-0"
          onClick={() => setView(full)}
        >
          <RotateCcw className="mr-1 h-4 w-4" /> Reset view
        </Button>
      )}
    </div>
  );
}

function clampView(v: View, full: View): View {
  return {
    ...v,
    x: Math.min(Math.max(v.x, 0), full.w - v.w),
    y: Math.min(Math.max(v.y, 0), full.h - v.h),
  };
}

function gridOf(plan: FloorPlan) {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const { xMin, xMax, yMin, yMax } = plan.bounds;
  for (let x = Math.ceil(xMin); x <= xMax; x++) {
    const a = worldToPx(plan, { x, y: yMax });
    lines.push({ x1: a.px, y1: 0, x2: a.px, y2: plan.heightPx });
  }
  for (let y = Math.ceil(yMin); y <= yMax; y++) {
    const a = worldToPx(plan, { x: xMin, y });
    lines.push({ x1: 0, y1: a.py, x2: plan.widthPx, y2: a.py });
  }
  return lines;
}
