"""FastAPI server for the frontend.

Usage (PowerShell, from the cv folder):
    uvicorn api:app --port 8000

    POST /api/detect      multipart upload (field 'file') -> detections JSON
    GET  /api/detections  contents of outputs/detections.json
    GET  /api/panoramas   contents of outputs/panoramas/index.json
    GET  /panoramas/...   panorama images (static)
"""
import json
import uuid
from functools import lru_cache

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from fastapi.staticfiles import StaticFiles

from common import DETECTIONS_FILE, OUTPUTS_DIR

app = FastAPI(title="VEO360 AutoTag CV API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


PANORAMAS_DIR = OUTPUTS_DIR / "panoramas"
PANORAMAS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/panoramas", StaticFiles(directory=PANORAMAS_DIR), name="panoramas")


@lru_cache(maxsize=1)
def get_pipeline():
    from pipeline import AutoTagPipeline
    return AutoTagPipeline()


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/detect")
def detect(file: UploadFile = File(...)):
    data = np.frombuffer(file.file.read(), np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR) if data.size else None
    if img is None:
        raise HTTPException(400, "Could not decode the uploaded image.")
    try:
        pipe = get_pipeline()
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))
    dets, _ = pipe.detect(img, file.filename or "upload", id_prefix=uuid.uuid4().hex[:8])
    return dets


@app.get("/api/panoramas")
def panoramas():
    index = PANORAMAS_DIR / "index.json"
    return json.loads(index.read_text(encoding="utf-8")) if index.exists() else []


@app.get("/api/detections")
def detections():
    if not DETECTIONS_FILE.exists():
        return []
    return json.loads(DETECTIONS_FILE.read_text(encoding="utf-8"))
