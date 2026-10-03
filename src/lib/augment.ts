export interface AugmentSettings {
  count: number;
  brightness: [number, number]; // %
  contrast: [number, number]; // %
  rotation: number; // +/- deg
  skew: number; // +/- (0..0.5)
  scale: [number, number];
  noise: number; // 0..60
  blur: number; // max px
  occlusion: number; // max rects
  wear: number; // 0..1
  randomBackground: boolean;
}

export interface Variant {
  name: string;
  dataUrl: string;
  bbox: { x: number; y: number; w: number; h: number };
  params: Record<string, number | string>;
}

const SIZE = 512;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

function drawBackground(ctx: CanvasRenderingContext2D, random: boolean) {
  if (!random) {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, SIZE, SIZE);
    return;
  }
  const h = Math.floor(rnd(0, 360));
  ctx.fillStyle = `hsl(${h} ${rnd(5, 40)}% ${rnd(25, 80)}%)`;
  ctx.fillRect(0, 0, SIZE, SIZE);
  const tex = Math.floor(rnd(0, 3));
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = `hsl(${(h + 180) % 360} 20% 30%)`;
  if (tex === 1) {
    for (let x = 0; x < SIZE; x += 12) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, SIZE); ctx.stroke();
    }
  } else if (tex === 2) {
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? "#000" : "#fff";
      ctx.fillRect(rnd(0, SIZE), rnd(0, SIZE), 3, 3);
    }
  }
  ctx.globalAlpha = 1;
}

export async function generateVariants(img: HTMLImageElement, s: AugmentSettings, onProgress?: (n: number) => void): Promise<Variant[]> {
  const out: Variant[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const fit = (SIZE * 0.55) / Math.max(img.width, img.height);
  const w = img.width * fit;
  const h = img.height * fit;

  for (let n = 0; n < s.count; n++) {
    const p = {
      brightness: Math.round(rnd(...s.brightness)),
      contrast: Math.round(rnd(...s.contrast)),
      rotation: +rnd(-s.rotation, s.rotation).toFixed(1),
      skewX: +rnd(-s.skew, s.skew).toFixed(2),
      skewY: +rnd(-s.skew, s.skew).toFixed(2),
      scale: +rnd(...s.scale).toFixed(2),
      blur: +rnd(0, s.blur).toFixed(1),
      tx: Math.round(rnd(-50, 50)),
      ty: Math.round(rnd(-50, 50)),
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = "none";
    drawBackground(ctx, s.randomBackground);

    const m = new DOMMatrix()
      .translate(SIZE / 2 + p.tx, SIZE / 2 + p.ty)
      .rotate(p.rotation)
      .multiply(new DOMMatrix([1, p.skewY, p.skewX, 1, 0, 0]))
      .scale(p.scale);

    ctx.setTransform(m);
    ctx.filter = `brightness(${p.brightness}%) contrast(${p.contrast}%) blur(${p.blur}px)`;
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.filter = "none";

    // bbox: transform the 4 corners
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) =>
      m.transformPoint(new DOMPoint(x, y)),
    );
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const x0 = Math.max(0, Math.min(...xs)), y0 = Math.max(0, Math.min(...ys));
    const x1 = Math.min(SIZE, Math.max(...xs)), y1 = Math.min(SIZE, Math.max(...ys));

    // label wear: scratches + fading within object
    if (s.wear > 0) {
      ctx.save();
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.clip();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgba(255,255,255,${rnd(0, s.wear * 0.4)})`;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      const scratches = Math.round(s.wear * 25);
      for (let i = 0; i < scratches; i++) {
        ctx.strokeStyle = `rgba(${Math.random() > 0.5 ? "255,255,255" : "40,40,40"},${rnd(0.3, 0.8)})`;
        ctx.lineWidth = rnd(0.5, 2);
        ctx.beginPath();
        const sx = rnd(x0, x1), sy = rnd(y0, y1);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + rnd(-60, 60), sy + rnd(-20, 20));
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // occlusion
    const occ = Math.floor(rnd(0, s.occlusion + 1));
    for (let i = 0; i < occ; i++) {
      ctx.fillStyle = `hsl(${rnd(0, 360)} 10% ${rnd(10, 60)}%)`;
      const ow = rnd(20, (x1 - x0) * 0.4), oh = rnd(20, (y1 - y0) * 0.4);
      ctx.fillRect(rnd(x0 - ow / 2, x1 - ow / 2), rnd(y0 - oh / 2, y1 - oh / 2), ow, oh);
    }

    // gaussian-ish noise
    if (s.noise > 0) {
      const d = ctx.getImageData(0, 0, SIZE, SIZE);
      for (let i = 0; i < d.data.length; i += 4) {
        const g = (Math.random() + Math.random() + Math.random() - 1.5) * s.noise;
        d.data[i] = d.data[i]! + g; d.data[i + 1] = d.data[i + 1]! + g; d.data[i + 2] = d.data[i + 2]! + g;
      }
      ctx.putImageData(d, 0, 0);
    }

    out.push({
      name: `synthetic_${String(n + 1).padStart(4, "0")}.png`,
      dataUrl: canvas.toDataURL("image/png"),
      bbox: { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) },
      params: { ...p, occlusions: occ },
    });
    onProgress?.(n + 1);
    if (n % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

export async function downloadZip(variants: Variant[], className: string) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const imgs = zip.folder("images")!;
  variants.forEach((v) => imgs.file(v.name, v.dataUrl.split(",")[1]!, { base64: true }));
  zip.file(
    "labels.json",
    JSON.stringify(
      { imageSize: { width: SIZE, height: SIZE }, class: className, annotations: variants.map((v) => ({ file: `images/${v.name}`, bbox: v.bbox, params: v.params })) },
      null,
      2,
    ),
  );
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "veo360_synthetic_dataset.zip";
  a.click();
  URL.revokeObjectURL(a.href);
}
