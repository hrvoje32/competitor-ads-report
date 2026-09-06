import { NextRequest } from "next/server";
import PptxGenJS from "pptxgenjs";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { getCroppedImageBuffer } from "@/lib/uploads";

export const runtime = "nodejs";

const W = 13.333;
const TEAL = "102D35";
const ACCENT = "159B93";
const INK = "17222D";
const MUTED = "64748B";
const PAPER = "F7F9FA";
const RECT = "rect" as PptxGenJS.ShapeType;
const ANALYSIS_X = .58;
const ANALYSIS_WIDTH = 7.05;
const ANALYSIS_TOP = 1.45;
const ANALYSIS_BOTTOM = 7.12;
const ANALYSIS_HEADING_HEIGHT = .18;
const ANALYSIS_HEADING_BODY_GAP = .06;
const ANALYSIS_SECTION_GAP = .1;
const CROATIAN_MONTHS = ["siječanj", "veljača", "ožujak", "travanj", "svibanj", "lipanj", "srpanj", "kolovoz", "rujan", "listopad", "studeni", "prosinac"];
const ENGLISH_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type ReportLanguage = "HR" | "EN";
type AnalysisSection = { title: string; items: string[]; bulleted: boolean };

type Evidence = {
  id: string;
  source: "GOOGLE" | "META";
  localImagePath: string | null;
  cropX: number | null;
  cropY: number | null;
  cropWidth: number | null;
  cropHeight: number | null;
  sortOrder: number;
  selectedForSlide: boolean;
  selectedForAnalysisEvidence: boolean;
};

async function imageData(
  localImagePath: string,
  crop?: { cropX: number | null; cropY: number | null; cropWidth: number | null; cropHeight: number | null },
) {
  const buffer = await getCroppedImageBuffer(
    localImagePath,
    crop && crop.cropX !== null && crop.cropY !== null && crop.cropWidth !== null && crop.cropHeight !== null
      ? { cropX: crop.cropX, cropY: crop.cropY, cropWidth: crop.cropWidth, cropHeight: crop.cropHeight }
      : null,
  );
  const meta = await sharp(buffer).metadata();
  return {
    data: `data:image/${meta.format === "jpeg" ? "jpeg" : meta.format ?? "png"};base64,${buffer.toString("base64")}`,
    width: meta.width ?? 1,
    height: meta.height ?? 1,
  };
}

