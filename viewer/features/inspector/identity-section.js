// Identity section behavior: Copy reference (spec 3.5, 3.7). Package:
// reviews-context.
//
// In the browser, Copy reference asks the server for the reference text
// (POST /api/context, kind references): the server archives the revision
// first and adds the snapshot path, the exact summary and a wonky-inspect
// command that resolves after the server stops. Under the legacy seam (VS)
// the inspector's own handler stays: it composes {modelId, bodyId,
// entityType, entityIndex, alias, identity, source?} locally, with no request.

// Rebinds #copy-selection after the inspector rendered a selection.
export function bindReferenceCopy(ctx, reference) {
  if (ctx.legacy || !reference) return;
  const button = ctx.dom.$('#copy-selection');
  if (!button) return;
  button.title = 'Copy the exact reference with an inspect command that works offline';
  button.onclick = async () => {
    try {
      await ctx.app.copyContext('references', { references: [reference] });
    } catch (error) {
      ctx.showError(error);
    }
  };
}
