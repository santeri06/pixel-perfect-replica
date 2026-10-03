/**
 * 3D floor plan: the room measured from the point cloud (floor, walls, cabinets with their real
 * heights) seen from above. The camera can tilt and turn only a little (top view ... ~55 degrees,
 * +-35 degrees around), so the view gives depth without getting lost.
 *
 * Relays are numbered badges in an HTML overlay (positioned every frame from their 3D anchor), so
 * they stay crisp, clickable, keyboard accessible and readable by screen readers.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Box, Minus, Plus, ScanEye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { groupStacked, type FloorPlan } from "@/lib/floorplan";
import { badgeAnchor, floorExtent, type Layout3D, type Poly } from "@/lib/floorplan3d";
import {
  markerLines,
  matchesFilter,
  type FloorFilter,
  type LiveDevice,
} from "@/lib/floorplanStatus";

interface Props {
  plan: FloorPlan;
  layout: Layout3D;
  devices: LiveDevice[];
  numbers: Map<string, number>;
  filter: FloorFilter;
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (d: LiveDevice) => void;
  onScan: (scanPointId: string) => void;
  onUnsupported?: () => void;
}

// camera limits: polar 0 = straight down
const POLAR_DEFAULT = 0.6;
const POLAR_MAX = 0.98;
const AZIMUTH_DEFAULT = -0.32;
const AZIMUTH_LIMIT = 0.62;
const FOV = 34;
/** Walls are cut at this height (like a section drawing) so they do not hide the room. */
export const WALL_CUT = 2.0;
const BADGE_GAP = 34; // px between badge centres after decluttering

const STATUS_VAR = { auto: "--success", review: "--warning", confirmed: "--primary" } as const;

/** CSS colour (also oklch / var()) -> THREE.Color via a 1 px canvas, so 3D and HTML match. */
function cssColor(value: string, fallback: string): THREE.Color {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const g = c.getContext("2d");
    if (!g) return new THREE.Color(fallback);
    g.fillStyle = fallback;
    g.fillStyle = value;
    g.fillRect(0, 0, 1, 1);
    const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
    return new THREE.Color().setRGB(
      (r ?? 0) / 255,
      (gr ?? 0) / 255,
      (b ?? 0) / 255,
      THREE.SRGBColorSpace,
    );
  } catch {
    return new THREE.Color(fallback);
  }
}
const cssVar = (name: string, fallback: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return cssColor(v || fallback, fallback);
};