function contain(box: { x: number; y: number; w: number; h: number }, image: { width: number; height: number }) {
  const ratio = Math.min(box.w / image.width, box.h / image.height);
  const w = image.width * ratio;
  const h = image.height * ratio;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

function addHeader(slide: PptxGenJS.Slide, brand: string, title: string, period: string) {
  slide.background = { color: PAPER };
  slide.addShape(RECT, { x: 0, y: 0, w: W, h: 1.18, fill: { color: TEAL }, line: { color: TEAL } });
  slide.addText(`${brand.toUpperCase()} | ${title} | ${period.toUpperCase()}`, {
    x: .48, y: .32, w: 10.8, h: .3, fontFace: "Arial", fontSize: 16, bold: true,
    color: "FFFFFF", margin: 0, breakLine: false, fit: "shrink",
  });
}

async function addLogo(slide: PptxGenJS.Slide, logoPath?: string | null) {
  if (!logoPath) return;
  try {
    const image = await imageData(logoPath);
    slide.addImage({ data: image.data, ...contain({ x: 11.72, y: .2, w: 1.08, h: .7 }, image) });
  } catch {
    // A brand logo is decorative and must not block evidence export.
  }
}

function grid(count: number) {
  if (count === 1) return [1, 1];
  if (count === 2) return [2, 1];
  if (count === 3) return [3, 1];
  if (count <= 4) return [2, 2];
  if (count <= 6) return [3, 2];
  return [4, 2];
}

async function addEvidenceGrid(
  slide: PptxGenJS.Slide,
  evidence: Evidence[],
  prefix: "G" | "M",
  labels: Map<string, string>,
  emptyText: string,
) {
  if (!evidence.length) {
    slide.addText(emptyText, {
      x: .55, y: 3.35, w: 12.2, h: .3, align: "center",
      fontFace: "Arial", fontSize: 17, color: MUTED, margin: 0,
    });
    return;
  }

  const [columns, rows] = grid(evidence.length);
  const gap = .13;
  const x = .52;
  const y = 1.58;
  const totalW = 12.29;
  const totalH = 5.35;
  const cellW = (totalW - gap * (columns - 1)) / columns;
  const cellH = (totalH - gap * (rows - 1)) / rows;
  for (let index = 0; index < evidence.length; index++) {
    const item = evidence[index];
    const box = {
      x: x + (index % columns) * (cellW + gap),
      y: y + Math.floor(index / columns) * (cellH + gap),
      w: cellW,
      h: cellH,
    };
    const image = await imageData(item.localImagePath!, item);
    slide.addShape(RECT, { ...box, fill: { color: "E7EDF0" }, line: { color: "D5DFE3", width: .5 } });
    slide.addImage({ data: image.data, ...contain(box, image) });
    slide.addShape(RECT, {
      x: box.x + .08, y: box.y + .08, w: .32, h: .22,
      fill: { color: TEAL, transparency: 8 }, line: { color: TEAL },
    });
    slide.addText(labels.get(item.id) ?? `${prefix}${index + 1}`, {
      x: box.x + .08, y: box.y + .105, w: .32, h: .12,
      fontFace: "Arial", fontSize: 7, bold: true, color: "FFFFFF", align: "center", margin: 0,
    });
  }
}

function sectionItems(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(item => sectionItems(item));
  if (value && typeof value === "object") {
    const item = value as { text?: unknown; evidence?: unknown };
    if (typeof item.text === "string") {
      const text = item.text.trim();
      return text ? [`${text}${Array.isArray(item.evidence) && item.evidence.length ? ` [${item.evidence.join(", ")}]` : ""}`] : [];
    }
    return Object.values(value).flatMap(item => sectionItems(item));
  }
  return [];
}

function analysisSections(raw: string | null, language: ReportLanguage): AnalysisSection[] {
  if (!raw) return [];
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const titles = language === "HR" ? [
      "Ključne komunikacijske teme",
      "Promovirani modeli / proizvodi",
      "Ponude, financiranje i cijene",
      "Google oglašavanje",
      "Oglašavanje na društvenim mrežama",
      "PROMJENE U ODNOSU NA PRETHODNI MJESEC",
      "Zaključak",
    ] : [
      "Key communication themes",
      "Models / products promoted",
      "Offers / financing / pricing",
      "Google advertising observations",
      "Social media observations",
      "Changes vs previous month",
      "Overall conclusion",
    ];
    const items = [
      [titles[0], ["keyThemes", "keyCommunicationThemes", "themes"], true],
      [titles[1], ["modelsPromoted", "modelsProductsPromoted", "models"], true],
      [titles[2], ["offers", "offersFinancingPricing"], true],
      [titles[3], ["googleFindings", "googleAdvertisingObservations", "googleObservations"], true],
      [titles[4], ["socialFindings", "socialMediaObservations", "socialObservations"], true],
      [titles[5], ["changesVsPreviousMonth", "changes"], true],
      [titles[6], ["conclusion", "overallConclusion"], false],
    ] as const;
    return items
      .map(([title, keys, bulleted]) => ({ title, items: keys.flatMap(key => sectionItems(data[key])).slice(0, 1_000), bulleted }))
      .filter(item => item.items.length);
  } catch {
    return [{ title: language === "HR" ? "Analiza" : "Analysis", items: [raw], bulleted: false }];
  }
}

function wrappedLineCount(text: string, width: number, fontSize: number) {
  const maxUnits = Math.max(8, Math.floor(width * 72 / (fontSize * .52)));
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (!words.length) { lines++; continue; }
    let used = 0;
    for (const word of words) {
      const units = Math.max(1, word.length);
      if (units > maxUnits) {
        if (used) lines++;
        lines += Math.floor(units / maxUnits);
        used = units % maxUnits;
      } else if (!used || used + 1 + units <= maxUnits) {
        used += (used ? 1 : 0) + units;
      } else {
        lines++;
        used = units;
      }
    }
    if (used) lines++;
  }
  return Math.max(1, lines);
}

function sectionBody(section: AnalysisSection) {
  return section.items.map(item => section.bulleted ? `• ${item}` : item).join("\n");
}

