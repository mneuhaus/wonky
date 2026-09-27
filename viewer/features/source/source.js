// Operation source: the inspector section and the frozen source drawer.
// Owner after W2: source-links. A face or edge made by a sketch extrusion
// shows its sketch entity first; the body operation is context
// (docs/viewer/source-links.md).
import { sourceFor } from '../../core/scene-records.js';
import { createSourceDrawer } from './source-drawer.js';
import { sourceLinks, sourceMarkup, sourceReference } from './source-section.js';

export const id = 'source';
export const legacy = true;

export function setup(ctx) {
  const { slots, dom: { $ } } = ctx;
  const openSource = createSourceDrawer(ctx);
  const editor = () => ctx.settings.get('G', 'editor', 'zed');
  slots.inspector.section({
    id: 'source.operation',
    order: 40,
    render: ({ records }) => sourceMarkup(sourceFor(records), records, { editor: editor() }),
    bind({ records }) {
      const source = sourceFor(records);
      const links = sourceLinks(records, source);
      if ($('#copy-source')) {
        // Keeps every key of the record-level source (INS-10) and adds the
        // sketch entity and the helper call site.
        $('#copy-source').onclick = () => ctx.copyText(
          JSON.stringify(sourceReference(links, source), null, 2), 'Source reference copied');
      }
      if ($('#open-source')) {
        // The drawer derives its focus (sketch line, context) from the selection.
        $('#open-source').onclick = () => openSource(source).catch(ctx.showError);
      }
    },
  });
  return { api: { openSource }, legacy: { harness: { openSource } } };
}
