import type { MaintenanceInput } from "@/data/maintenance";

/** A complete, valid maintenance input; override fields per test. */
export const validInput = (over: Partial<MaintenanceInput> = {}): MaintenanceInput => ({
  instanceId: "DEV-1",
  kind: "inspection",
  status: "done",
  title: "Annual inspection",
  performedAt: "2026-09-01",
  performedBy: "Test Technician",
  company: null,
  findings: "OK",
  actions: "",
  result: "ok",
  nextDueAt: null,
  firmwareBefore: null,
  firmwareAfter: null,
  workPermitRef: null,
  attachments: [],
  source: "autotag",
  ...over,
});
