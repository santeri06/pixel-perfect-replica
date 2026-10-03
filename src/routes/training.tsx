import { createFileRoute } from "@tanstack/react-router";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/AppShell";
import { TrainingShowcase } from "@/components/PipelineShowcase";
import { trainingStats, trainingCurve, examplePredictions } from "@/data/training";

export const Route = createFileRoute("/training")({
  head: () => ({
    meta: [
      { title: "Model Training — VEO360 AutoTag" },
      { name: "description", content: "Detection and OCR model training metrics and example predictions." },
      { property: "og:title", content: "Model Training — VEO360 AutoTag" },
      { property: "og:description", content: "Detection and OCR model training metrics and example predictions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TrainingPage,
});

function TrainingPage() {
  const stats = [
    { label: "Dataset size", value: trainingStats.datasetSize.toLocaleString() },
    { label: "Epochs", value: trainingStats.epochs },
    { label: "Detection mAP@0.5", value: trainingStats.map.toFixed(3) },
    { label: "OCR accuracy", value: `${(trainingStats.ocrAccuracy * 100).toFixed(1)}%` },
  ];
  return (
    <>
      <PageHeader title="Training" subtitle="Label detector + OCR check, trained on synthetic data only." />
      <TrainingShowcase />
      <div className="grid grid-cols-2 gap-4 max-[359px]:grid-cols-1 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}><CardContent className="p-5"><div className="text-xs text-muted-foreground">{s.label}</div><div className="mt-1 text-2xl font-semibold text-secondary-foreground">{s.value}</div></CardContent></Card>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Loss & accuracy</CardTitle></CardHeader>
        <CardContent className="h-80 min-w-0 overflow-x-auto">
          <div className="h-full min-w-[500px] md:min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trainingCurve}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="epoch" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis yAxisId="l" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 1]} stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip />
              <Legend />
              <Line yAxisId="l" dataKey="loss" name="Train loss" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
              <Line yAxisId="l" dataKey="valLoss" name="Val loss" stroke="var(--chart-5)" strokeWidth={2} dot={false} strokeDasharray="4 3" />
              <Line yAxisId="r" dataKey="accuracy" name="Accuracy" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      <h2 className="mb-3 mt-8 text-lg font-semibold text-secondary-foreground">Example predictions</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {examplePredictions.map((p) => (
          <Card key={p.id} className="overflow-hidden">
            <div className="relative aspect-[4/3] overflow-hidden bg-muted">
              <div className="absolute inset-0" style={{ backgroundImage: "url(/panorama-switchgear.jpg)", backgroundSize: `${100 / (p.box[2]! / 100) / 4}% auto`, backgroundPosition: `${(p.box[0]! / (100 - p.box[2]! * 4)) * 100}% ${p.box[1]!}%` }} />
              <div className="absolute left-[37.5%] top-[30%] h-[40%] w-[25%] border-2 border-primary">
                <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{p.label} {Math.round(p.confidence * 100)}%</span>
              </div>
            </div>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">OCR result</div>
              <div className="font-mono text-lg font-semibold text-secondary-foreground">{p.ocr}</div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
