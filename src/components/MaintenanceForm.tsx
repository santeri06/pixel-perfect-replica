import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ENTRY_RESULT,
  ENTRY_STATUS,
  KIND_LABELS,
  MAINTENANCE_KINDS,
  RESULT_LABELS,
  STATUS_LABELS,
  todayISO,
  type AssetInstance,
  type EntryResult,
  type EntryStatus,
  type MaintenanceEntry,
  type MaintenanceInput,
  type MaintenanceKind,
} from "@/data/maintenance";
import { ValidationError, VersionConflictError } from "@/lib/maintenanceLocal";
import { getMaintenanceRepo } from "@/lib/useMaintenance";

const NAME_KEY = "veo.performedBy";

interface Draft {
  kind: MaintenanceKind;
  status: EntryStatus;
  title: string;
  performedAt: string;
  performedBy: string;
  company: string;
  findings: string;
  actions: string;
  result: EntryResult | "";
  nextDueAt: string;
  firmwareBefore: string;
  firmwareAfter: string;
  workPermitRef: string;
}

export type FormPreset = Partial<Pick<Draft, "kind" | "status" | "title">>;

function savedName() {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function emptyDraft(preset: FormPreset = {}): Draft {
  const kind = preset.kind ?? "inspection";
  const status = preset.status ?? "done";
  return {
    kind,
    status,
    title: preset.title ?? (kind === "fault" ? "" : KIND_LABELS[kind]),
    performedAt: status === "done" ? todayISO() : "",
    performedBy: savedName(),
    company: "",
    findings: "",
    actions: "",
    result: "",
    nextDueAt: "",
    firmwareBefore: "",
    firmwareAfter: "",
    workPermitRef: "",
  };
}

function fromEntry(e: MaintenanceEntry): Draft {
  return {
    kind: e.kind,
    status: e.status,
    title: e.title,
    performedAt: e.performedAt ?? "",
    performedBy: e.performedBy,
    company: e.company ?? "",
    findings: e.findings,
    actions: e.actions,
    result: e.result ?? "",
    nextDueAt: e.nextDueAt ?? "",
    firmwareBefore: e.firmwareBefore ?? "",
    firmwareAfter: e.firmwareAfter ?? "",
    workPermitRef: e.workPermitRef ?? "",
  };
}

const orNull = (s: string) => (s.trim() === "" ? null : s.trim());

function toInput(d: Draft, instanceId: string, entry: MaintenanceEntry | null): MaintenanceInput {
  return {
    instanceId,
    kind: d.kind,
    status: d.status,
    title: d.title.trim(),
    performedAt: orNull(d.performedAt),
    performedBy: d.performedBy.trim(),
    company: orNull(d.company),
    findings: d.findings,
    actions: d.actions,
    result: d.result === "" ? null : d.result,
    nextDueAt: orNull(d.nextDueAt),
    firmwareBefore: orNull(d.firmwareBefore),
    firmwareAfter: orNull(d.firmwareAfter),
    workPermitRef: orNull(d.workPermitRef),
    attachments: entry?.attachments ?? [],
    source: entry?.source ?? "autotag",
  };
}

const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface Props {
  instance: AssetInstance;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing entry to update, e.g. closing an open fault notice. */
  entry?: MaintenanceEntry | null | undefined;
  preset?: FormPreset | undefined;
}

export function MaintenanceForm({ instance, open, onOpenChange, entry = null, preset }: Props) {
  const [draft, setDraft] = useState<Draft>(() => (entry ? fromEntry(entry) : emptyDraft(preset)));
  const [base, setBase] = useState<MaintenanceEntry | null>(entry);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // reset only when the dialog opens (or switches entry), so typing is never overwritten by a re-render
  useEffect(() => {
    if (!open) return;
    setDraft(entry ? fromEntry(entry) : emptyDraft(preset));
    setBase(entry);
    setErrors({});
  }, [open, entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const done = draft.status === "done";

  const setKind = (kind: MaintenanceKind) =>
    setDraft((d) => ({
      ...d,
      kind,
      title:
        d.title === "" || d.title === KIND_LABELS[d.kind]
          ? kind === "fault"
            ? ""
            : KIND_LABELS[kind]
          : d.title,
    }));
  const setStatus = (status: EntryStatus) =>
    setDraft((d) => ({
      ...d,
      status,
      performedAt: status === "done" && !d.performedAt ? todayISO() : d.performedAt,
    }));

  const submit = () => {
    const input = toInput(draft, instance.id, base);
    const repo = getMaintenanceRepo();
    try {
      if (base) repo.updateEntry(base.id, input, base.version);
      else repo.createEntry(input);
      try {
        window.localStorage.setItem(NAME_KEY, input.performedBy);
      } catch {
        /* name memory is a convenience only */
      }
      toast.success(`${base ? "Entry updated" : "Entry saved"} · ${instance.functionalLocation}`);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ValidationError) {
        setErrors(e.fields);
      } else if (e instanceof VersionConflictError) {
        toast.error(
          "This entry was changed in another app. The latest version is now shown - check it and save again.",
        );
        setBase(e.current);
        setDraft(fromEntry(e.current));
      } else {
        toast.error(e instanceof Error ? e.message : "Could not save the entry");
      }
    }
  };

  const field = (name: keyof Draft, label: string, control: ReactNode, required = false) => (
    <div className="space-y-1">
      <Label
        htmlFor={`mf-${name}`}
        className={required ? "after:ml-0.5 after:text-destructive after:content-['*']" : ""}
      >
        {label}
      </Label>
      {control}
      {errors[name] && <p className="text-xs text-destructive">{errors[name]}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {base
              ? "Update maintenance entry"
              : draft.kind === "fault"
                ? "Report a fault"
                : "Add maintenance entry"}
          </DialogTitle>
          <DialogDescription>
            Device <b className="text-foreground">{instance.functionalLocation}</b> ·{" "}
            {instance.variant} · S/N {instance.serialNo ?? "unknown"}
            {instance.isDemo && " · example data"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {field(
            "kind",
            "Type of work",
            <select
              id="mf-kind"
              className={selectCls}
              value={draft.kind}
              onChange={(e) => setKind(e.target.value as MaintenanceKind)}
            >
              {MAINTENANCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>,
            true,
          )}
          {field(
            "status",
            "Status",
            <select
              id="mf-status"
              className={selectCls}
              value={draft.status}
              onChange={(e) => setStatus(e.target.value as EntryStatus)}
            >
              {ENTRY_STATUS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>,
            true,
          )}
          <div className="col-span-2">
            {field(
              "title",
              "Title",
              <Input
                id="mf-title"
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Annual inspection"
              />,
              true,
            )}
          </div>
          {field(
            "performedAt",
            "Date of work",
            <Input
              id="mf-performedAt"
              type="date"
              max={todayISO()}
              value={draft.performedAt}
              onChange={(e) => set("performedAt", e.target.value)}
            />,
            done,
          )}
          {field(
            "result",
            "Result",
            <select
              id="mf-result"
              className={selectCls}
              value={draft.result}
              onChange={(e) => set("result", e.target.value as EntryResult | "")}
            >
              <option value="">-</option>
              {ENTRY_RESULT.map((r) => (
                <option key={r} value={r}>
                  {RESULT_LABELS[r]}
                </option>
              ))}
            </select>,
            done,
          )}
          {field(
            "performedBy",
            draft.status === "open" ? "Reported by" : "Performed by",
            <Input
              id="mf-performedBy"
              value={draft.performedBy}
              onChange={(e) => set("performedBy", e.target.value)}
              autoComplete="name"
            />,
            true,
          )}
          {field(
            "company",
            "Company",
            <Input
              id="mf-company"
              value={draft.company}
              onChange={(e) => set("company", e.target.value)}
            />,
          )}
          <div className="col-span-2">
            {field(
              "findings",
              draft.kind === "fault" ? "What is wrong?" : "Findings",
              <Textarea
                id="mf-findings"
                rows={2}
                value={draft.findings}
                onChange={(e) => set("findings", e.target.value)}
              />,
            )}
          </div>
          <div className="col-span-2">
            {field(
              "actions",
              "Actions taken",
              <Textarea
                id="mf-actions"
                rows={2}
                value={draft.actions}
                onChange={(e) => set("actions", e.target.value)}
              />,
            )}
          </div>
          {field(
            "nextDueAt",
            "Next maintenance due",
            <Input
              id="mf-nextDueAt"
              type="date"
              value={draft.nextDueAt}
              onChange={(e) => set("nextDueAt", e.target.value)}
            />,
          )}
          {field(
            "workPermitRef",
            "Work permit ref.",
            <Input
              id="mf-workPermitRef"
              value={draft.workPermitRef}
              onChange={(e) => set("workPermitRef", e.target.value)}
            />,
          )}
          {draft.kind === "firmware_update" && (
            <>
              {field(
                "firmwareBefore",
                "Firmware before",
                <Input
                  id="mf-firmwareBefore"
                  value={draft.firmwareBefore}
                  onChange={(e) => set("firmwareBefore", e.target.value)}
                />,
              )}
              {field(
                "firmwareAfter",
                "Firmware after",
                <Input
                  id="mf-firmwareAfter"
                  value={draft.firmwareAfter}
                  onChange={(e) => set("firmwareAfter", e.target.value)}
                />,
              )}
            </>
          )}
        </div>
        {done && !draft.nextDueAt && instance.maintenanceIntervalMonths && (
          <p className="text-xs text-muted-foreground">
            Empty due date: periodic work (inspection, tests) sets it to the date of work +{" "}
            {instance.maintenanceIntervalMonths} months.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>{base ? "Save changes" : "Save entry"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