function analysisSectionHeight(section: AnalysisSection, bodyFontSize: number) {
  const lineHeight = bodyFontSize / 72 * 1.28;
  const bodyHeight = Math.max(.15, wrappedLineCount(sectionBody(section), ANALYSIS_WIDTH, bodyFontSize) * lineHeight + .02);
  return { bodyHeight, totalHeight: ANALYSIS_HEADING_HEIGHT + ANALYSIS_HEADING_BODY_GAP + bodyHeight + ANALYSIS_SECTION_GAP };
}

function totalAnalysisHeight(sections: AnalysisSection[], bodyFontSize: number) {
  return sections.reduce((height, section) => height + analysisSectionHeight(section, bodyFontSize).totalHeight, 0);
}

function shortenForSlide(value: string, maximum: number) {
  const citation = value.match(/\s(\[[^\]]+\])$/)?.[1] ?? "";
  const prose = citation ? value.slice(0, -(citation.length + 1)).trim() : value.trim();
  if (prose.length <= maximum) return value;
  const candidate = prose.slice(0, maximum + 1);
  const boundary = candidate.lastIndexOf(" ");
  const shortened = candidate.slice(0, boundary >= maximum * .65 ? boundary : maximum).replace(/[,:;\s]+$/, "");
  return `${shortened}…${citation ? ` ${citation}` : ""}`;
}

function fitAnalysisSections(input: AnalysisSection[]) {
  const available = ANALYSIS_BOTTOM - ANALYSIS_TOP;
  for (const bodyFontSize of [9.5, 9, 8.5]) {
    if (totalAnalysisHeight(input, bodyFontSize) <= available) return { sections: input, bodyFontSize };
  }
  for (const maximum of [105, 85, 65]) {
    const sections = input.map(section => ({ ...section, items: section.items.map(item => shortenForSlide(item, maximum)) }));
    if (totalAnalysisHeight(sections, 8.5) <= available) return { sections, bodyFontSize: 8.5 };
  }
  throw new Error("Analysis is too long for one slide after safe condensation. Regenerate it with shorter findings.");
}

function addAnalysisSection({
  slide,
  section,
  startY,
  bodyFontSize,
}: {
  slide: PptxGenJS.Slide;
  section: AnalysisSection;
  startY: number;
  bodyFontSize: number;
}) {
  const { bodyHeight, totalHeight } = analysisSectionHeight(section, bodyFontSize);
  if (startY + totalHeight > ANALYSIS_BOTTOM + .001) {
    throw new Error(`Analysis section "${section.title}" exceeds the analysis column.`);
  }
  slide.addText(section.title.toUpperCase(), {
    x: ANALYSIS_X, y: startY, w: ANALYSIS_WIDTH, h: ANALYSIS_HEADING_HEIGHT,
    fontFace: "Arial", fontSize: 10.5, bold: true, color: ACCENT,
    charSpacing: .75, margin: 0, breakLine: false,
  });
  const bodyY = startY + ANALYSIS_HEADING_HEIGHT + ANALYSIS_HEADING_BODY_GAP;
  slide.addText(sectionBody(section), {
    x: ANALYSIS_X, y: bodyY, w: ANALYSIS_WIDTH, h: bodyHeight,
    fontFace: "Arial", fontSize: bodyFontSize, color: INK,
    margin: 0, breakLine: false, valign: "top",
  });
  return startY + totalHeight;
}

