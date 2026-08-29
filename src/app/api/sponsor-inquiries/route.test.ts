import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRuntimeEnv: vi.fn(),
  requireSessionUserId: vi.fn(),
  createSponsorInquiry: vi.fn(),
}));

vi.mock("@/server/env", () => ({ requireRuntimeEnv: mocks.requireRuntimeEnv }));
vi.mock("@/server/auth/session", () => ({ requireSessionUserId: mocks.requireSessionUserId }));
vi.mock("@/server/services/sponsor-inquiries", () => ({
  createSponsorInquiry: mocks.createSponsorInquiry,
}));

import { POST } from "@/app/api/sponsor-inquiries/route";

const userId = "00000000-0000-4000-8000-000000000001";
const clientRequestId = "00000000-0000-4000-8000-000000000002";
const validBody = {
  clientRequestId,
  companyName: "A2Z DTC",
  contactName: "Product Founder",
  contactEmail: "founder@example.com",
  companyWebsite: "https://www.a2zdtc.com",
  destinationUrl: "https://www.a2zdtc.com/products",
  creativeType: "VIDEO",
  creativeUrl: "https://www.a2zdtc.com/creative.mp4",
  campaignTitle: "Commerce built for modern brands",
  description: "Introduce founders to a practical commerce product and invite them to learn more.",
  authorizationConfirmed: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSessionUserId.mockResolvedValue(userId);
  mocks.createSponsorInquiry.mockResolvedValue({
    created: true,
    inquiry: {
      id: "00000000-0000-4000-8000-000000000003",
      status: "RECEIVED",
      createdAt: new Date("2026-08-29T10:00:00.000Z"),
    },
  });
});

describe("sponsor inquiry route", () => {
  it("persists a validated sponsor request without exposing private review fields", async () => {
    const response = await POST(new Request("http://localhost/api/sponsor-inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createSponsorInquiry).toHaveBeenCalledWith({ ...validBody, userId });
    expect(await response.json()).toEqual({
      inquiry: {
        id: "00000000-0000-4000-8000-000000000003",
        status: "RECEIVED",
        createdAt: "2026-08-29T10:00:00.000Z",
      },
    });
  });

  it("rejects non-HTTPS creative links before persistence", async () => {
    const response = await POST(new Request("http://localhost/api/sponsor-inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, creativeUrl: "http://example.com/creative.mp4" }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.createSponsorInquiry).not.toHaveBeenCalled();
  });

  it("rejects a request without company or creative authorization", async () => {
    const response = await POST(new Request("http://localhost/api/sponsor-inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validBody, authorizationConfirmed: false }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.createSponsorInquiry).not.toHaveBeenCalled();
  });

  it("returns a retryable rate-limit response", async () => {
    mocks.createSponsorInquiry.mockRejectedValueOnce(new Error("SPONSOR_INQUIRY_RATE_LIMITED"));
    const response = await POST(new Request("http://localhost/api/sponsor-inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    }));

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "SPONSOR_INQUIRY_RATE_LIMITED" });
  });
});
