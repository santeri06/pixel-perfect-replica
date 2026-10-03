#!/usr/bin/env node
/**
 * Builds the DEMO device registry (component list) from the CV pipeline output.
 *
 *   node scripts/build-registry.mjs            # or: npm run registry / bun run registry
 *   node scripts/build-registry.mjs --max 4    # number of registered relays (default 5)
 *   node scripts/build-registry.mjs --fresh    # ignore the previous registry (new IDs)
 *
 * Why: maintenance entries must belong to a physical device, never to a detection.
 * Detection IDs (d1, d2, ...) change on every CV run, and the same relay is detected
 * from several scan points. This script
 *   1. triangulates detections from different scan points into physical devices
 *      (closest approach of the viewing rays, consensus voting, least-squares point),
 *   2. registers up to --max devices that have at least one auto-tagged detection,
 *   3. keeps instance IDs, variants and demo history stable across reruns by matching
 *      the new device positions to the previous registry (within 0.3 m).
 *
 * Inputs : src/data/detections.json, src/data/panoramas.json (read only)
 * Outputs: src/data/registry.generated.json and public/field/registry.json (identical)
 *
 * Everything this script writes is DEMO data: serial numbers, variants, locations and
 * maintenance history are invented and flagged with isDemo / "Example data" in the UI.
 * Only the anchors (scan point, yaw, pitch, 3D position) come from the CV data.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Same threshold as AUTO_TAG_CONFIDENCE in src/data/detections.ts (checked by src/test/registry.test.ts). */
export const AUTO_TAG_CONFIDENCE = 0.75;

export const DEFAULTS = {
  maxInstances: 5,
  tolDeg: 5, // angular tolerance when linking a detection to a device (generous: CV data may change)
  gapM: 0.05, // max distance between two viewing rays to count as the same point
  minRangeM: 0.3, // device must be in front of the camera, not at the lens
  maxRangeM: 8,
  minRayAngleDeg: 10, // near-parallel rays give unstable intersections
  supportDeg: 2, // a detection supports a 3D point if its ray passes within this angle
  matchExistingM: 0.3, // previous registry instance = same device if closer than this
};

const VARIANTS = ["REF615", "RET615", "REM615", "REF615", "unknown"];
const PROFILES = ["overdue", "open-fault", "empty", "ok", "ok-firmware"];

// ---------------------------------------------------------------- geometry
const RAD = Math.PI / 180;

/** Pannellum convention used by cv/geometry.py: yaw 0 = world +Y, positive to the right (+X), pitch positive up (+Z). */
export function dirFromYawPitch(yawDeg, pitchDeg) {
  const y = yawDeg * RAD;
  const p = pitchDeg * RAD;
  return [Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), Math.sin(p)];
}

export function yawPitchFromDir(d) {
  const n = Math.hypot(d[0], d[1], d[2]);
  return {
    yaw: Math.atan2(d[0], d[1]) / RAD,
    pitch: Math.asin(Math.max(-1, Math.min(1, d[2] / n))) / RAD,
  };
}

export function angularDistDeg(a, b) {
  const c =
    Math.sin(a.pitch * RAD) * Math.sin(b.pitch * RAD) +
    Math.cos(a.pitch * RAD) * Math.cos(b.pitch * RAD) * Math.cos((a.yaw - b.yaw) * RAD);
  return Math.acos(Math.min(1, Math.max(-1, c))) / RAD;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Closest approach of two rays o + t·d (d unit vectors). */
function closestApproach(o1, d1, o2, d2) {
  const w = sub(o1, o2);
  const b = dot(d1, d2);
  const den = 1 - b * b;
  if (den < 1e-9) return null;
  const d = dot(d1, w);
  const e = dot(d2, w);
  const t = (b * e - d) / den;
  const s = (e - b * d) / den;
  const p1 = add(o1, mul(d1, t));
  const p2 = add(o2, mul(d2, s));
  return {
    t,
    s,
    gap: dist(p1, p2),
    point: mul(add(p1, p2), 0.5),
    angleDeg: Math.acos(Math.min(1, Math.abs(b))) / RAD,
  };
}

/** Least-squares point closest to all rays: sum (I - d dᵀ) p = sum (I - d dᵀ) o. */
function leastSquaresPoint(rays) {
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const bv = [0, 0, 0];
  for (const { o, d } of rays) {
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const m = (i === j ? 1 : 0) - d[i] * d[j];
        A[i][j] += m;
        bv[i] += m * o[j];
      }
    }
  }
  return solve3(A, bv);
}