async function addAnalysisSlide(
  pptx: PptxGenJS,
  brand: { name: string; logoPath: string | null },
  period: string,
  rawAnalysis: string | null,
  evidence: Evidence[],
  labels: Map<string, string>,
  language: ReportLanguage,
) {
  const slide = pptx.addSlide();
  addHeader(slide, brand.name, language === "HR" ? "MJESEČNA ANALIZA OGLAŠAVANJA" : "MONTHLY ADVERTISING ANALYSIS", period);
  await addLogo(slide, brand.logoPath);
  const sections = analysisSections(rawAnalysis, language);
  if (!sections.length) {
    slide.addText(language === "HR" ? "Analiza nije generirana" : "Analysis has not been generated", {
      x: ANALYSIS_X, y: 1.72, w: ANALYSIS_WIDTH, h: .35, fontFace: "Arial", fontSize: 18, color: MUTED, margin: 0,
    });
  } else {
    const fitted = fitAnalysisSections(sections);
    let currentY = ANALYSIS_TOP;
    for (const section of fitted.sections) currentY = addAnalysisSection({ slide, section, startY: currentY, bodyFontSize: fitted.bodyFontSize });
  }

  slide.addShape(RECT, {
    x: 8.06, y: 1.38, w: 4.7, h: 5.75,
    fill: { color: "EAF0F1" }, line: { color: "D5DFE3", width: .5 },
  });
  slide.addText(language === "HR" ? "ODABRANI PRIMJERI OGLASA" : "SELECTED EVIDENCE", {
    x: 8.33, y: 1.57, w: 3.9, h: .14, fontFace: "Arial",
    fontSize: 8, bold: true, color: MUTED, charSpacing: 1.1, margin: 0,
  });
  if (!evidence.length) {
    slide.addText(language === "HR" ? "Nisu odabrani primjeri oglasa za analizu." : "No analysis evidence selected.", {
      x: 8.35, y: 4.1, w: 3.95, h: .25, align: "center",
      fontFace: "Arial", fontSize: 11, color: MUTED, margin: 0,
    });
  }
  for (let index = 0; index < evidence.length; index++) {
    const item = evidence[index];
    const box = { x: 8.33, y: 1.93 + index * 1.68, w: 3.95, h: 1.43 };
    const image = await imageData(item.localImagePath!, item);
    slide.addShape(RECT, { ...box, fill: { color: "D8E1E4" }, line: { color: "FFFFFF", width: 1 } });
    slide.addImage({ data: image.data, ...contain(box, image) });
    const label = labels.get(item.id) ?? (item.source === "GOOGLE" ? `G${index + 1}` : `M${index + 1}`);
    slide.addShape(RECT, {
      x: box.x + .08, y: box.y + .08, w: .38, h: .23,
      fill: { color: TEAL }, line: { color: TEAL },
    });
    slide.addText(label, {
      x: box.x + .08, y: box.y + .105, w: .38, h: .1,
      fontFace: "Arial", fontSize: 7, bold: true, color: "FFFFFF", align: "center", margin: 0,
    });
  }
}

