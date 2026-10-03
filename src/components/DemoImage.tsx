import { useState } from "react";
import { ImageOff } from "lucide-react";

export function DemoImage({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`flex min-h-48 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed bg-muted p-6 text-center ${className}`}>
        <ImageOff className="h-8 w-8 text-muted-foreground" />
        <div className="text-sm font-medium text-secondary-foreground">{alt}</div>
        <div className="font-mono text-xs text-muted-foreground">{src} — coming soon</div>
      </div>
    );
  }
  return <img src={src} alt={alt} onError={() => setFailed(true)} className={`w-full rounded-md border bg-muted object-contain ${className}`} />;
}
