import { describe, expect, it } from "vitest";
import { docsForVariant } from "@/components/MaintenanceLog";
import { lookupLibrary } from "@/lib/api";
import { instances } from "@/data/registry";

describe("manufacturer documentation per device", () => {
  it("every demo relay shows at least two documents", () => {
    for (const i of instances) {
      const { type } = lookupLibrary(i.assetTypeId);
      const d = docsForVariant(type?.manufacturerDocs ?? [], i.variant);
      expect(d.docs.length, i.id).toBeGreaterThanOrEqual(2);
      for (const doc of d.docs) expect(doc.url, `${i.id} ${doc.title}`).toMatch(/^https:\/\/library\.e\.abb\.com\/.+\.pdf$/);
    }
  });

  it("variant-specific manuals only for their own variant", () => {
    const { type } = lookupLibrary("relay-615");
    const docs = type!.manufacturerDocs;
    for (const v of ["REF615", "RET615", "REM615"]) {
      const d = docsForVariant(docs, v);
      expect(d.warning).toBeNull();
      expect(d.docs.map((x) => x.title)).toEqual(
        expect.arrayContaining([`${v} Product guide`, `${v} Application manual`]),
      );
      expect(d.docs.some((x) => /^RE[A-Z]615/.test(x.title) && !x.title.startsWith(v))).toBe(false);
    }
  });

  it("unknown variant falls back to the 615 series family documents", () => {
    const { type } = lookupLibrary("relay-615");
    const d = docsForVariant(type!.manufacturerDocs, "unknown");
    expect(d.heading).toBe("615 series family documentation");
    expect(d.warning).toBe("Variant-specific manual not linked yet");
    expect(d.docs.map((x) => x.title)).toEqual(["615 series Installation manual", "REF615 Product guide"]);
  });
});
