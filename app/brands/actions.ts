"use server";

import { Prisma } from "@prisma/client";
import { normalizeGoogleDomain } from "@/lib/google-domain";
import { prisma } from "@/lib/prisma";
import { saveLogo } from "@/lib/uploads";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

const optionalUrl = z.preprocess(value => value ?? "", z.string().trim().url().or(z.literal("")));
const optionalDomain = z.preprocess(value => {
  if (typeof value !== "string") return value ?? "";
  try { return normalizeGoogleDomain(value) ?? ""; }
  catch { return value.trim(); }
}, z.string().max(253).refine(value => {
  try { return !value || normalizeGoogleDomain(value) === value; }
  catch { return false; }
}, "Enter a valid website domain."));
const optionalId = z.string().trim().max(200);
const optionalLabel = z.string().trim().max(200);
const brandSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required"),
  websiteUrl: optionalUrl,
  googleDomain: optionalDomain,
  countryCode: z.string().trim().length(2).default("HR"),
  sortOrder: z.coerce.number().int().default(0),
  googleAdvertiserIds: z.array(optionalId).default([]),
  googleAdvertiserLabels: z.array(optionalLabel).default([]),
  metaPageIds: z.array(optionalId).default([]),
  metaPageNames: z.array(optionalLabel).default([]),
});
const nullable = (value?: string) => value?.trim() || null;
export type BrandActionState = { error?: string };

function actionError(error: unknown) {
  if (process.env.NODE_ENV === "development") console.error("Brand save failed:", error);
  if (error instanceof z.ZodError) return error.issues.map(issue => issue.message).join(" ");
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "A brand or source identifier with this value already exists.";
    if (error.code === "P2021" || error.code === "P2022") return "The database schema is not up to date. Run npx prisma db push.";
    return `Database error (${error.code}). The brand was not saved.`;
  }
  if (error instanceof Error && error.message.startsWith("Logo ")) return error.message;
  return "Unable to save the brand. Check the development server log for details.";
}

function entries(ids: string[], labels: string[]) {
  const unique = new Map<string, string | null>();
  ids.forEach((rawId, index) => {
    const id = rawId.trim();
    if (!id) return;
    unique.set(id, nullable(labels[index]));
  });
  return [...unique];
}

function input(formData: FormData) {
  const scalar = brandSchema.parse({
    name: formData.get("name"),
    websiteUrl: formData.get("websiteUrl"),
    googleDomain: formData.get("googleDomain"),
    countryCode: formData.get("countryCode"),
    sortOrder: formData.get("sortOrder"),
    googleAdvertiserIds: formData.getAll("googleAdvertiserIds").map(String),
    googleAdvertiserLabels: formData.getAll("googleAdvertiserLabels").map(String),
    metaPageIds: formData.getAll("metaPageIds").map(String),
    metaPageNames: formData.getAll("metaPageNames").map(String),
  });
  const googleAdvertisers = entries(scalar.googleAdvertiserIds, scalar.googleAdvertiserLabels).map(([advertiserId, label]) => ({ advertiserId, label }));
  const metaPages = entries(scalar.metaPageIds, scalar.metaPageNames).map(([pageId, pageName]) => ({ pageId, pageName }));
  return {
    scalar: { name: scalar.name, websiteUrl: nullable(scalar.websiteUrl), googleDomain: nullable(scalar.googleDomain), countryCode: scalar.countryCode.toUpperCase(), sortOrder: scalar.sortOrder },
    googleAdvertisers,
    metaPages,
  };
}

export async function createBrand(_state: BrandActionState, formData: FormData): Promise<BrandActionState> {
  try {
    const { scalar, googleAdvertisers, metaPages } = input(formData);
    await prisma.$transaction(async tx => {
      const created = await tx.brand.create({ data: scalar });
      if (googleAdvertisers.length) await tx.googleAdvertiser.createMany({ data: googleAdvertisers.map(item => ({ ...item, brandId: created.id })) });
      if (metaPages.length) await tx.metaPage.createMany({ data: metaPages.map(item => ({ ...item, brandId: created.id })) });
      const logoPath = await saveLogo(formData.get("logo") as File, created.id);
      if (logoPath) await tx.brand.update({ where: { id: created.id }, data: { logoPath } });
      return created;
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/brands");
  revalidatePath("/reports/new");
  redirect("/brands");
}

export async function updateBrand(id: string, _state: BrandActionState, formData: FormData): Promise<BrandActionState> {
  try {
    const { scalar, googleAdvertisers, metaPages } = input(formData);
    const logoPath = await saveLogo(formData.get("logo") as File, id);
    await prisma.$transaction(async tx => {
      await tx.brand.update({ where: { id }, data: { ...scalar, ...(logoPath ? { logoPath } : {}) } });
      await tx.googleAdvertiser.deleteMany({ where: { brandId: id } });
      await tx.metaPage.deleteMany({ where: { brandId: id } });
      if (googleAdvertisers.length) await tx.googleAdvertiser.createMany({ data: googleAdvertisers.map(item => ({ ...item, brandId: id })) });
      if (metaPages.length) await tx.metaPage.createMany({ data: metaPages.map(item => ({ ...item, brandId: id })) });
    });
  } catch (error) {
    return { error: actionError(error) };
  }
  revalidatePath("/brands");
  revalidatePath("/reports/new");
  redirect("/brands");
}

export async function deleteBrand(id: string) {
  await prisma.brand.delete({ where: { id } });
  revalidatePath("/brands");
  revalidatePath("/reports/new");
}
