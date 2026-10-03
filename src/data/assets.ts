export type DocType = "manual" | "wiring" | "settings" | "maintenance";

export interface AssetDoc {
  id: string;
  title: string;
  type: DocType;
  url: string;
}

export interface AssetType {
  id: string;
  name: string;
  category: string;
  identifiers: string[];
  manufacturer: string;
  lifecycle: "Active" | "Classic" | "Limited" | "Obsolete";
  siteCount: number;
  documents: AssetDoc[];
  spareParts: { partNo: string; description: string; stock: number }[];
}

const docs = (prefix: string): AssetDoc[] => [
  { id: `${prefix}-man`, title: "Product manual", type: "manual", url: "/docs/manual.pdf" },
  { id: `${prefix}-wir`, title: "Wiring diagram", type: "wiring", url: "/docs/wiring.pdf" },
  { id: `${prefix}-set`, title: "Settings file", type: "settings", url: "/docs/settings.pdf" },
  { id: `${prefix}-mnt`, title: "Maintenance report 2025", type: "maintenance", url: "/docs/maintenance.pdf" },
];

export const assetLibrary: AssetType[] = [
  {
    id: "relay-615",
    name: "Protection relay 615 series",
    category: "Protection & control",
    identifiers: ["REF615", "RET615", "REM615", "615 series", "REF615 H"],
    manufacturer: "Relion",
    lifecycle: "Active",
    siteCount: 42,
    documents: docs("relay"),
    spareParts: [
      { partNo: "1MRS050696", description: "Power supply module", stock: 6 },
      { partNo: "1MRS050711", description: "Binary I/O card", stock: 3 },
      { partNo: "1MRS120515", description: "HMI display unit", stock: 1 },
    ],
  },
  {
    id: "lv-section",
    name: "Low-voltage switchgear section",
    category: "Switchgear",
    identifiers: ["MNS", "SWG-01", "SWG-04", "SWG-06", "LV SECTION"],
    manufacturer: "MNS",
    lifecycle: "Active",
    siteCount: 18,
    documents: docs("lv"),
    spareParts: [
      { partNo: "1TGE120011", description: "Busbar support", stock: 12 },
      { partNo: "1TGE102009", description: "Door hinge kit", stock: 8 },
    ],
  },
  {
    id: "breaker-emax",
    name: "Air circuit breaker",
    category: "Breakers",
    identifiers: ["EMAX2 E2.2", "E2.2N", "EMAX E1.2", "ACB"],
    manufacturer: "Emax",
    lifecycle: "Classic",
    siteCount: 67,
    documents: docs("acb"),
    spareParts: [
      { partNo: "1SDA073687", description: "Shunt opening release", stock: 4 },
      { partNo: "1SDA074202", description: "Motor operator 220V", stock: 2 },
      { partNo: "1SDA073999", description: "Arcing contact kit", stock: 0 },
    ],
  },
  {
    id: "meter-m4m",
    name: "Network analyzer / meter",
    category: "Metering",
    identifiers: ["M4M 30", "M4M30", "M2M", "ANALOG AMP 0-600A"],
    manufacturer: "M4M",
    lifecycle: "Limited",
    siteCount: 103,
    documents: docs("meter"),
    spareParts: [{ partNo: "2CSG251123", description: "CT input terminal", stock: 15 }],
  },
];
