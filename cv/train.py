"""Train YOLOv8n on the synthetic dataset.

Usage (PowerShell, from the cv folder):
    python train.py                 # sensible fast defaults (auto GPU/CPU)
    python train.py --epochs 20     # longer run
"""
import argparse
import shutil

import torch
from ultralytics import YOLO

from common import BEST_WEIGHTS, MODELS_DIR, OUTPUTS_DIR, RUNS_DIR, SYNTHETIC_DIR


def main() -> None:
    gpu = torch.cuda.is_available()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--epochs", type=int, default=30 if gpu else 8)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=32 if gpu else 16)
    ap.add_argument("--fraction", type=float, default=1.0, help="fraction of the train set to use")
    args = ap.parse_args()

    data = SYNTHETIC_DIR / "dataset.yaml"
    if not data.exists():
        raise SystemExit("No dataset found. Run generate_synthetic.py first.")

    device = 0 if gpu else "cpu"
    print(f"Device: {'GPU ' + torch.cuda.get_device_name(0) if gpu else 'CPU'} | "
          f"epochs={args.epochs} imgsz={args.imgsz} batch={args.batch}")

    MODELS_DIR.mkdir(exist_ok=True)
    model = YOLO(str(MODELS_DIR / "yolov8n.pt"))  # downloaded on first use
    model.train(
        data=str(data), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
        device=device, workers=4, fraction=args.fraction,
        project=str(RUNS_DIR), name="train", exist_ok=True,
        patience=10, plots=True,
        # the synthetic generator already does the heavy augmentation
        fliplr=0.0, mosaic=0.5, close_mosaic=2,
    )

    run = RUNS_DIR / "train"
    shutil.copy(run / "weights" / "best.pt", BEST_WEIGHTS)
    OUTPUTS_DIR.mkdir(exist_ok=True)
    for src, dst in [("results.png", "metrics.png"), ("val_batch0_pred.jpg", "sample_predictions.jpg")]:
        if (run / src).exists():
            shutil.copy(run / src, OUTPUTS_DIR / dst)

    metrics = YOLO(str(BEST_WEIGHTS)).val(data=str(data), imgsz=args.imgsz, device=device,
                                         project=str(RUNS_DIR), name="val", exist_ok=True, verbose=False)
    print(f"\nmAP50={metrics.box.map50:.3f}  mAP50-95={metrics.box.map:.3f}")
    print(f"Weights: {BEST_WEIGHTS}")
    print(f"Plots:   {OUTPUTS_DIR / 'metrics.png'}, {OUTPUTS_DIR / 'sample_predictions.jpg'}")


if __name__ == "__main__":
    main()
