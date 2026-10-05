import assert from "node:assert/strict";
import { MAX_REPRESENTATIVE_MEDIA_PER_BRAND, representativeStorageProjection } from "../lib/storage-policy";

assert.equal(MAX_REPRESENTATIVE_MEDIA_PER_BRAND, 10);
assert.deepEqual(representativeStorageProjection(35, 300_000), { imageCount: 350, totalBytes: 105_000_000 });
assert.deepEqual(representativeStorageProjection(35, 500_000), { imageCount: 350, totalBytes: 175_000_000 });
assert.deepEqual(representativeStorageProjection(35, 1_000_000), { imageCount: 350, totalBytes: 350_000_000 });
console.log("Storage policy calculations passed.");
