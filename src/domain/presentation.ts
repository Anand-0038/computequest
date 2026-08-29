import { z } from "zod";

export const slideSchema = z.object({
  title: z.string().min(1).max(120),
  bullets: z.array(z.string().min(1).max(240)).min(1).max(6),
  speakerNote: z.string().max(600).optional(),
  visualDirection: z.string().max(300).optional(),
});

export const presentationSchema = z.object({
  title: z.string().min(1).max(160),
  subtitle: z.string().min(1).max(240),
  theme: z.string().min(1).max(120),
  slides: z.array(slideSchema).min(6).max(10),
});

export type Presentation = z.infer<typeof presentationSchema>;