function gridTexture(): THREE.CanvasTexture {
  const n = 256;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f7f8fa";
  g.fillRect(0, 0, n, n);
  g.strokeStyle = "#dde1e7";
  g.lineWidth = 3;
  g.strokeRect(0, 0, n, n); // 1 m grid line on the tile border
  g.strokeStyle = "#eceef2";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(n / 2, 0);
  g.lineTo(n / 2, n);
  g.moveTo(0, n / 2);
  g.lineTo(n, n / 2);
  g.stroke(); // 0.5 m
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function hatchTexture(): THREE.CanvasTexture {
  const n = 64;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e3e6eb";
  g.fillRect(0, 0, n, n);
  g.strokeStyle = "#c3c8d0";
  g.lineWidth = 4;
  for (let i = -n; i < 2 * n; i += 16) {
    g.beginPath();
    g.moveTo(i, n);
    g.lineTo(i + n, 0);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4); // one tile per 25 cm
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function FloorPlan3D({
  plan,
  layout,
  devices,
  numbers,
  filter,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
  onScan,
  onUnsupported,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const api = useRef<{
    reset: (top?: boolean) => void;
    zoom: (f: number) => void;
    setRelays: (list: RelayDraw[]) => void;
  } | null>(null);
  const anchors = useRef<Map<string, THREE.Vector3>>(new Map());
  const relayAt = useRef<Map<string, THREE.Vector3>>(new Map());
  const scanAnchors = useRef<Map<string, THREE.Vector3>>(new Map());
  const [tip, setTip] = useState<{ id: string; lines: string[] } | null>(null);
  const [failed, setFailed] = useState(false);

  // centre of the room: world (x, y, z) -> three (x - cx, z, -(y - cy))
  const ext = useMemo(() => floorExtent(layout), [layout]);
  const cx = (ext.xMin + ext.xMax) / 2;
  const cy = (ext.yMin + ext.yMax) / 2;
  const toV = (x: number, y: number, h: number) => new THREE.Vector3(x - cx, h, -(y - cy));

  // badge anchors (stacked relays spread sideways)
  const stacks = useMemo(
    () => groupStacked(devices.map((d) => ({ ...d, x: d.device.x, y: d.device.y, z: d.device.z }))),
    [devices],
  );
  useEffect(() => {
    const m = new Map<string, THREE.Vector3>();
    for (const g of stacks) {
      g.forEach((d, i) => {
        const [x, y, h] = badgeAnchor(
          d.device,
          layout.devices[d.device.id],
          layout.floorZ,
          i,
          g.length,
        );
        m.set(d.device.id, toV(x, y, h));
      });
    }
    anchors.current = m;
    relayAt.current = new Map(
      devices.map((d) => [d.device.id, toV(d.device.x, d.device.y, d.device.z - layout.floorZ)]),
    );
    const s = new Map<string, THREE.Vector3>();
    for (const p of plan.scanPoints) s.set(p.id, toV(p.x, p.y, 0.02));
    scanAnchors.current = s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stacks, layout, plan.scanPoints, cx, cy]);

  // ---- scene (built once per layout)
  useEffect(() => {
    const el = host.current;
    const ov = overlay.current;
    if (!el || !ov) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      setFailed(true);
      onUnsupported?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.setAttribute("aria-hidden", "true");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e4e7ec");
    const w = ext.xMax - ext.xMin;
    const d = ext.yMax - ext.yMin;
    const span = Math.max(w, d);

    // lights: soft sky + one sun with soft shadows (gives the cabinets depth)
    scene.add(new THREE.HemisphereLight("#ffffff", "#aab0ba", 1.9));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(-span * 0.35, span * 1.1, span * 0.55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
    sun.shadow.camera.far = span * 4;
    sun.shadow.bias = -0.0006;
    sun.shadow.radius = 4;
    scene.add(sun);

    const disposables: { dispose: () => void }[] = [];
    const keep = <T extends { dispose: () => void }>(x: T) => (disposables.push(x), x);

    const shapeOf = (p: Poly) => {
      const s = new THREE.Shape(p.outer.map(([x, y]) => new THREE.Vector2(x - cx, y - cy)));
      for (const h of p.holes)
        s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x - cx, y - cy))));
      return s;
    };
    // shape space (x, y) with extrusion along +z -> three (x, z, -y) after rotateX(-90 deg)
    const extrude = (p: Poly, depth: number) => {
      const g = new THREE.ExtrudeGeometry(shapeOf(p), {
        depth,
        bevelEnabled: false,
        curveSegments: 1,
      });
      g.rotateX(-Math.PI / 2);
      return keep(g);
    };

    // floor slab with a 1 m grid (ShapeGeometry UVs are metres)
    const gridTex = keep(gridTexture());
    const floorMat = keep(new THREE.MeshLambertMaterial({ map: gridTex }));
    const slabSide = keep(new THREE.MeshLambertMaterial({ color: "#c9ced6" }));
    for (const p of layout.floor) {
      const g = extrude(p, 0.12);
      g.translate(0, -0.12, 0);
      const m = new THREE.Mesh(g, [floorMat, slabSide]);
      m.receiveShadow = true;
      scene.add(m);
    }
    const hatch = keep(new THREE.MeshLambertMaterial({ map: keep(hatchTexture()) }));
    for (const p of layout.unscanned) {
      const g = keep(new THREE.ShapeGeometry(shapeOf(p)));
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, hatch);
      m.position.y = 0.004;
      m.receiveShadow = true;
      scene.add(m);
    }

    // room geometry
    const mats = {
      wall: keep(new THREE.MeshLambertMaterial({ color: "#d3d7de" })),
      equipment: keep(new THREE.MeshLambertMaterial({ color: "#454b55" })),
      low: keep(new THREE.MeshLambertMaterial({ color: "#8d949f" })),
    };
    const edgeMats = {
      wall: keep(
        new THREE.LineBasicMaterial({ color: "#8f97a3", transparent: true, opacity: 0.8 }),
      ),
      equipment: keep(
        new THREE.LineBasicMaterial({ color: "#1d2127", transparent: true, opacity: 0.9 }),
      ),
      low: keep(new THREE.LineBasicMaterial({ color: "#5d646e", transparent: true, opacity: 0.8 })),
    };
    for (const s of layout.solids) {
      const g = extrude(
        s,
        Math.max(s.kind === "wall" ? Math.min(s.height, WALL_CUT) : s.height, 0.05),
      );
      const m = new THREE.Mesh(g, mats[s.kind]);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      scene.add(new THREE.LineSegments(keep(new THREE.EdgesGeometry(g, 25)), edgeMats[s.kind]));
    }

    // scan points: small discs and the walk path between them
    const scanGeo = keep(new THREE.CircleGeometry(0.07, 20));
    scanGeo.rotateX(-Math.PI / 2);
    const scanMat = keep(new THREE.MeshBasicMaterial({ color: "#7d8591" }));
    const ordered = [...plan.scanPoints].sort((a, b) => a.id.localeCompare(b.id));
    for (const p of ordered) {
      const m = new THREE.Mesh(scanGeo, scanMat);
      m.position.copy(toV(p.x, p.y, 0.012));
      scene.add(m);
    }
    const path = keep(
      new THREE.BufferGeometry().setFromPoints(ordered.map((p) => toV(p.x, p.y, 0.01))),
    );
    const pathMat = keep(
      new THREE.LineDashedMaterial({ color: "#9aa1ac", dashSize: 0.12, gapSize: 0.08 }),
    );
    const pathLine = new THREE.Line(path, pathMat);
    pathLine.computeLineDistances();
    scene.add(pathLine);

    // relays: a small device box on the cabinet front + a leader line up to the badge
    const relayGroup = new THREE.Group();
    scene.add(relayGroup);
    const relayGeo = keep(new THREE.BoxGeometry(0.22, 0.27, 0.07));
    const relayMats = new Map<string, THREE.MeshLambertMaterial>();
    const colorOf = (status: keyof typeof STATUS_VAR) =>
      cssVar(
        STATUS_VAR[status],
        status === "review" ? "#f0a020" : status === "auto" ? "#22a35a" : "#2a9fd6",
      );
    const setRelays = (list: RelayDraw[]) => {
      for (const c of [...relayGroup.children]) {
        if (c instanceof THREE.Line) c.geometry.dispose();
        relayGroup.remove(c);
      }
      for (const r of list) {
        let rm = relayMats.get(r.status);
        if (!rm) {
          const col = colorOf(r.status);
          rm = keep(
            new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 }),
          );
          relayMats.set(r.status, rm);
        }
        const box = new THREE.Mesh(relayGeo, rm);
        box.position.copy(r.at);
        // box front (+z) -> facing; world (fx, fy) is three (fx, 0, -fy)
        box.rotation.y = Math.atan2(r.facing[0], -r.facing[1]);
        box.castShadow = true;
        box.visible = !r.dim;
        relayGroup.add(box);
      }
    };

    // camera + constrained orbit
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, span * 10);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.9;
    controls.screenSpacePanning = false;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = POLAR_MAX;
    controls.minAzimuthAngle = -AZIMUTH_LIMIT;
    controls.maxAzimuthAngle = AZIMUTH_LIMIT;
    controls.target.set(0, 0.8, 0);
    const fitDistance = () => {
      const aspect = camera.aspect || 1;
      const vfov = (FOV * Math.PI) / 180;
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
      return Math.max(d / 2 / Math.tan(vfov / 2), w / 2 / Math.tan(hfov / 2)) * 0.98 + 0.5;
    };
    const place = (polar: number, azimuth: number, dist: number) => {
      const t = controls.target;
      camera.position.set(
        t.x + dist * Math.sin(polar) * Math.sin(azimuth),
        t.y + dist * Math.cos(polar),
        t.z + dist * Math.sin(polar) * Math.cos(azimuth),
      );
      camera.lookAt(t);
    };

    // smooth transitions for the view buttons
    let anim: {
      from: THREE.Vector3;
      to: THREE.Vector3;
      tFrom: THREE.Vector3;
      tTo: THREE.Vector3;
      t0: number;
    } | null = null;
    const goTo = (
      polar: number,
      azimuth: number,
      dist: number,
      target = new THREE.Vector3(0, 0.8, 0),
    ) => {
      const save = { p: camera.position.clone(), t: controls.target.clone() };
      controls.target.copy(target);
      place(polar, azimuth, dist);
      const to = camera.position.clone();
      camera.position.copy(save.p);
      controls.target.copy(save.t);
      anim = { from: save.p, to, tFrom: save.t, tTo: target.clone(), t0: performance.now() };
    };

    const clampTarget = () => {
      const t = controls.target;
      t.x = Math.min(Math.max(t.x, -w / 2), w / 2);
      t.z = Math.min(Math.max(t.z, -d / 2), d / 2);
      t.y = 0.8;
    };
    controls.addEventListener("change", clampTarget);

    const resize = () => {
      const r = el.getBoundingClientRect();
      const W = Math.max(1, Math.round(r.width));
      const H = Math.max(1, Math.round(r.height));
      renderer.setSize(W, H, false);
      renderer.domElement.style.width = `${W}px`;
      renderer.domElement.style.height = `${H}px`;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      controls.maxDistance = fitDistance() * 1.5;
      controls.minDistance = 3;
    };
    resize();
    place(POLAR_DEFAULT, AZIMUTH_DEFAULT, fitDistance());
    controls.update();
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);

    api.current = {
      reset: (top = false) =>
        goTo(top ? 0.0001 : POLAR_DEFAULT, top ? 0 : AZIMUTH_DEFAULT, fitDistance()),
      zoom: (f: number) => {
        const t = controls.target;
        const dir = camera.position.clone().sub(t);
        const dist = Math.min(
          controls.maxDistance,
          Math.max(controls.minDistance, dir.length() * f),
        );
        const to = t.clone().add(dir.setLength(dist));
        anim = {
          from: camera.position.clone(),
          to,
          tFrom: t.clone(),
          tTo: t.clone(),
          t0: performance.now(),
        };
      },
      setRelays,
    };

    // overlay: project anchors every frame
    const v = new THREE.Vector3();
    const place2d = (node: HTMLElement, p: THREE.Vector3, W: number, H: number) => {
      v.copy(p).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      node.style.transform = `translate(${((v.x + 1) / 2) * W}px, ${((1 - v.y) / 2) * H}px)`;
      node.style.visibility = visible ? "visible" : "hidden";
    };
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (anim) {
        const k = Math.min(1, (performance.now() - anim.t0) / 550);
        const e = 1 - Math.pow(1 - k, 3);
        camera.position.lerpVectors(anim.from, anim.to, e);
        controls.target.lerpVectors(anim.tFrom, anim.tTo, e);
        if (k >= 1) anim = null;
      }
      controls.update();
      renderer.render(scene, camera);
      const W = el.clientWidth;
      const H = el.clientHeight;
      const nodes = [...ov.querySelectorAll<HTMLElement>("[data-anchor]")];
      const pts = nodes.map((n) => {
        const id = n.dataset["anchor"]!;
        const a = anchors.current.get(id);
        const r = relayAt.current.get(id);
        if (!a || !r) return null;
        v.copy(a).project(camera);
        const ok = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
        const x = ((v.x + 1) / 2) * W;
        const y = ((1 - v.y) / 2) * H;
        v.copy(r).project(camera);
        return { id, n, x, y, rx: ((v.x + 1) / 2) * W, ry: ((1 - v.y) / 2) * H, ok };
      });
      // spread overlapping badges (deterministic, recomputed from the projection every frame)
      const live = pts.filter((q): q is NonNullable<typeof q> => !!q && q.ok);
      for (let it = 0; it < 10; it++) {
        for (let i = 0; i < live.length; i++) {
          for (let j = i + 1; j < live.length; j++) {
            const a = live[i]!;
            const b = live[j]!;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dd = Math.hypot(dx, dy);
            if (dd >= BADGE_GAP) continue;
            if (dd < 0.01) {
              dx = 1;
              dy = 0;
              dd = 1;
            }
            const push = (BADGE_GAP - dd) / 2;
            a.x -= (dx / dd) * push;
            a.y -= (dy / dd) * push;
            b.x += (dx / dd) * push;
            b.y += (dy / dd) * push;
          }
        }
      }
      for (const q of pts) {
        if (!q) continue;
        q.n.style.transform = `translate(${q.x}px, ${q.y}px)`;
        q.n.style.visibility = q.ok ? "visible" : "hidden";
        const line = ov.querySelector<SVGLineElement>(`[data-leader="${q.id}"]`);
        if (line) {
          line.setAttribute("x1", String(q.rx));
          line.setAttribute("y1", String(q.ry));
          line.setAttribute("x2", String(q.x));
          line.setAttribute("y2", String(q.y));
          line.style.visibility = q.ok ? "visible" : "hidden";
        }
      }
      ov.querySelectorAll<HTMLElement>("[data-scan]").forEach((n) => {
        const p = scanAnchors.current.get(n.dataset["scan"]!);
        if (p) place2d(n, p, W, H);
      });
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const x of disposables) x.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, plan]);

  // relay boxes follow the live status
  useEffect(() => {
    const list: RelayDraw[] = devices.map((d) => {
      const info = layout.devices[d.device.id];
      return {
        status: d.status,
        at: toV(d.device.x, d.device.y, d.device.z - layout.floorZ),
        badge: anchors.current.get(d.device.id) ?? toV(d.device.x, d.device.y, 2.4),
        facing: info?.facing ?? [0, 1],
        dim: !matchesFilter(d, filter),
      };
    });
    // wait one frame so anchors from the effect above are in place
    const id = requestAnimationFrame(() => api.current?.setRelays(list));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, filter, layout, stacks]);

  if (failed) return null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md">
      <div ref={host} className="absolute inset-0 touch-none" />
      <div ref={overlay} className="pointer-events-none absolute inset-0">
        <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {devices.map((d) => (
            <line
              key={d.device.id}
              data-leader={d.device.id}
              style={{
                stroke: `var(${STATUS_VAR[d.status]})`,
                strokeWidth: 2,
                opacity: matchesFilter(d, filter) ? 0.95 : 0.15,
                visibility: "hidden",
              }}
            />
          ))}
        </svg>
        {plan.scanPoints.map((p) => (
          <button
            key={p.id}
            type="button"
            data-scan={p.id}
            className="pointer-events-auto absolute left-0 top-0 -ml-2.5 -mt-2.5 h-5 w-5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
            style={{ visibility: "hidden" }}
            title={`Scan point ${p.id.replace("scan-", "")} · open in digital twin`}
            aria-label={`Scan point ${p.id.replace("scan-", "")}, open in digital twin`}
            onClick={() => onScan(p.id)}
          />
        ))}
        {devices.map((d) => {
          const n = numbers.get(d.device.id) ?? 0;
          const sel = d.device.id === selectedId;
          const hov = d.device.id === hoveredId;
          const dim = !matchesFilter(d, filter);
          const lines = markerLines(d);
          return (
            <div
              key={d.device.id}
              data-anchor={d.device.id}
              className="absolute left-0 top-0"
              style={{ visibility: "hidden", zIndex: sel || hov ? 3 : 2 }}
            >
              <button
                type="button"
                data-device={d.device.id}
                aria-label={`${n}. ${lines.join(", ")}. Open details`}
                aria-pressed={sel}
                className="pointer-events-auto relative -ml-[15px] -mt-[15px] flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow-md outline-none transition-[transform,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                style={{
                  background: `var(${STATUS_VAR[d.status]})`,
                  opacity: dim ? 0.22 : 1,
                  transform: `scale(${sel ? 1.3 : hov ? 1.15 : 1})`,
                  boxShadow: d.overdue
                    ? "0 0 0 3px var(--destructive), 0 2px 6px rgb(0 0 0 / 0.35)"
                    : sel
                      ? "0 0 0 3px var(--primary), 0 2px 6px rgb(0 0 0 / 0.35)"
                      : undefined,
                }}
                onPointerEnter={() => {
                  onHover(d.device.id);
                  setTip({ id: d.device.id, lines });
                }}
                onPointerLeave={() => {
                  onHover(null);
                  setTip(null);
                }}
                onFocus={() => onHover(d.device.id)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(d)}
              >
                {n}
                {d.openCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-white bg-destructive text-[10px] leading-none">
                    !
                  </span>
                )}
              </button>
              {tip?.id === d.device.id && (
                <div className="pointer-events-none absolute left-5 top-3 z-10 w-max max-w-[260px] rounded-md border bg-card px-3 py-2 text-xs text-secondary-foreground shadow-lg">
                  {tip.lines.map((l, i) => (
                    <div key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>
                      {l}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          className="justify-start shadow"
          onClick={() => api.current?.reset(false)}
        >
          <Box className="mr-1.5 h-4 w-4" /> 3D view
        </Button>
        <Button
          size="sm"
          variant="secondary"
          className="justify-start shadow"
          onClick={() => api.current?.reset(true)}
        >
          <ScanEye className="mr-1.5 h-4 w-4" /> Top view
        </Button>
        <div className="flex gap-1.5">
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 shadow"
            aria-label="Zoom in"
            onClick={() => api.current?.zoom(0.8)}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="secondary"
            className="h-8 w-8 shadow"
            aria-label="Zoom out"
            onClick={() => api.current?.zoom(1.25)}
          >
            <Minus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <p className="pointer-events-none absolute bottom-2 left-3 rounded bg-card/80 px-2 py-1 text-[11px] text-muted-foreground">
        Drag to tilt · right-drag to move · scroll to zoom · walls cut at {WALL_CUT} m
      </p>
    </div>
  );
}

interface RelayDraw {
  status: "auto" | "review" | "confirmed";
  at: THREE.Vector3;
  badge: THREE.Vector3;
  facing: [number, number];
  dim: boolean;
}
