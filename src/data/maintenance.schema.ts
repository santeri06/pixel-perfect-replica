import { z } from "zod";
import {
  ENTRY_RESULT,
  ENTRY_SOURCES,
  ENTRY_STATUS,
  MAINTENANCE_KINDS,
  todayISO,
} from "./maintenance";

/**
 * One schema for the form, the local repository and (later) the HTTP API.
 * public/field/index.html is a separate app and repeats the same rules in plain JS.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD");
const optionalText = (max: number) => z.string().trim().max(max).nullable();

const base = z.object({
  instanceId: z.string().min(1, "Device is required"),
  kind: z.enum(MAINTENANCE_KINDS),
  status: z.enum(ENTRY_STATUS),
  title: z.string().trim().min(3, "Give a short title").max(120),
  performedAt: isoDate.nullable(),
  performedBy: z.string().trim().min(2, "Who did the work?").max(80),
  company: optionalText(80),
  findings: z.string().max(2000),
  actions: z.string().max(2000),
  result: z.enum(ENTRY_RESULT).nullable(),
  nextDueAt: isoDate.nullable(),
  firmwareBefore: optionalText(40),
  firmwareAfter: optionalText(40),
  workPermitRef: optionalText(60),
  attachments: z.array(z.object({ name: z.string().min(1), url: z.string().min(1) })).max(10),
  source: z.enum(ENTRY_SOURCES),
});

type BaseInput = z.infer<typeof base>;

function rules(v: BaseInput, ctx: z.RefinementCtx) {
  if (v.status === "done") {
    if (!v.performedAt)
      ctx.addIssue({
        code: "custom",
        path: ["performedAt"],
        message: "Required when the work is done",
      });
    if (!v.result)
      ctx.addIssue({ code: "custom", path: ["result"], message: "Required when the work is done" });
  }
  if (v.performedAt && v.performedAt > todayISO()) {
    ctx.addIssue({ code: "custom", path: ["performedAt"], message: "Cannot be in the future" });
  }
  if (v.nextDueAt && v.performedAt && v.nextDueAt <= v.performedAt) {
    ctx.addIssue({
      code: "custom",
      path: ["nextDueAt"],
      message: "Must be after the date of the work",
    });
  }
}

export const maintenanceInputSchema = base.superRefine(rules);

export const maintenanceEntrySchema = base
  .extend({
    id: z.string().min(1),
    version: z.number().int().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .superRefine(rules);

/** zod error -> { field: first message } for the form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
