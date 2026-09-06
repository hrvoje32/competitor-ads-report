"use server";

import { prisma } from "@/lib/prisma";
import { deleteFiles } from "@/lib/storage";
import { cleanupReportMedia } from "@/lib/report-media";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { findPreviousCompletedBrandReport } from "@/lib/month-comparison";

const reportDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date.").refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Enter a valid date.");

const schema = z.object({
  title: z.string().trim().min(1),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2020).max(2100),
  startDate: reportDate,
  endDate: reportDate,
  countryCode: z.string().trim().length(2),
  language: z.enum(["HR", "EN"]),
  brandIds: z.array(z.string()).min(1, "Choose at least one brand"),
}).refine(input => input.startDate <= input.endDate, { path: ["endDate"], message: "End date must be on or after start date." });

export async function createReport(formData: FormData) {
  const input = schema.parse({
    title: formData.get("title"),
    month: formData.get("month"),
    year: formData.get("year"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    countryCode: formData.get("countryCode"),
    language: formData.get("language"),
    brandIds: formData.getAll("brandIds"),
  });
  const report = await prisma.report.create({
    data: {
      title: input.title,
      month: input.month,
      year: input.year,
      startDate: new Date(`${input.startDate}T00:00:00.000Z`),
      endDate: new Date(`${input.endDate}T00:00:00.000Z`),
      countryCode: input.countryCode.toUpperCase(),
      language: input.language,
      brandReports: { create: input.brandIds.map(brandId => ({ brandId })) },
    },
    include: { brandReports: { select: { id: true, brandId: true } } },
  });
  const comparisons = await Promise.all(report.brandReports.map(async brandReport => ({
    brandReportId: brandReport.id,
    previous: await findPreviousCompletedBrandReport(brandReport.brandId, report.year, report.month),
  })));
  await prisma.$transaction(comparisons.map(item => prisma.brandReport.update({
    where: { id: item.brandReportId },
    data: { previousBrandReportId: item.previous?.id ?? null },
  })));
  revalidatePath("/reports");
  revalidatePath("/");
  redirect(`/reports/${report.id}`);
}

export async function updateReportLanguage(reportId: string, formData: FormData) {
  const language = z.enum(["HR", "EN"]).parse(formData.get("language"));
  const current = await prisma.report.findUniqueOrThrow({
    where: { id: reportId },
    select: { language: true },
  });
  if (current.language !== language) {
    await prisma.$transaction([
      prisma.report.update({ where: { id: reportId }, data: { language, status: "DRAFT" } }),
      prisma.brandReport.updateMany({
        where: { reportId },
        data: {
          analysisJson: null,
          analysisEditedJson: null,
          previousBrandReportId: null,
          automationStatus: "PENDING",
          automationError: null,
        },
      }),
    ]);
  }
  revalidatePath(`/reports/${reportId}`);
}

export async function cleanupReportMediaAction(reportId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { status: true, brandReports: { where: { included: true }, select: { analysisJson: true, analysisEditedJson: true } } },
  });
  if (!report) throw new Error("Report not found.");
  if (report.status !== "COMPLETE" || report.brandReports.some(item => !item.analysisJson && !item.analysisEditedJson)) {
    throw new Error("Report media can be cleaned only after the report has been generated.");
  }
  const result = await cleanupReportMedia(reportId);
  revalidatePath(`/reports/${reportId}`, "layout");
  return result;
}

export async function deleteReport(id: string) {
  let paths: Array<string | null> = [];
  let deleted = 0;
  try {
    const evidence = await prisma.adEvidence.findMany({
      where: { brandReport: { reportId: id } },
      select: { localImagePath: true, media: { select: { storagePath: true } } },
    });
    paths = evidence.flatMap(item => [item.localImagePath, ...item.media.map(media => media.storagePath)]);
    deleted = (await prisma.report.deleteMany({ where: { id } })).count;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The report could not be deleted." };
  }
  if (deleted) {
    const cleanup = await deleteFiles(paths).catch(error => ({ failures: [error instanceof Error ? error.message : "Storage cleanup failed."] }));
    if (cleanup.failures.length && process.env.NODE_ENV !== "production") console.warn(`Report ${id} was deleted, but some media cleanup failed.`, cleanup.failures);
  }
  revalidatePath("/");
  revalidatePath("/reports");
  return {};
}
