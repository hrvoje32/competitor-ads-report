export const MAX_REPRESENTATIVE_MEDIA_PER_SOURCE = 8;
export const MAX_REPRESENTATIVE_MEDIA_PER_BRAND = MAX_REPRESENTATIVE_MEDIA_PER_SOURCE * 2;

export function representativeStorageProjection(brandCount: number, averageImageBytes: number) {
  const imageCount = brandCount * MAX_REPRESENTATIVE_MEDIA_PER_BRAND;
  return { imageCount, totalBytes: imageCount * averageImageBytes };
}