function solve3(A, b) {
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (Math.abs(D) < 1e-12) return null;
  return [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / D);
}

/** Direction (yaw/pitch) from a scan point to a 3D position, plus the range in metres. */
export function viewFrom(scanPos, position) {
  const v = sub(position, scanPos);
  return { ...yawPitchFromDir(v), range: Math.hypot(v[0], v[1], v[2]) };
}

// ---------------------------------------------------------------- clustering
export const isAuto = (d) => (d.status ? d.status === "auto" : d.confidence >= AUTO_TAG_CONFIDENCE);

/**
 * Groups detections into physical devices.
 * Returns [{ position: [x,y,z] | null, members: detection[] }], position = null for single-view devices.
 */
export function clusterDetections(detections, scanPositions, opts = DEFAULTS) {
  const usable = detections.filter(
    (d) => d.yaw != null && d.pitch != null && d.scanPointId && scanPositions[d.scanPointId],
  );
  const ray = (d) => ({ o: scanPositions[d.scanPointId], d: dirFromYawPitch(d.yaw, d.pitch) });

  const candidates = [];
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const a = usable[i];
      const b = usable[j];
      if (a.scanPointId === b.scanPointId) continue;
      const ra = ray(a);
      const rb = ray(b);
      const c = closestApproach(ra.o, ra.d, rb.o, rb.d);
      if (!c || c.gap > opts.gapM || c.angleDeg < opts.minRayAngleDeg) continue;
      if (
        c.t < opts.minRangeM ||
        c.s < opts.minRangeM ||
        c.t > opts.maxRangeM ||
        c.s > opts.maxRangeM
      )
        continue;
      candidates.push(c.point);
    }
  }

  const supporters = (point, pool) =>
    pool.filter((d) => {
      const v = viewFrom(scanPositions[d.scanPointId], point);
      return (
        v.range >= opts.minRangeM &&
        v.range <= opts.maxRangeM &&
        angularDistDeg(v, d) <= opts.supportDeg
      );
    });

  const clusters = [];
  let pool = [...usable];
  for (;;) {
    let best = null;
    for (const p of candidates) {
      const sup = supporters(p, pool);
      const scans = new Set(sup.map((d) => d.scanPointId)).size;
      if (scans < 2) continue;
      const score = sup.length * 10 + sup.reduce((s, d) => s + d.confidence, 0);
      if (!best || score > best.score) best = { point: p, score };
    }
    if (!best) break;
    let members = supporters(best.point, pool);
    const refined = leastSquaresPoint(members.map(ray)) ?? best.point;
    const again = supporters(refined, pool);
    if (new Set(again.map((d) => d.scanPointId)).size >= 2) members = again;
    clusters.push({ position: refined, members });
    pool = pool.filter((d) => !members.includes(d));
  }

  // single-view devices: merge duplicates of the same device within one panorama
  for (const d of pool) {
    const same = clusters.find(
      (c) =>
        !c.position &&
        c.members.some((m) => m.scanPointId === d.scanPointId && angularDistDeg(m, d) <= 3),
    );
    if (same) same.members.push(d);
    else clusters.push({ position: null, members: [d] });
  }
  return clusters;
}

// ---------------------------------------------------------------- registry
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

function anchorsOf(members) {
  return members
    .map((d) => ({ scanPointId: d.scanPointId, yaw: r2(d.yaw), pitch: r2(d.pitch) }))
    .sort((a, b) => a.scanPointId.localeCompare(b.scanPointId) || a.yaw - b.yaw);
}

function sameDevice(instance, cluster, opts) {
  if (instance.position && cluster.position)
    return dist(instance.position, cluster.position) <= opts.matchExistingM;
  return instance.anchors.some((a) =>
    cluster.members.some(
      (d) => d.scanPointId === a.scanPointId && angularDistDeg(a, d) <= opts.tolDeg,
    ),
  );
}

