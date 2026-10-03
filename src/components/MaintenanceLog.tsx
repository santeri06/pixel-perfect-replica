import { AlertTriangle, Plus, Smartphone, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FormPreset } from "@/components/MaintenanceForm";
import {
  KIND_LABELS,
  RESULT_LABELS,
  STATUS_LABELS,
  deviceStatus,
  type AssetInstance,
  type MaintenanceEntry,
} from "@/data/maintenance";
import { isStoragePersistent, useMaintenanceEntries } from "@/lib/useMaintenance";

export type Doc = { title: string; url: string };
const VARIANT_DOC = /^(RE[A-Z]615)\b/;

/**
 * REF615, RET615 and REM615 have their own product guide and application manual; the front panel
 * only shows "615", so the variant must come from the device register, never from the image.
 */
export function docsForVariant(
  docs: Doc[],
  variant: string | undefined,
): { docs: Doc[]; warning: string | null } {
  const specific = docs.filter((d) => VARIANT_DOC.test(d.title));
  if (specific.length === 0) return { docs, warning: null };
  const common = docs.filter((d) => !VARIANT_DOC.test(d.title));
  if (!variant || variant === "unknown") {
    return {
      docs,
      warning: "Variant unknown - check the rating plate before using a variant-specific manual.",
    };
  }
  const own = specific.filter((d) => d.title.startsWith(variant));
  const others = [...new Set(specific.map((d) => d.title.match(VARIANT_DOC)?.[1]))].join(", ");
  return {
    docs: [...own, ...common],
    warning: own.length
      ? null
      : `No ${variant} product guide or application manual in the library yet. Do not use the ${others} documents for this device.`,
  };
}

const resultCls = {
  ok: "bg-success text-white",
  remarks: "bg-warning text-secondary-foreground",
  fault: "bg-destructive text-white",
} as const;

function EntryRow({
  e,
  onUpdate,
}: {
  e: MaintenanceEntry;
  onUpdate: (e: MaintenanceEntry) => void;
}) {
  const date = e.performedAt ?? `reported ${e.createdAt.slice(0, 10)}`;
  return (
    <li className="relative">
      <span
        className={`absolute -left-[22px] top-1 h-3 w-3 rounded-full ${e.status === "done" ? "bg-primary" : "bg-warning"}`}
      />
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>{date}</span>
        <span>· {KIND_LABELS[e.kind]}</span>
        {e.status !== "done" ? (
          <Badge className="bg-warning text-secondary-foreground">{STATUS_LABELS[e.status]}</Badge>
        ) : (
          e.result && <Badge className={resultCls[e.result]}>{RESULT_LABELS[e.result]}</Badge>
        )}
        {e.source === "field-app" && <Badge variant="outline">Field App</Badge>}
      </div>
      <div className="text-sm font-medium text-secondary-foreground">{e.title}</div>
      {e.findings && <div className="text-sm">{e.findings}</div>}
      {e.actions && e.actions !== "-" && (
        <div className="text-sm text-muted-foreground">Actions: {e.actions}</div>
      )}
      {(e.firmwareBefore || e.firmwareAfter) && (
        <div className="text-xs text-muted-foreground">
          Firmware {e.firmwareBefore ?? "?"} → {e.firmwareAfter ?? "?"}
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        {e.performedBy}
        {e.company ? ` · ${e.company}` : ""}
        {e.nextDueAt ? ` · next due ${e.nextDueAt}` : ""}
      </div>
      {e.status !== "done" && (
        <Button size="sm" variant="outline" className="mt-1 h-7" onClick={() => onUpdate(e)}>
          <Wrench className="mr-1 h-3.5 w-3.5" /> Update / close
        </Button>
      )}
    </li>
  );
}

/** Device details from the register + its own maintenance log (never another device's entries). */
export function MaintenanceLog({
  instance,
  onAdd,
  onUpdate,
}: {
  instance: AssetInstance;
  onAdd: (preset?: FormPreset) => void;
  onUpdate: (e: MaintenanceEntry) => void;
}) {
  const entries = useMaintenanceEntries(instance.id);
  const st = deviceStatus(instance, entries);
  return (
    <section className="space-y-5 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-secondary-foreground">Device</h3>
        {instance.isDemo && (
          <Badge variant="outline" className="border-warning text-secondary-foreground">
            Example data
          </Badge>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Location</dt>
          <dd className="font-medium text-secondary-foreground">{instance.functionalLocation}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Variant</dt>
          <dd className="font-mono text-secondary-foreground">{instance.variant}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Serial number</dt>
          <dd className="font-mono text-secondary-foreground">{instance.serialNo ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Commissioned</dt>
          <dd className="text-secondary-foreground">{instance.commissionedAt ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Next maintenance</dt>
          <dd className="flex items-center gap-1.5 text-secondary-foreground">
            {st.nextDueAt ?? "not planned"}
            {st.overdue && <Badge variant="destructive">Overdue</Badge>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Open notices</dt>
          <dd
            className={
              st.openCount ? "font-semibold text-destructive" : "text-secondary-foreground"
            }
          >
            {st.openCount}
          </dd>
        </div>
      </dl>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-secondary-foreground">Maintenance log</h4>
          <Button size="sm" onClick={() => onAdd()}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add maintenance entry
          </Button>
        </div>
        {!isStoragePersistent() && (
          <p className="mb-2 flex items-start gap-2 rounded-md bg-warning/10 p-2 text-xs text-secondary-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            Browser storage is blocked: entries are kept only until this page is reloaded.
          </p>
        )}
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No maintenance recorded for this device yet.
          </p>
        ) : (
          <ol className="space-y-3 border-l-2 border-primary/30 pl-4">
            {entries.map((e) => (
              <EntryRow key={e.id} e={e} onUpdate={onUpdate} />
            ))}
          </ol>
        )}
      </div>

      <a
        href={`/field/index.html?asset=${encodeURIComponent(instance.id)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <Smartphone className="h-4 w-4" /> Open in Field App
      </a>
    </section>
  );
}
