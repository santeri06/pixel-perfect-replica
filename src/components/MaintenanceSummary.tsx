import { CalendarClock, LifeBuoy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { deviceStatus } from "@/data/maintenance";
import { instances } from "@/data/registry";
import { useMaintenanceFile } from "@/lib/useMaintenance";

/** Dashboard cards computed from the per-device maintenance log (updates live from the Field App). */
export function MaintenanceSummary() {
  const file = useMaintenanceFile();
  const loaded = file.seedVersion !== "";
  const statuses = instances.map((i) => deviceStatus(i, file.entries));
  const cards = [
    {
      icon: CalendarClock,
      label: "Overdue maintenance",
      value: statuses.filter((s) => s.overdue).length,
    },
    { icon: LifeBuoy, label: "Open notices", value: statuses.reduce((n, s) => n + s.openCount, 0) },
  ];
  return (
    <div className="mt-4 grid gap-4 md:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="flex items-center gap-4 p-5">
            <div
              className={`grid h-10 w-10 place-items-center rounded-md ${loaded && c.value > 0 ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground"}`}
            >
              <c.icon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-2xl font-semibold text-secondary-foreground">
                {loaded ? c.value : "–"}
              </div>
              <div className="text-xs text-muted-foreground">{c.label}</div>
            </div>
          </CardContent>
        </Card>
      ))}
      <p className="self-center text-xs text-muted-foreground md:col-span-2">
        Maintenance status of the {instances.length} relays in the demo device register (example
        data).
      </p>
    </div>
  );
}
