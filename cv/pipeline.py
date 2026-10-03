"""Detection pipeline shared by infer.py and api.py.

YOLO candidates -> shape filters -> visual check against the reference image -> label OCR ->
fuzzy match. For a scan point with camera poses, the candidates come from many overlapping
rendered views and are merged by direction (detect_scan).
"""
import json
import re
from pathlib import Path

import cv2
import numpy as np
from rapidfuzz import fuzz

from common import ASSET_LIBRARY, BEST_WEIGHTS, REFERENCE_DIR, REGIONS_FILE, imread
from geometry import make_view, pixel_to_yaw_pitch, render_view, yaw_pitch_to_dirs

# The detector is trained on a single device type; OCR and the visual check confirm that type.
DEFAULT_ASSET_TYPE = "relay-615"
MATCH_THRESHOLD = 65          # rapidfuzz score 0-100
ASPECT_RANGE = (0.8, 2.3)     # plausible width/height of a relay front in the image
MAX_ABS_PITCH = 45            # degrees; only applied when the camera pose is known
# Visual check: score = similarity to the reference + 0.2 * detector confidence.
# Tuned by eye on the 18 test scan points; re-check it on other sites.
VERIFY_ACCEPT = 0.98          # at or above: accepted as the device
VERIFY_REVIEW = 0.95          # between the two: kept as a low-confidence item for manual review
SIM_RANGE = (0.76, 0.88)      # reference similarity mapped to 0..1 for the confidence value

# Overlapping views rendered for every scan point: (vertical fov, horizontal stretch, pitches, yaw step)
VIEW_SETS = [
    (90, 1.0, (0,), 45),              # wide: close, large devices
    (45, 1.0, (0, 20), 30),           # zoomed: small, far devices
    (45, 2.0, (0, 20), 14),           # zoomed + stretched: panels seen at a steep angle
    (45, 3.5, (0, 20), 8),            # strongly stretched: panels seen almost edge-on
]
VIEW_SIZE = 1280


def _norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())


