import assert from "node:assert/strict";
import { MAX_REPRESENTATIVE_MEDIA_PER_BRAND, representativeStorageProjection } from "../lib/storage-policy";

assert.equal(MAX_REPRESENTATIVE_MEDIA_PER_BRAND, 16);
assert.deepEqual(representativeStorageProjection(35, 300_000), { imageCount: 560, totalBytes: 168_000_000 });
assert.deepEqual(representativeStorageProjection(35, 500_000), { imageCount: 560, totalBytes: 280_000_000 });
assert.deepEqual(representativeStorageProjection(35, 1_000_000), { imageCount: 560, totalBytes: 560_000_000 });
console.log("Storage policy calculations passed.");
