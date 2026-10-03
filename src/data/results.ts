// All numbers shown on the Results page. Update here only.
export const results = {
  imagesAnalysed: 108,
  scanPoints: 18,
  autoTagged: 10,
  autoTaggedCorrect: 10,
  sentToReview: 35,
  reviewCorrect: 18,
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
