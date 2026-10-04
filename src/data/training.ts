// measured values of the training run (YOLO detector, synthetic data only)
export const trainingStats = {
  datasetSize: 3000, // ~3000 synthetic images
  epochs: 8,
  map: 0.995, // mAP@0.5 on synthetic validation data (not on real scans)
  mapNote: "on synthetic validation data",
  // OCR accuracy was not measured, so it is not shown
};

// shape of the curve only (the per-epoch log is not in the app): 8 epochs like the real run
export const trainingCurve = Array.from({ length: trainingStats.epochs }, (_, i) => {
  const e = i + 1;
  return {
    epoch: e,
    loss: +(2.4 * Math.exp(-e / 2) + 0.12).toFixed(3),
    valLoss: +(2.5 * Math.exp(-e / 2.2) + 0.16).toFixed(3),
    accuracy: +(0.995 - 0.6 * Math.exp(-e / 1.6)).toFixed(3),
  };
});

// box in % of image (x, y, w, h)
export const examplePredictions = [
  { id: "p1", label: "Protection relay 615", ocr: "REF615", confidence: 0.94, box: [50.5, 30, 5.5, 8] as [number, number, number, number] },
  { id: "p2", label: "Air circuit breaker", ocr: "EMAX2 E2.2", confidence: 0.88, box: [51, 51, 5.8, 13] as [number, number, number, number] },
  { id: "p3", label: "Protection relay 615", ocr: "RE?615", confidence: 0.63, box: [1.5, 29, 6, 8] as [number, number, number, number] },
];
