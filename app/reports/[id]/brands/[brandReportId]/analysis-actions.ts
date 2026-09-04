"use server";
import { analysisSchema } from "@/lib/analysis";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function saveAnalysisEdits(reportId: string, brandReportId: string, rawJson: string) {
  const parsed = analysisSchema.parse(JSON.parse(rawJson));
  await prisma.brandReport.update({ where: { id: brandReportId }, data: { analysisEditedJson: JSON.stringify(parsed) } });
  revalidatePath(`/reports/${reportId}/brands/${brandReportId}`); revalidatePath(`/reports/${reportId}`);
}
