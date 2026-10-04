// Validate storage before assigning citation labels or sending metadata to AI.
// One missing/corrupt file must not prevent analysis of the remaining evidence.
export async function readableEvidence<T, Image>(items: T[], readImage: (item: T) => Promise<Image>) {
  const readable: Array<{ item: T; image: Image }> = [];
  for (const item of items) {
    try { readable.push({ item, image: await readImage(item) }); }
    catch { /* Not usable evidence; neither its text nor its image goes to AI. */ }
  }
  return readable;
}
