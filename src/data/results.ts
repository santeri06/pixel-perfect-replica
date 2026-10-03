// All numbers shown on the Results page. Update here only.
//
// Source of the numbers: cv/outputs/detections.json (74 detections from cv/infer.py on the
// Matterport E57 export). autoTagged / sentToReview split at confidence 0.75, the same threshold
// as in src/data/detections.ts. The "correct" counts come from a manual check of every detection
// in cv/outputs/detections_overview.jpg, not from a labelled ground truth.
export const results = {
  imagesAnalysed: 108, // skybox images in the E57 export (18 scan points x 6)
  viewsAnalysed: 3132, // overlapping views rendered from them and searched (174 per scan point)
  scanPoints: 18,
  autoTagged: 62,
  autoTaggedCorrect: 62,
  sentToReview: 12,
  reviewCorrect: 7,
  trainingData: "Synthetic only – generated from reference images",
  beforeAfter: [
    { metric: "Time per site", manual: "TBD", autotag: "TBD" },
    { metric: "Time per tag", manual: "TBD", autotag: "TBD" },
    { metric: "Tags requiring human work", manual: "TBD", autotag: "TBD" },
    { metric: "Documents linked", manual: "TBD", autotag: "TBD" },
  ],
  nextSteps: [
    "Site-specific backgrounds in synthetic data",
    "Merging the same device across scan points",
    "More device types",
    "Push tags directly into VEO360 / Matterport",
  ],
};