export function buildRegistry(detections, panoramas, previous = null, opts = DEFAULTS) {
  const scanPositions = Object.fromEntries(panoramas.map((p) => [p.scanPointId, p.position]));
  const clusters = clusterDetections(detections, scanPositions, opts);
  const eligible = clusters
    .filter(
      (c) =>
        c.members.some(isAuto) &&
        c.members.every((d) => (d.assetTypeId ?? "relay-615") === "relay-615"),
    )
    .sort(
      (a, b) =>
        b.members.filter(isAuto).length - a.members.filter(isAuto).length ||
        b.members.length - a.members.length ||
        Math.max(...b.members.map((d) => d.confidence)) -
          Math.max(...a.members.map((d) => d.confidence)),
    );

  const instances = [];
  const used = new Set();
  const log = [];
  for (const prev of previous?.instances ?? []) {
    const c = eligible.find((cl) => !used.has(cl) && sameDevice(prev, cl, opts));
    if (c) {
      used.add(c);
      instances.push({
        ...prev,
        position: c.position ? c.position.map(r3) : prev.position,
        anchors: anchorsOf(c.members),
        tolDeg: opts.tolDeg,
      });
      log.push(`kept    ${prev.id} (matched, ${c.members.length} view(s))`);
    } else {
      // The register is the component list: a device does not disappear because one CV run missed it.
      instances.push(prev);
      log.push(`kept    ${prev.id} (not in the current CV data, previous anchors kept)`);
    }
  }
  let n = instances.reduce((m, i) => Math.max(m, Number(i.id.match(/(\d+)$/)?.[1] ?? 0)), 0);
  // pick the strongest unregistered devices, then number them in physical order (wall by wall)
  const chosen = eligible
    .filter((c) => !used.has(c))
    .slice(0, Math.max(0, opts.maxInstances - instances.length));
  const key = (c) => (c.position ? [Math.round(c.position[0]), c.position[1]] : [Infinity, 0]);
  chosen.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1]);
  for (const c of chosen) {
    used.add(c);
    n += 1;
    const k = (n - 1) % VARIANTS.length;
    const nn = String(n).padStart(2, "0");
    instances.push({
      id: `DEMO-REL-${nn}`,
      assetTypeId: "relay-615",
      variant: VARIANTS[k],
      functionalLocation: `SWG-B / Panel ${nn}`,
      serialNo: `DEMO-00${nn}`,
      site: "Demo site (fictional)",
      position: c.position ? c.position.map(r3) : null,
      anchors: anchorsOf(c.members),
      tolDeg: opts.tolDeg,
      commissionedAt: PROFILES[k] === "empty" ? null : "2019-04-15",
      maintenanceIntervalMonths: 12,
      demoProfile: PROFILES[k],
      isDemo: true,
    });
    log.push(
      `created DEMO-REL-${nn} (${c.members.length} view(s), ${c.members.filter(isAuto).length} auto)`,
    );
  }

  const seedEntries = instances.flatMap(seedFor);
  const auto = detections.filter(isAuto);
  const linkedReview = clusters
    .filter((c) => c.position && c.members.some(isAuto))
    .flatMap((c) => c.members.filter((d) => !isAuto(d))).length;
  return {
    registry: {
      $comment:
        "GENERATED by scripts/build-registry.mjs - do not edit by hand. DEMO data except anchors/positions.",
      schema: 1,
      sourceDetectionsSha1: sha1(JSON.stringify(detections)).slice(0, 12),
      params: { tolDeg: opts.tolDeg, maxInstances: opts.maxInstances },
      stats: {
        detections: detections.length,
        autoDetections: auto.length,
        physicalDevices: clusters.length,
        devicesWithAutoDetection: clusters.filter((c) => c.members.some(isAuto)).length,
        multiViewDevices: clusters.filter((c) => c.position).length,
        reviewDetectionsOnAutoTaggedDevices: linkedReview,
      },
      instances,
      seedVersion: sha1(JSON.stringify(seedEntries)).slice(0, 12),
      seedEntries,
    },
    log,
  };
}