async function preflightEvidence(brandName: string, evidence: Evidence[]) {
  const selected = evidence.filter(item => item.selectedForSlide || item.selectedForAnalysisEvidence);
  for (const item of selected) {
    if (!item.localImagePath) throw new Error(`${brandName} has selected evidence without an uploaded screenshot.`);
    try {
      await imageData(item.localImagePath, item);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown image error";
      throw new Error(`${brandName} has selected evidence that cannot be read from storage: ${detail}`);
    }
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cover = request.nextUrl.searchParams.get("cover") === "1";
  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      brandReports: {
        where: { included: true },
        orderBy: { brand: { sortOrder: "asc" } },
        include: {
          brand: { include: { googleAdvertisers: true, metaPages: true } },
          adEvidence: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        },
      },
    },
  });
  if (!report) return new Response("Report not found.", { status: 404 });
  if (report.brandReports.some(brandReport => ["FETCHING", "CAPTURING", "ANALYSING"].includes(brandReport.automationStatus))) {
    return new Response("Automated analysis is still running. Export when processing finishes.", { status: 409 });
  }

  for (const brandReport of report.brandReports) {
    const googleCount = brandReport.adEvidence.filter(item => item.source === "GOOGLE" && item.selectedForSlide).length;
    const metaCount = brandReport.adEvidence.filter(item => item.source === "META" && item.selectedForSlide).length;
    const analysisCount = brandReport.adEvidence.filter(item => item.selectedForAnalysisEvidence).length;
    if (googleCount > 8 || metaCount > 8 || analysisCount > 3) {
      return new Response("Reduce source selections to 8 and analysis selections to 3 per brand before exporting.", { status: 400 });
    }
  }

  try {
    await Promise.all(report.brandReports.map(brandReport =>
      preflightEvidence(brandReport.brand.name, brandReport.adEvidence as Evidence[])
    ));
    const language = report.language as ReportLanguage;
    const monthNames = language === "HR" ? CROATIAN_MONTHS : ENGLISH_MONTHS;
    const period = `${monthNames[report.month - 1] ?? report.month} ${report.year}`;
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "Competitor Ads Report";
    pptx.subject = `Competitor advertising report – ${period}`;
    pptx.title = report.title;
    pptx.company = "Competitor Ads Report";

    if (cover) {
      const slide = pptx.addSlide();
      slide.background = { color: TEAL };
      slide.addText(language === "HR" ? "IZVJEŠĆE O OGLAŠAVANJU KONKURENCIJE" : "COMPETITOR ADS REPORT", {
        x: .68, y: 2.48, w: 11.9, h: .42, fontFace: "Arial",
        fontSize: 27, bold: true, color: "FFFFFF", align: "center", margin: 0,
      });
      slide.addText(period.toUpperCase(), {
        x: .68, y: 3.08, w: 11.9, h: .22, fontFace: "Arial",
        fontSize: 13, color: "BCE5E1", align: "center", charSpacing: 2, margin: 0,
      });
    }

    for (const brandReport of report.brandReports) {
      const all = brandReport.adEvidence as Evidence[];
      const google = all.filter(item => item.source === "GOOGLE" && item.selectedForSlide);
      const meta = all.filter(item => item.source === "META" && item.selectedForSlide);
      const analysisEvidence = all.filter(item => item.selectedForAnalysisEvidence);
      const analysisInputEvidence = all.filter(item => item.selectedForSlide || item.selectedForAnalysisEvidence);
      const labels = new Map<string, string>();
      let googleIndex = 0;
      let metaIndex = 0;
      for (const item of analysisInputEvidence) {
        labels.set(item.id, item.source === "GOOGLE" ? `G${++googleIndex}` : `M${++metaIndex}`);
      }

      let slide = pptx.addSlide();
      addHeader(slide, brandReport.brand.name, language === "HR" ? "GOOGLE OGLASI" : "GOOGLE ADS", period);
      await addLogo(slide, brandReport.brand.logoPath);
      slide.addText(language === "HR" ? "IZVOR: GOOGLE ADS TRANSPARENCY CENTER" : "SOURCE: GOOGLE ADS TRANSPARENCY CENTER", {
        x: .52, y: 1.3, w: 6.5, h: .14, fontFace: "Arial",
        fontSize: 7.5, bold: true, color: MUTED, charSpacing: .7, margin: 0,
      });
      await addEvidenceGrid(
        slide,
        google,
        "G",
        labels,
        brandReport.googleStatus === "FAILED"
          ? language === "HR" ? `Google izvor nije uspio: ${brandReport.googleError || "Podaci nisu prikupljeni"}` : `Google source failed: ${brandReport.googleError || "No data was collected"}`
          : language === "HR" ? "Za ovo izvještajno razdoblje nisu prikupljeni Google oglasi" : "No Google evidence was collected for this report period",
      );

      slide = pptx.addSlide();
      addHeader(slide, brandReport.brand.name, language === "HR" ? "OGLASI NA DRUŠTVENIM MREŽAMA" : "SOCIAL MEDIA ADS", period);
      await addLogo(slide, brandReport.brand.logoPath);
      slide.addText(language === "HR" ? "IZVOR: META AD LIBRARY" : "SOURCE: META AD LIBRARY", {
        x: .52, y: 1.3, w: 6.5, h: .14, fontFace: "Arial",
        fontSize: 7.5, bold: true, color: MUTED, charSpacing: .7, margin: 0,
      });
      await addEvidenceGrid(
        slide,
        meta,
        "M",
        labels,
        brandReport.metaStatus === "FAILED"
          ? language === "HR" ? `Meta izvor nije uspio: ${brandReport.metaError || "Podaci nisu prikupljeni"}` : `Meta source failed: ${brandReport.metaError || "No data was collected"}`
          : language === "HR" ? "Za ovo izvještajno razdoblje nisu prikupljeni Meta oglasi" : "No Meta evidence was collected for this report period",
      );

      await addAnalysisSlide(
        pptx,
        brandReport.brand,
        period,
        brandReport.analysisEditedJson || brandReport.analysisJson,
        analysisEvidence,
        labels,
        language,
      );
    }

    const buffer = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="Competitor-Ads-${report.year}-${String(report.month).padStart(2, "0")}.pptx"`,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.error(`PowerPoint export failed for Report ${id}.`, error);
    const detail = error instanceof Error ? error.message : "Unknown export error.";
    return new Response(`PowerPoint export failed: ${detail}`, { status: 422 });
  }
}