class ReferenceVerifier:
    """Similarity of a crop to the reference photo, using ImageNet features (no training)."""

    MEAN, STD = np.array([0.485, 0.456, 0.406]), np.array([0.229, 0.224, 0.225])

    def __init__(self):
        import torch
        import torchvision

        self.torch = torch
        self.net = torchvision.models.resnet18(weights="IMAGENET1K_V1")
        self.net.fc = torch.nn.Identity()
        self.net.eval()
        regions = json.loads(REGIONS_FILE.read_text(encoding="utf-8"))
        name = next((n for n in regions if "front" in n), next(iter(regions)))
        x, y, w, h = regions[name]["device"]
        front = imread(REFERENCE_DIR / name)[y:y + h, x:x + w]
        variants = [front] + [cv2.GaussianBlur(front, (0, 0), s) for s in (8, 16)]
        warped = []
        for a in (0.08, 0.16):  # the reference seen slightly from each side, above and below
            warped += [self._warp(front, a, 0, 0, 0), self._warp(front, 0, a, 0, 0),
                       self._warp(front, 0, 0, a, 0), self._warp(front, 0, 0, 0, a)]
        variants += warped + [cv2.GaussianBlur(v, (0, 0), 8) for v in warped]
        self.refs = np.stack([self._embed(v) for v in variants])

    @staticmethod
    def _warp(img, left, right, top, bottom):
        h, w = img.shape[:2]
        src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
        dst = np.float32([[w * top, h * left], [w * (1 - top), h * right],
                          [w * (1 - bottom), h * (1 - right)], [w * bottom, h * (1 - left)]])
        out = cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (w, h), borderValue=(215, 215, 215))
        return out[int(dst[:, 1].min()):int(dst[:, 1].max()), int(dst[:, 0].min()):int(dst[:, 0].max())]

    def _embed(self, crop: np.ndarray) -> np.ndarray:
        x = cv2.cvtColor(cv2.resize(crop, (224, 160), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB) / 255.0
        x = self.torch.tensor(((x - self.MEAN) / self.STD).transpose(2, 0, 1)[None], dtype=self.torch.float32)
        with self.torch.no_grad():
            f = self.net(x)[0].numpy()
        return f / np.linalg.norm(f)

    def similarity(self, crop: np.ndarray) -> float:
        if crop.size == 0:
            return 0.0
        return float((self.refs @ self._embed(crop)).max())


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
        self.verifier = ReferenceVerifier()
        self.library = json.loads(ASSET_LIBRARY.read_text(encoding="utf-8"))
        self.assets = {a["id"]: a for a in self.library}
        self.log: list[dict] = []  # every merged candidate of detect_scan, kept or not (for tuning)

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

    def read_label(self, img: np.ndarray, cand: dict) -> tuple[str, float]:
        """(text, match score) from the label regions, falling back to the top of the device front."""
        texts = [self.ocr(self._crop(img, b, pad=0.12)) for b in cand["labels"]]
        text = " ".join(t for t in texts if t)
        score = self.match(text, DEFAULT_ASSET_TYPE)
        if score < MATCH_THRESHOLD:
            x1, y1, x2, y2 = cand["box"]
            text2 = self.ocr(self._crop(img, (x1, y1, x2, y1 + (y2 - y1) * 0.35), pad=0.0))
            s2 = self.match(text2, DEFAULT_ASSET_TYPE)
            if s2 >= MATCH_THRESHOLD or not text:
                text, score = text2, s2
        return text, (score if score >= MATCH_THRESHOLD else 0.0)

    # ---- candidates ---------------------------------------------------------
    def candidates(self, img: np.ndarray, pose: dict | None = None, drop_cut: bool = False) -> list[dict]:
        """Device boxes that pass the shape filters, strongest first, with the label boxes inside."""
        H, W = img.shape[:2]
        res = self.model.predict(img, imgsz=self.imgsz, conf=self.conf, verbose=False)[0]
        if res.boxes is None or len(res.boxes) == 0:
            return []
        boxes = res.boxes.xyxy.cpu().numpy()
        cls = res.boxes.cls.cpu().numpy().astype(int)
        confs = res.boxes.conf.cpu().numpy()
        labels = [boxes[i] for i in range(len(boxes)) if cls[i] == 1]
        has_pose = bool(pose and ("rotation" in pose or "R" in pose))

        out = []
        for d in sorted((i for i in range(len(boxes)) if cls[i] == 0), key=lambda i: -confs[i]):
            x1, y1, x2, y2 = [float(v) for v in boxes[d]]
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            cut = x1 < 8 or y1 < 8 or x2 > W - 8 or y2 > H - 8  # cropped by the image border
            if cut and drop_cut:
                continue  # an overlapping view sees it whole
            if not cut and not ASPECT_RANGE[0] <= (x2 - x1) / max(y2 - y1, 1e-6) <= ASPECT_RANGE[1]:
                continue  # door handles, floor markings etc. do not have the relay's shape
            yaw = pitch = None
            if has_pose:
                yaw, pitch = pixel_to_yaw_pitch(pose, cx, cy)
                if abs(pitch) > MAX_ABS_PITCH:
                    continue  # panel-mounted devices are not on the floor or the ceiling
            if any(c["box"][0] <= cx <= c["box"][2] and c["box"][1] <= cy <= c["box"][3] for c in out):
                continue  # duplicate of a stronger box
            cand = {"box": (x1, y1, x2, y2), "conf": float(confs[d]), "yaw": yaw, "pitch": pitch,
                    "labels": [tuple(float(v) for v in b) for b in labels
                               if x1 <= (b[0] + b[2]) / 2 <= x2 and y1 <= (b[1] + b[3]) / 2 <= y2]}
            if has_pose:
                cand["stretch"] = pose.get("stretch", 1.0)
                f = pose["focalLength"]
                cand["size"] = float(np.degrees(max((x2 - x1) * pose["pixelWidth"], (y2 - y1) * pose["pixelHeight"]) / f))
            out.append(cand)
        return out

    def finalize(self, img: np.ndarray, cand: dict) -> dict | None:
        """Visual check + OCR for one candidate. Returns the detection fields, or None if rejected."""
        x1, y1, x2, y2 = cand["box"]
        sim = self.verifier.similarity(img[int(max(0, y1)):int(y2), int(max(0, x1)):int(x2)])
        score = sim + 0.2 * cand["conf"]
        cand["similarity"] = sim
        if score < VERIFY_REVIEW:
            return None
        text, ocr_score = self.read_label(img, cand)
        if score >= VERIFY_ACCEPT or ocr_score:
            visual = float(np.clip((sim - SIM_RANGE[0]) / (SIM_RANGE[1] - SIM_RANGE[0]), 0, 1))
            confidence = cand["conf"] * (0.6 + 0.4 * max(ocr_score / 100, visual))
        else:
            confidence = cand["conf"] * 0.5  # looks only roughly like the device: manual review
        return {
            "assetTypeId": DEFAULT_ASSET_TYPE,
            "ocrText": text,
            "confidence": round(confidence, 3),
            "bbox": [round(x1), round(y1), round(x2 - x1), round(y2 - y1)],
            "pitch": None if cand["pitch"] is None else round(cand["pitch"], 2),
            "yaw": None if cand["yaw"] is None else round(cand["yaw"], 2),
            "documents": self.assets[DEFAULT_ASSET_TYPE]["documents"],
        }

    # ---- single image (API uploads, plain screenshots) ----------------------
    def detect(self, img: np.ndarray, image_name: str, id_prefix: str = "det", pose: dict | None = None):
        """Return (detections list in the frontend format, annotated image).

        pose: the image's entry from poses.json; gives scanPointId and panorama pitch/yaw.
        """
        annotated = img.copy()
        detections = []
        for cand in self.candidates(img, pose):
            det = self.finalize(img, cand)
            if det is None:
                continue
            det = {"id": f"{id_prefix}-{len(detections) + 1}",
                   "scanPointId": pose.get("scanPointId") if pose else None, "image": image_name, **det}
            detections.append(det)
            self._draw(annotated, cand["box"], cand["labels"], self._caption(det))
        return detections, annotated

    # ---- one scan point: overlapping views merged by direction --------------
    def detect_scan(self, sources: list[tuple[dict, np.ndarray]], scan_id: str, id_prefix: str):
        """Return (detections, {view name: (clean view, annotated view)}) for one scan point.

        sources: [(poses.json entry, image)] of the scan point's skybox images.
        """
        views, cands = {}, []
        for fov, stretch, pitches, step in VIEW_SETS:
            for pitch in pitches:
                for yaw in np.arange(-180, 180, step):
                    view = make_view(float(yaw), pitch, fov, VIEW_SIZE, stretch)
                    name = f"{scan_id}_f{fov}_s{stretch:g}_y{yaw:+04.0f}_p{pitch:+03d}.jpg"
                    img = render_view(sources, view)
                    found = self.candidates(img, view, drop_cut=True)
                    if found:
                        views[name] = img
                        cands += [{**c, "view": name} for c in found]

        # merge the same object seen in several views: strongest box wins
        clusters: list[list[dict]] = []
        for c in sorted(cands, key=lambda c: -c["conf"]):
            d = yaw_pitch_to_dirs(np.array(c["yaw"]), np.array(c["pitch"]))
            for cl in clusters:
                rep = cl[0]
                sep = np.degrees(np.arccos(np.clip(d @ rep["dir"], -1, 1)))
                if sep < 0.5 * max(rep["size"], c["size"]):
                    cl.append(c)
                    break
            else:
                clusters.append([{**c, "dir": d}])

        detections, used = [], {}
        for cl in sorted(clusters, key=lambda cl: cl[0]["yaw"]):
            rep = cl[0]
            det = self.finalize(views[rep["view"]], rep)
            self.log.append({"scan": scan_id, "view": rep["view"], "box": rep["box"], "conf": rep["conf"],
                             "similarity": rep["similarity"], "views": len({c["view"] for c in cl}),
                             "yaw": rep["yaw"], "pitch": rep["pitch"], "kept": det is not None,
                             "crop": self._crop(views[rep["view"]], rep["box"], pad=0.3).copy()})
            if det is None:
                continue
            if self.match(det["ocrText"], DEFAULT_ASSET_TYPE) < MATCH_THRESHOLD:
                # the views are downscaled: read the label again from a full-resolution close-up
                text, s = self.read_label_zoomed(sources, rep)
                if s:
                    det = self.finalize_with_text(det, rep, text, s)
            det = {"id": f"{id_prefix}-{len(detections) + 1}", "scanPointId": scan_id, "image": rep["view"], **det}
            detections.append(det)
            clean = views[rep["view"]]
            ann = used.setdefault(rep["view"], (clean, clean.copy()))[1]
            self._draw(ann, rep["box"], rep["labels"], self._caption(det))
        return detections, used

    def read_label_zoomed(self, sources, cand: dict) -> tuple[str, float]:
        """OCR from a close-up of the candidate rendered at the source resolution."""
        fov = float(np.clip(cand["size"] * 1.5, 4, 60))
        view = make_view(cand["yaw"], cand["pitch"], fov, VIEW_SIZE)
        img = render_view(sources, view)
        try:  # the type text sits on the upper part of the front
            pieces = self.reader.readtext(img[:int(VIEW_SIZE * 0.6)], detail=0, paragraph=False)
        except Exception:
            return "", 0.0
        scored = [(self.match(p, DEFAULT_ASSET_TYPE), p.strip()) for p in pieces]
        score, text = max(scored, default=(0.0, ""))
        return (text, score) if score >= MATCH_THRESHOLD else ("", 0.0)

    @staticmethod
    def finalize_with_text(det: dict, cand: dict, text: str, ocr_score: float) -> dict:
        return {**det, "ocrText": text,
                "confidence": round(max(det["confidence"], cand["conf"] * (0.6 + 0.4 * ocr_score / 100)), 3)}

    # ---- helpers ------------------------------------------------------------
    @staticmethod
    def _caption(det: dict) -> str:
        return f"{det['assetTypeId']} {det['confidence']:.2f} '{det['ocrText'][:24]}'"

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
