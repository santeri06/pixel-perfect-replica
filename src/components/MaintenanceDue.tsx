import { useNavigate } from "@tanstack/react-router";
import { Box, Map as MapIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deviceStatus } from "@/data/maintenance";
import { instances } from "@/data/registry";
import { useStore } from "@/lib/store";
import { useMaintenanceFile } from "@/lib/useMaintenance";

/** Devices of the register with an open notice or overdue maintenance (live from the log). */
export function MaintenanceDue() {
  const file = useMaintenanceFile();
  const { detections } = useStore();
  const navigate = useNavigate();
  const rows = instances
    .map((i) => ({ i, s: deviceStatus(i, file.entries) }))
    .filter(({ s }) => s.overdue || s.openCount > 0)
    .sort((a, b) => Number(b.s.overdue) - Number(a.s.overdue) || a.i.id.localeCompare(b.i.id));

  const openTwin = (id: string, scan: string | undefined) => {
    const own = detections.filter((d) => d.instanceId === id && d.status !== "rejected");
    const det = own.find((d) => d.scanPointId === scan) ?? own[0];
    const s = det?.scanPointId ?? scan;
    if (!s) return;
    navigate({ to: "/twin", search: det ? { scan: s, detection: det.id } : { scan: s } });
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Maintenance due</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open notices or overdue maintenance.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map(({ i, s }) => (
              <li
                key={i.id}
                className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="min-w-0">
                  <div className="font-medium text-secondary-foreground">
                    {i.id} <span className="font-mono text-xs text-muted-foreground">{i.variant}</span>
                  </div>
                  <div className="text-sm text-muted-foreground">{i.functionalLocation}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {s.overdue && (
                      <Badge className="bg-destructive text-white">
                        Overdue{s.nextDueAt ? ` since ${s.nextDueAt}` : ""}
                      </Badge>
                    )}
                    {s.openCount > 0 && (
                      <Badge variant="outline" className="border-destructive text-destructive">
                        {s.openCount} open notice{s.openCount > 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 md:min-h-0"
                    onClick={() => navigate({ to: "/floorplan", search: { device: i.id } })}
                  >
                    <MapIcon className="mr-1 h-4 w-4" /> Show on floor plan
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 md:min-h-0"
                    disabled={!i.anchors[0]}
                    onClick={() => openTwin(i.id, i.anchors[0]?.scanPointId)}
                  >
                    <Box className="mr-1 h-4 w-4" /> Open in twin
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
