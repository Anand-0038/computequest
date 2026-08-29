import type { Presentation } from "@/domain/presentation";
import type { PDFFont, PDFPage, RGB } from "pdf-lib";

export function presentationFilename(title: string, extension: "json" | "pdf") {
  const base = title.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base || "computequest-deck"}.${extension}`;
}

export function presentationToPlainText(presentation: Presentation) {
  const slides = presentation.slides.map((slide, index) => [
    `${index + 1}. ${slide.title}`,
    ...slide.bullets.map((bullet) => `• ${bullet}`),
    slide.speakerNote ? `Speaker note: ${slide.speakerNote}` : null,
  ].filter(Boolean).join("\n"));

  return [presentation.title, presentation.subtitle, `Theme: ${presentation.theme}`, ...slides].join("\n\n");
}

export async function presentationToPdf(presentation: Presentation) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const pageSize: [number, number] = [960, 540];
  const ink = rgb(0.09, 0.08, 0.11);
  const paper = rgb(0.95, 0.93, 0.9);
  const purple = rgb(0.51, 0.43, 0.98);
  const yellow = rgb(0.95, 0.79, 0.3);
  const muted = rgb(0.68, 0.65, 0.7);

  const cover = document.addPage(pageSize);
  cover.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: ink });
  cover.drawRectangle({ x: 64, y: 430, width: 54, height: 54, color: yellow });
  cover.drawText("CQ", { x: 75, y: 447, size: 23, font: bold, color: ink });
  cover.drawText("COMPUTEQUEST", { x: 136, y: 450, size: 16, font: bold, color: paper });
  drawWrappedText(cover, presentation.title, { x: 64, y: 354, maxWidth: 790, size: 40, lineHeight: 46, font: bold, color: paper });
  drawWrappedText(cover, presentation.subtitle, { x: 66, y: 220, maxWidth: 760, size: 19, lineHeight: 25, font: regular, color: muted });
  cover.drawText(`THEME · ${presentation.theme.toLocaleUpperCase("en-US")}`, { x: 66, y: 70, size: 11, font: bold, color: purple });

  presentation.slides.forEach((slide, index) => {
    const page = document.addPage(pageSize);
    page.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: paper });
    page.drawRectangle({ x: 0, y: 0, width: 16, height: 540, color: index % 2 === 0 ? purple : yellow });
    page.drawText(String(index + 1).padStart(2, "0"), { x: 62, y: 462, size: 13, font: bold, color: purple });
    const titleEnd = drawWrappedText(page, slide.title, { x: 62, y: 426, maxWidth: 820, size: 31, lineHeight: 36, font: bold, color: ink });
    let bulletY = titleEnd - 34;
    for (const bullet of slide.bullets) {
      page.drawCircle({ x: 70, y: bulletY + 5, size: 4, color: yellow });
      bulletY = drawWrappedText(page, bullet, { x: 88, y: bulletY, maxWidth: 790, size: 17, lineHeight: 23, font: regular, color: ink }) - 17;
    }
    page.drawText(`COMPUTEQUEST · ${index + 1}/${presentation.slides.length}`, { x: 62, y: 34, size: 9, font: bold, color: muted });
  });

  return document.save();
}

function drawWrappedText(page: PDFPage, text: string, options: {
  x: number;
  y: number;
  maxWidth: number;
  size: number;
  lineHeight: number;
  font: PDFFont;
  color: RGB;
}) {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (options.font.widthOfTextAtSize(candidate, options.size) <= options.maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  lines.forEach((line, index) => page.drawText(line, {
    x: options.x,
    y: options.y - index * options.lineHeight,
    size: options.size,
    font: options.font,
    color: options.color,
  }));
  return options.y - lines.length * options.lineHeight;
}
