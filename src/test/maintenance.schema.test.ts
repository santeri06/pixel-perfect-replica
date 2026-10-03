import { describe, expect, it } from "vitest";
import { maintenanceEntrySchema, maintenanceInputSchema } from "@/data/maintenance.schema";
import {
  addMonths,
  deviceStatus,
  type AssetInstance,
  type MaintenanceEntry,
} from "@/data/maintenance";
import { validInput } from "./fixtures";

const pathsOf = (input: unknown) => {
  const r = maintenanceInputSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => String(i.path[0]));
};

describe("maintenance schema", () => {
  it("accepts a complete done entry", () => {
    expect(pathsOf(validInput())).toEqual([]);
  });

  it("rejects done without a date of work", () => {
    expect(pathsOf(validInput({ performedAt: null }))).toContain("performedAt");
  });

  it("rejects done without a result", () => {
    expect(pathsOf(validInput({ result: null }))).toContain("result");
  });

  it("accepts an open fault notice without date or result", () => {
    expect(
      pathsOf(validInput({ kind: "fault", status: "open", performedAt: null, result: null })),
    ).toEqual([]);
  });

  it("rejects an unknown kind", () => {
    expect(pathsOf({ ...validInput(), kind: "coffee_break" })).toContain("kind");
  });

  it("rejects a date of work in the future", () => {
    expect(pathsOf(validInput({ performedAt: "2999-01-01" }))).toContain("performedAt");
  });

  it("rejects a next due date before the work", () => {
    expect(pathsOf(validInput({ nextDueAt: "2026-08-01" }))).toContain("nextDueAt");
  });

  it("validates stored entries with id and version", () => {
    const e: MaintenanceEntry = {
      ...validInput(),
      id: "x",
      version: 1,
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
    };
    expect(maintenanceEntrySchema.safeParse(e).success).toBe(true);
    expect(maintenanceEntrySchema.safeParse({ ...e, version: 0 }).success).toBe(false);
  });
});

describe("deviceStatus", () => {
  const dev: AssetInstance = {
    id: "DEV-1",
    assetTypeId: "relay-615",
    variant: "REF615",
    functionalLocation: "P1",
    serialNo: null,
    site: "t",
    position: null,
    anchors: [],
    tolDeg: 5,
    commissionedAt: "2019-04-15",
    maintenanceIntervalMonths: 12,
    isDemo: true,
  };
  const entry = (over: Partial<MaintenanceEntry>): MaintenanceEntry => ({
    ...validInput(),
    id: Math.random().toString(36),
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  it("is overdue when the last planned date has passed", () => {
    const s = deviceStatus(
      dev,
      [entry({ performedAt: "2025-06-10", nextDueAt: "2026-06-10" })],
      "2026-10-03",
    );
    expect(s.overdue).toBe(true);
    expect(s.nextDueAt).toBe("2026-06-10");
  });

  it("is no longer overdue after a new inspection", () => {
    const s = deviceStatus(
      dev,
      [
        entry({ performedAt: "2025-06-10", nextDueAt: "2026-06-10" }),
        entry({ performedAt: "2026-10-03", nextDueAt: "2027-10-03" }),
      ],
      "2026-10-03",
    );
    expect(s.overdue).toBe(false);
  });

  it("counts open notices of this device only", () => {
    const s = deviceStatus(
      dev,
      [
        entry({ status: "open", result: null }),
        entry({ instanceId: "OTHER", status: "open", result: null }),
      ],
      "2026-10-03",
    );
    expect(s.openCount).toBe(1);
  });

  it("adds calendar months with end-of-month clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2025-06-10", 12)).toBe("2026-06-10");
  });
});
