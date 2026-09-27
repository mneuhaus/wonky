// The single owner of the "Unsaved changes" state (spec D9). Package:
// reviews-context. Other features call ctx.review.touch(reason); nothing else
// sets state.dirty.
//
// Rule: the review is dirty when it has content (a title, notes or an
// annotation) and its dirty payload differs from the last saved or loaded
// one. The dirty payload is the review payload without the camera and the
// derived model list: title as typed, notes, comparison (before, after,
// split, compare, layout) and annotations. So with an empty review, toggling
// compare, layout or the camera never shows "Unsaved changes", and undoing
// the last change returns to "Saved".
//
// The stale-save check of an in-flight save (reviews.js) compares the same
// payload, so it still covers comparison and layout (VS save-race tests).

// Comparable review state from the reviews feature's reviewPayload() plus
// the raw title field (the payload's title falls back to "<model> review").
export function dirtyPayload(payload, rawTitle = payload.title) {
  const { before, after, split, compare, layout } = payload.comparison ?? {};
  return {
    title: String(rawTitle ?? '').trim(),
    notes: String(payload.notes ?? '').trim(),
    comparison: { before, after, split, compare, layout },
    annotations: payload.annotations ?? [],
  };
}

export const dirtyKey = value => JSON.stringify(value);

export const hasContent = value => Boolean(value.title || value.notes
  || value.annotations.length);

// { dirty, text } for a dirty payload against the saved baseline key.
export function dirtyState(value, baseline, saved) {
  const dirty = hasContent(value) && (baseline === null || dirtyKey(value) !== baseline);
  if (dirty) return { dirty, text: 'Unsaved changes' };
  return { dirty, text: saved ? `Saved · ${saved.id}` : '' };
}

// `snapshot()` returns the current dirty payload (reviews.js passes it in).
export function createDirty(ctx, { snapshot }) {
  const { state, dom: { $ } } = ctx;
  let baseline = null;

  function render() {
    const next = dirtyState(snapshot(), baseline, state.saved);
    state.dirty = next.dirty;
    $('#save-state').textContent = next.text;
    return next.dirty;
  }
  return {
    // Re-evaluates after any change; `reason` names the change (debugging).
    touch: () => render(),
    // The current payload is what was saved or loaded.
    markSaved() {
      baseline = dirtyKey(snapshot());
      return render();
    },
    // Key of the current dirty payload (the stale-save check compares two).
    key: () => dirtyKey(snapshot()),
  };
}