/** Deterministic DEMO history per profile (fixed dates; demo day 2026-10-03). */
function seedFor(inst) {
  const base = {
    instanceId: inst.id,
    company: "Demo Service Oy",
    firmwareBefore: null,
    firmwareAfter: null,
    workPermitRef: null,
    attachments: [],
    source: "seed",
    version: 1,
  };
  const e = (i, x) => ({
    id: `seed-${inst.id}-${i}`,
    ...base,
    ...x,
    createdAt: `${x.performedAt ?? x.createdOn}T08:00:00.000Z`,
    updatedAt: `${x.performedAt ?? x.createdOn}T08:00:00.000Z`,
  });
  const strip = ({ createdOn, ...rest }) => rest;
  const done = { status: "done", result: "ok", performedBy: "Demo Technician A" };
  switch (inst.demoProfile) {
    case "overdue":
      return [
        e(1, {
          ...done,
          kind: "inspection",
          title: "Annual inspection",
          performedAt: "2025-06-10",
          findings: "Visual check and event log reviewed. No alarms.",
          actions: "Cleaned front panel, checked terminals.",
          nextDueAt: "2026-06-10",
        }),
        e(2, {
          ...done,
          kind: "secondary_injection_test",
          title: "Secondary injection test",
          performedAt: "2024-05-22",
          findings: "Trip times within tolerance.",
          actions: "Test report filed.",
          nextDueAt: null,
        }),
      ].map(strip);
    case "open-fault":
      return [
        e(1, {
          ...done,
          kind: "inspection",
          title: "Annual inspection",
          performedAt: "2026-03-02",
          findings: "No remarks.",
          actions: "-",
          nextDueAt: "2027-03-02",
        }),
        e(2, {
          kind: "fault",
          status: "open",
          result: null,
          performedBy: "Demo Operator B",
          performedAt: null,
          createdOn: "2026-09-28",
          title: "HMI display flickering",
          findings: "Display flickers when the door is closed.",
          actions: "",
          nextDueAt: null,
        }),
      ].map(strip);
    case "ok":
      return [
        e(1, {
          ...done,
          kind: "inspection",
          title: "Annual inspection",
          performedAt: "2026-06-12",
          findings: "Thermal scan OK.",
          actions: "-",
          nextDueAt: "2027-06-12",
        }),
        e(2, {
          ...done,
          kind: "trip_test",
          title: "Trip test",
          performedAt: "2025-11-03",
          findings: "Breaker tripped correctly.",
          actions: "-",
          nextDueAt: null,
        }),
      ].map(strip);
    case "ok-firmware":
      return [
        e(1, {
          ...done,
          kind: "firmware_update",
          title: "Firmware update",
          performedAt: "2026-04-09",
          findings: "Vendor bulletin applied.",
          actions: "Firmware updated, settings verified after update.",
          nextDueAt: "2027-04-09",
          firmwareBefore: "DEMO-5.0",
          firmwareAfter: "DEMO-5.1",
        }),
      ].map(strip);
    default:
      return [];
  }
}

const sha1 = (s) => createHash("sha1").update(s).digest("hex");

// ---------------------------------------------------------------- CLI
function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  const opts = { ...DEFAULTS };
  const maxIdx = args.indexOf("--max");
  if (maxIdx >= 0) opts.maxInstances = Number(args[maxIdx + 1]);
  const read = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
  const outPath = resolve(root, "src/data/registry.generated.json");
  const previous =
    !args.includes("--fresh") && existsSync(outPath)
      ? read("src/data/registry.generated.json")
      : null;

  const { registry, log } = buildRegistry(
    read("src/data/detections.json"),
    read("src/data/panoramas.json"),
    previous,
    opts,
  );
  const json = JSON.stringify(registry, null, 2) + "\n";
  writeFileSync(outPath, json);
  mkdirSync(resolve(root, "public/field"), { recursive: true });
  writeFileSync(resolve(root, "public/field/registry.json"), json);

  for (const line of log) console.log(line);
  console.log(JSON.stringify(registry.stats));
  console.log(
    `${registry.instances.length} instance(s), ${registry.seedEntries.length} demo entries -> src/data/registry.generated.json + public/field/registry.json`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
