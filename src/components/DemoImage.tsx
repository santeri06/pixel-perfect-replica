import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

export function DemoImage({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");

  // Probe the image after mount so missing files always show the placeholder.
  useEffect(() => {
    setState("loading");
    const img = new Image();
    img.onload = () => setState(img.naturalWidth > 0 ? "ok" : "failed");
    img.onerror = () => setState("failed");
    img.src = src;
  }, [src]);

  if (state === "ok") {
    return <img src={src} alt={alt} className={`w-full rounded-md border bg-muted object-contain ${className}`} />;
  }
  return (
    <div className={`flex min-h-48 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed bg-muted p-6 text-center ${className}`}>
      <ImageOff className="h-8 w-8 text-muted-foreground" />
      <div className="text-sm font-medium text-secondary-foreground">{alt}</div>
      <div className="font-mono text-xs text-muted-foreground">{state === "loading" ? "Loading…" : `${src} — coming soon`}</div>
    </div>
  );
}
