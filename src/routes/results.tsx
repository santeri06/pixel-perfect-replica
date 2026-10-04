import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/AppShell";
import { results } from "@/data/results";

export const Route = createFileRoute("/results")({
  head: () => ({
    meta: [
      { title: "Results — VEO360 AutoTag" },
      { name: "description", content: "Pipeline results: images analysed, auto-tag accuracy and human review outcomes." },
      { property: "og:title", content: "Results — VEO360 AutoTag" },
      { property: "og:description", content: "Pipeline results: images analysed, auto-tag accuracy and human review outcomes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ResultsPage,
});

const flow = ["Reference image", "Synthetic data", "Model", "OCR check", "Auto-tag or Human review"];

function ResultsPage() {
  const r = results;
  const stats = [
    { label: "Images analysed", value: r.imagesAnalysed, sub: `${r.scanPoints} scan points` },
    { label: "Auto-tagged", value: r.autoTagged, sub: `${r.autoTaggedCorrect}/${r.autoTagged} correct` },
    { label: "Sent to review", value: r.sentToReview, sub: `${r.reviewCorrect}/${r.sentToReview} correct suggestions` },
    { label: "Auto-tag precision", value: r.autoTagged ? `${Math.round((r.autoTaggedCorrect / r.autoTagged) * 100)}%` : "–", sub: "High-confidence + OCR confirmed" },
  ];
  return (
    <>
      <PageHeader title="Results" subtitle={`Training data: ${r.trainingData}`} />
      <div className="grid grid-cols-2 gap-3 max-[359px]:grid-cols-1 md:grid-cols-2 md:gap-4 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}><CardContent className="min-w-0 p-3 md:p-6">
            <div className="text-sm text-muted-foreground">{s.label}</div>
            <div className="mt-1 text-3xl font-bold text-secondary-foreground md:text-4xl">{s.value}</div>
            <div className="mt-1 text-sm leading-tight text-muted-foreground md:text-xs">{s.sub}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">How it works</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            {flow.map((f, i) => (
              <div key={f} className="flex max-w-full items-center gap-2">
                <span className={`rounded-md px-3 py-2 text-sm font-medium ${i === flow.length - 1 ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>{f}</span>
                {i < flow.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm">High-confidence + OCR confirmed → tagged automatically. Uncertain → human review. Every review decision can become new training data.</p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Before vs after</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {(["manual", "autotag"] as const).map((col) => (
            <div key={col} className={`rounded-lg p-5 ${col === "autotag" ? "border-2 border-primary" : "border"}`}>
              <div className={`mb-3 text-xs font-semibold uppercase ${col === "autotag" ? "text-primary" : "text-muted-foreground"}`}>{col === "manual" ? "Manual tagging" : "AutoTag"}</div>
              <dl className="space-y-2">
                {r.beforeAfter.map((b) => (
                  <div key={b.metric} className="flex flex-col gap-1 text-sm">
                    <div className="flex justify-between gap-3"><dt className="min-w-0">{b.metric}</dt><dd className="shrink-0 text-right font-semibold text-secondary-foreground">{b[col]}</dd></div>
                    {b[`${col}Note`] && <div className="text-xs text-muted-foreground">{b[`${col}Note`]}</div>}
                  </div>
                ))}
              </dl>
            </div>
          ))}
          <p className="text-sm text-muted-foreground">{r.beforeAfterNote}</p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Next steps</CardTitle></CardHeader>
        <CardContent>
          <ul className="grid gap-2 md:grid-cols-2">
            {r.nextSteps.map((n) => (
              <li key={n} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-primary" />{n}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
