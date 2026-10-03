#!/usr/bin/env node
/**
 * Reference triangulation for build_floorplan.py: runs clusterDetections() from
 * scripts/build-registry.mjs (unchanged) on src/data/detections.json and prints
 * [{ position: [x,y,z] | null, members: ["d1", ...] }] as JSON on stdout.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { clusterDetections } = await import(pathToFileURL(resolve(root, "scripts/build-registry.mjs")).href);
const read = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));
const detections = read("src/data/detections.json");
const scanPositions = Object.fromEntries(read("src/data/panoramas.json").map((p) => [p.scanPointId, p.position]));
const clusters = clusterDetections(detections, scanPositions);
process.stdout.write(JSON.stringify(clusters.map((c) => ({ position: c.position, members: c.members.map((d) => d.id) }))));
