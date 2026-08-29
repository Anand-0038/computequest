import { z } from "zod";

const httpsUrl = z.string().trim().url().max(500).refine(
  (value) => new URL(value).protocol === "https:",
  "Only HTTPS links are accepted",
);

export const sponsorInquirySchema = z.object({
  clientRequestId: z.string().uuid(),
  companyName: z.string().trim().min(2).max(100),
  contactName: z.string().trim().min(2).max(100),
  contactEmail: z.string().trim().email().max(254),
  companyWebsite: httpsUrl,
  destinationUrl: httpsUrl,
  creativeType: z.enum(["VIDEO", "X_POST", "IMAGE", "OTHER"]),
  creativeUrl: httpsUrl,
  campaignTitle: z.string().trim().min(3).max(80),
  description: z.string().trim().min(20).max(280),
  authorizationConfirmed: z.literal(true),
});

export type SponsorInquiryInput = z.infer<typeof sponsorInquirySchema>;
