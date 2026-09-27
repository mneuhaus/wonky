// Report / source drawer with latest-wins loading.
//
//   ctx.drawer.open({ title, eyebrow, load(signal), render(data) }) -> data | null
// shows the drawer with "Opening…", loads, and renders only if no newer
// open() or close() happened meanwhile (then it resolves null). A failure of
// the current load rejects; a superseded failure is ignored.
export const id = 'drawer';
export const legacy = true;

// Reports, frozen source, build failures and deltas share one drawer; its
// title names the content (help-a11y request 3).
const DRAWER = '<section id="report-drawer" class="report-drawer" hidden role="dialog"'
  + ' aria-labelledby="report-title"><div class="report-heading"><div><span class="eyebrow">'
  + 'Check report</span><h2 id="report-title"></h2></div><button id="close-report"'
  + ' class="icon-button" aria-label="Close drawer" data-icon="close"></button></div>'
  + '<div id="report-content"></div></section>';

export function setup(ctx) {
  const { slots, commands, dom: { $ } } = ctx;
  slots.add('reviewArea', { id: 'drawer', order: 40, html: DRAWER });
  const scope = ctx.requests.scope('drawer');

  async function openDrawer({ title, eyebrow = title, load, render }) {
    const { token, signal, current } = scope.begin();
    $('#report-drawer').hidden = false;
    $('#report-drawer .eyebrow').textContent = eyebrow;
    $('#report-title').textContent = title;
    $('#report-content').innerHTML = '<p class="muted small">Opening…</p>';
    try {
      const data = await load(signal);
      if (!current()) return null;
      render?.(data, token);
      return data;
    } catch (error) {
      if (current()) throw error;
      return null;
    }
  }
  function closeDrawer() {
    scope.next();
    $('#report-drawer').hidden = true;
  }

  commands.register({ id: 'drawer.close', label: 'Close report', run: closeDrawer });
  commands.bind('#close-report', 'drawer.close');
  ctx.keyboard.onEscape(closeDrawer, 20);
  return { api: { openDrawer, closeDrawer } };
}
