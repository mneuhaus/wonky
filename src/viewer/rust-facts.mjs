// Kernel measurements of Rust WC0 records for the viewer.
//
// One OP_MEASURE call per record body (cached per body object): volume, area and
// bounding box with the kernel's stated bounds, and the area and perimeter of
// every face, keyed by projection face index (WC0 face `recordFaceOrder(body)[k]`).
// These are the numbers `bin/wonky.mjs --json` reports; display triangles are never
// read.
import { measureRustBody, rustHostOf } from '../native/rust-host.mjs';
import { isRustRecord, recordFaceOrder, recordWords } from '../rust-review-scene.mjs';

export const RUST_FACTS_SOURCE = 'rust-kernel-measure';
const cache = new WeakMap();

export function rustBodyFacts(kernel, body) {
  if (!rustHostOf(kernel) || !isRustRecord(body)) return null;
  if (!cache.has(body)) {
    const m = measureRustBody(kernel, recordWords(body));
    const order = recordFaceOrder(body);
    cache.set(body, {
      source: RUST_FACTS_SOURCE,
      volumeMm3: m.volumeMm3, areaMm2: m.areaMm2, bboxMm: m.bboxMm,
      volumeRelBound: m.volumeRelBound, areaRelBound: m.areaRelBound,
      exactness: { volume: 'bounded', area: 'bounded', bbox: 'rounded' },
      closed: m.validity?.closed ?? null,
      faces: order.map((wc0, k) => ({ index: k, areaMm2: m.faceAreasMm2[wc0], perimeterMm: m.facePerimetersMm[wc0] })),
      toleranceMm: m.toleranceMm ?? null,
    });
  }
  return cache.get(body);
}
