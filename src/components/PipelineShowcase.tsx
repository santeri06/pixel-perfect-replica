import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DemoImage } from "@/components/DemoImage";

const augmentations = ["Lighting", "Angle", "Scale", "Noise", "Blur", "Occlusion", "Label wear", "Background randomization"];

export function SyntheticShowcase() {
  return (
    <Card className="mb-8">
      <CardHeader><CardTitle className="text-base">Pipeline output</CardTitle></CardHeader>
      <CardContent>
        <div className="grid min-w-0 items-center gap-4 lg:grid-cols-[1fr_auto_2fr]">
          <div className="min-w-0">
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Reference image</div>
            <DemoImage src="/demo/reference.jpg" alt="Original reference image" />
          </div>
          <ArrowRight className="mx-auto h-8 w-8 rotate-90 text-primary lg:rotate-0" />
          <div className="min-w-0">
            <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Generated training images</div>
            <DemoImage src="/demo/synthetic_preview.jpg" alt="Grid of generated training images" />
          </div>
        </div>
        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Augmentations used</div>
          <div className="flex flex-wrap gap-2">
            {augmentations.map((a) => <span key={a} className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">{a}</span>)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TrainingShowcase() {
  return (
    <div className="mb-8 grid min-w-0 gap-4 lg:grid-cols-2">
      <Card className="min-w-0 overflow-hidden lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Training curves</CardTitle></CardHeader>
        <CardContent className="min-w-0 overflow-x-auto"><DemoImage src="/demo/training_curves.png" alt="Training curves" className="max-md:min-w-[500px]" /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Example predictions</CardTitle></CardHeader>
        <CardContent><DemoImage src="/demo/predictions_example.jpg" alt="Example predictions" /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Strong vs. review</CardTitle></CardHeader>
        <CardContent><DemoImage src="/demo/strong_vs_review.jpg" alt="Strong detections vs. sent to review" /></CardContent>
      </Card>
    </div>
  );
}
