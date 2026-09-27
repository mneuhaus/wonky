// Measure feature (package exact-measure, P0): exact geometry section, hover
// status line, multi-selection measurement and the viewport dimension line.
// The composition lives in measure-section.js (setupExactMeasure).
import { setupExactMeasure } from './measure-section.js';

export const id = 'measure';
export const legacy = false;

export function setup(ctx) {
  return setupExactMeasure(ctx);
}
