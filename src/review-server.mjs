// Facade of the viewer server (src/viewer/**). Kept so existing imports and
// tests keep working: createReviewServer and validateReview.
export { createReviewServer } from './viewer/server.mjs';
export { validateReview } from './viewer/reviews.mjs';
