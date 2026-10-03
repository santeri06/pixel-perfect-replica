"""Detection pipeline shared by infer.py and api.py: YOLO -> label crop -> OCR -> fuzzy match."""
import json
import re
from pathlib import Path

import cv2
import numpy as np
from rapidfuzz import fuzz

from common import ASSET_LIBRARY, BEST_WEIGHTS
from geometry import pixel_to_yaw_pitch

# The detector is trained on a single device type, so a 'device' box without readable
# text still maps to this asset type (with a lower confidence).
DEFAULT_ASSET_TYPE = "relay-615"
MATCH_THRESHOLD = 65  # rapidfuzz score 0-100
ASPECT_RANGE = (0.8, 2.3)     # plausible width/height of a relay front seen at an angle
MAX_ABS_PITCH = 45            # degrees; only applied when the camera pose is known
UNCONFIRMED_MIN_CONF = 0.5   # detector confidence needed when OCR cannot confirm the type


def _norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


class AutoTagPipeline:
    def __init__(self, weights: Path = BEST_WEIGHTS, conf: float = 0.25, imgsz: int = 1280):
        import easyocr
        import torch
        from ultralytics import YOLO

        if not Path(weights).exists():
            raise FileNotFoundError(f"{weights} not found. Run train.py first.")
        self.model = YOLO(str(weights))
        self.conf, self.imgsz = conf, imgsz
        self.reader = easyocr.Reader(["en"], gpu=torch.cuda.is_available(), verbose=False)
        self.library = json.loads(ASSET_LIBRARY.read_text(encoding="utf-8"))
        self.assets = {a["id"]: a for a in self.library}

    # ---- OCR + matching -----------------------------------------------------
    def ocr(self, crop: np.ndarray) -> str:
        if crop.size == 0:
            return ""
        h = crop.shape[0]
        if h < 64:  # tiny label crops: upscale so EasyOCR has something to read
            f = 64 / h
            crop = cv2.resize(crop, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC)
        try:
            parts = self.reader.readtext(crop, detail=0, paragraph=False)
        except Exception:
            return ""
        return " ".join(p.strip() for p in parts if p.strip())

    def match(self, text: str, asset_id: str) -> float:
        """Fuzzy score 0-100 of the OCR text against the identifiers of one asset type.

        The detector only knows one device type, so OCR confirms that type instead of
        choosing between all types (random text on other signs would match something).
        """
        t = _norm(text)
        if len(t) < 2:
            return 0.0
        best = 0.0
        for ident in self.assets[asset_id]["identifiers"]:
            i = _norm(ident)
            best = max(best, fuzz.ratio(t, i))
            for tok in re.split(r"\s+", text.upper()):  # also match token by token
                best = max(best, fuzz.ratio(_norm(tok), i))
        return best

    # ---- detection ----------------------------------------------------------
    def detect(self, img: np.ndarray, image_name: str, id_prefix: str = "det", pose: dict | None = None):
        """Return (detections list in the frontend format, annotated image).

        pose: the image's entry from poses.json; gives scanPointId and panorama pitch/yaw.
        """
        H, W = img.shape[:2]
        res = self.model.predict(img, imgsz=self.imgsz, conf=self.conf, verbose=False)[0]
        boxes = res.boxes.xyxy.cpu().numpy() if res.boxes is not None else np.zeros((0, 4))
        cls = res.boxes.cls.cpu().numpy().astype(int) if len(boxes) else np.zeros(0, int)
        confs = res.boxes.conf.cpu().numpy() if len(boxes) else np.zeros(0)

        devices = [i for i in range(len(boxes)) if cls[i] == 0]
        labels = [i for i in range(len(boxes)) if cls[i] == 1]
        used_labels = set()
        items = []  # (device box or None, label boxes, det confidence)

        has_pose = bool(pose and "rotation" in pose)
        for d in sorted(devices, key=lambda i: -confs[i]):
            x1, y1, x2, y2 = boxes[d]
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            aspect = (x2 - x1) / max(y2 - y1, 1e-6)
            cut = x1 < 8 or y1 < 8 or x2 > W - 8 or y2 > H - 8  # cropped by the image border
            if not cut and not ASPECT_RANGE[0] <= aspect <= ASPECT_RANGE[1]:
                continue  # door handles, floor markings etc. do not have the relay's shape
            if has_pose and abs(pixel_to_yaw_pitch(pose, cx, cy)[1]) > MAX_ABS_PITCH:
                continue  # panel-mounted devices are not on the floor or the ceiling
            if any(b[0] <= cx <= b[2] and b[1] <= cy <= b[3] for b, _, _ in items):
                continue  # duplicate of a stronger box
            inside = [l for l in labels
                      if x1 <= (boxes[l][0] + boxes[l][2]) / 2 <= x2
                      and y1 <= (boxes[l][1] + boxes[l][3]) / 2 <= y2]
            items.append((boxes[d], [boxes[l] for l in inside], float(confs[d])))
        # label boxes without a device box are ignored: in real scans they are other signs and logos

        annotated = img.copy()
        detections = []
        n = 0
        for dev, lbls, det_conf in items:
            texts = [self.ocr(self._crop(img, b, pad=0.12)) for b in lbls]
            text = " ".join(t for t in texts if t)
            score = self.match(text, DEFAULT_ASSET_TYPE)
            if score < MATCH_THRESHOLD:
                # fallback: read the upper part of the device front, where the type text is
                x1, y1, x2, y2 = dev
                text2 = self.ocr(self._crop(img, (x1, y1, x2, y1 + (y2 - y1) * 0.35), pad=0.0))
                s2 = self.match(text2, DEFAULT_ASSET_TYPE)
                if s2 >= MATCH_THRESHOLD or not text:
                    text, score = text2, s2
            if score < MATCH_THRESHOLD:
                score = 0.0
                # unconfirmed by OCR: keep only strong detections that also show a label region
                if not lbls or det_conf < UNCONFIRMED_MIN_CONF:
                    continue
            asset_id = DEFAULT_ASSET_TYPE
            n += 1

            box = dev
            x1, y1, x2, y2 = [float(v) for v in box]
            confidence = round(det_conf * (0.5 + 0.5 * score / 100), 3)
            pitch = yaw = None
            if has_pose:
                yaw, pitch = (round(a, 2) for a in pixel_to_yaw_pitch(pose, (x1 + x2) / 2, (y1 + y2) / 2))
            detections.append({
                "id": f"{id_prefix}-{n}",
                "scanPointId": pose.get("scanPointId") if pose else None,
                "image": image_name,
                "assetTypeId": asset_id,
                "ocrText": text,
                "confidence": confidence,
                "bbox": [round(x1), round(y1), round(x2 - x1), round(y2 - y1)],
                "pitch": pitch,
                "yaw": yaw,
                "documents": self.assets[asset_id]["documents"] if asset_id else [],
            })
            self._draw(annotated, box, lbls, f"{asset_id or 'unknown'} {confidence:.2f} '{text[:24]}'")
        return detections, annotated

    @staticmethod
    def _crop(img: np.ndarray, box, pad: float) -> np.ndarray:
        H, W = img.shape[:2]
        x1, y1, x2, y2 = box
        px, py = (x2 - x1) * pad, (y2 - y1) * pad
        x1, y1 = int(max(0, x1 - px)), int(max(0, y1 - py))
        x2, y2 = int(min(W, x2 + px)), int(min(H, y2 + py))
        return img[y1:y2, x1:x2]

    @staticmethod
    def _draw(img: np.ndarray, box, lbls, caption: str) -> None:
        t = max(2, round(max(img.shape[:2]) / 600))
        x1, y1, x2, y2 = [int(v) for v in box]
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 200, 0), t)
        for b in lbls:
            cv2.rectangle(img, (int(b[0]), int(b[1])), (int(b[2]), int(b[3])), (0, 140, 255), t)
        fs = max(0.5, max(img.shape[:2]) / 1800)
        (tw, th), _ = cv2.getTextSize(caption, cv2.FONT_HERSHEY_SIMPLEX, fs, t)
        ty = y1 - 6 if y1 - th - 10 > 0 else y2 + th + 6
        cv2.rectangle(img, (x1, ty - th - 4), (x1 + tw + 4, ty + 4), (0, 200, 0), -1)
        cv2.putText(img, caption, (x1 + 2, ty), cv2.FONT_HERSHEY_SIMPLEX, fs, (0, 0, 0), t, cv2.LINE_AA)
