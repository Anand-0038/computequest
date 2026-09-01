import { describe, expect, it } from "vitest";

import { getGoogleAnalyticsMeasurementId } from "@/lib/analytics";

describe("Google Analytics configuration", () => {
  it("accepts a GA4 measurement ID", () => {
    expect(getGoogleAnalyticsMeasurementId(" G-ABC123XYZ ")).toBe("G-ABC123XYZ");
  });

  it.each([undefined, "", "UA-12345-1", "G-", "not-an-id"])(
    "fails closed for an invalid value: %s",
    (value) => {
      expect(getGoogleAnalyticsMeasurementId(value)).toBeNull();
    },
  );
});
