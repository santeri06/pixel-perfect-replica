export const trainingStats = {
  datasetSize: 12480,
  epochs: 60,
  map: 0.912,
  ocrAccuracy: 0.947,
};

export const trainingCurve = Array.from({ length: 30 }, (_, i) => {
  const e = (i + 1) * 2;
  return {
    epoch: e,
    loss: +(2.4 * Math.exp(-e / 14) + 0.12 + ((i * 7) % 5) * 0.01).toFixed(3),
    valLoss: +(2.5 * Math.exp(-e / 15) + 0.18 + ((i * 3) % 4) * 0.012).toFixed(3),
    accuracy: +(0.95 - 0.6 * Math.exp(-e / 12) - ((i * 5) % 3) * 0.004).toFixed(3),
  };
});

// box in % of image (x, y, w, h)
export const examplePredictions = [
  { id: "p1", label: "Protection relay 615", ocr: "REF615", confidence: 0.94, box: [50.5, 30, 5.5, 8] },
  { id: "p2", label: "Air circuit breaker", ocr: "EMAX2 E2.2", confidence: 0.88, box: [51, 51, 5.8, 13] },
  { id: "p3", label: "Protection relay 615", ocr: "RE?615", confidence: 0.63, box: [1.5, 29, 6, 8] },
];
