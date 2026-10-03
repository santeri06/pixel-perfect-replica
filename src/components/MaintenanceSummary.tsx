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
    <div className="mt-4 grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-4 md:gap-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="flex min-w-0 flex-col gap-2 p-3 min-[430px]:flex-row min-[430px]:items-center md:gap-4 md:p-5">
            <div
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${loaded && c.value > 0 ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground"}`}
            >
              <c.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-semibold text-secondary-foreground">
                {loaded ? c.value : "–"}
              </div>
              <div className="text-sm leading-tight text-muted-foreground md:text-xs">{c.label}</div>
            </div>
          </CardContent>
        </Card>
      ))}
      <p className="col-span-full self-center text-sm text-muted-foreground md:col-span-2 md:text-xs">
        Maintenance status of the {instances.length} relays in the demo device register (example
        data).
      </p>
    </div>
  );
}
