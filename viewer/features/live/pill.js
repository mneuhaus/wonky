// Live pill (header), trust chip (viewport bottom line) and busy bar (top of
// the viewport). Package: live-client.
//
// The pill replaces the header's "N model versions" status while live
// sources exist. The header status is hidden below 1150 px (RSP-02), so the
// trust chip in the viewport HUD carries the same trust state at every
// width (spec section 4), with Cancel and Go to latest. Next to it, the
// "r4 available" chip appears when a newer good revision is not displayed
// (follow off or paused), with the reason.
const PILL = '<div id="live-pill" class="live-pill" data-tone="neutral" role="status"'
  + ' aria-live="polite" hidden><span class="live-dot" aria-hidden="true"></span>'
  + '<span id="live-pill-text" class="live-text"></span>'
  + '<span id="live-pill-extra" class="live-extra"></span>'
  + '<button id="live-pill-cancel" class="live-action" type="button" hidden'
  + ' title="Cancel this build; the last good model stays">Cancel</button>'
  + '<button id="live-pill-latest" class="live-action" type="button" hidden>Go to latest</button>'
  + '<button id="live-pill-details" class="live-action" type="button" hidden>Details</button>'
  + '<button id="live-pill-rebuild" class="live-action" type="button" hidden>Rebuild</button>'
  + '<button id="live-follow" class="live-follow" type="button" aria-pressed="true"'
  + ' aria-keyshortcuts="L" title="Follow live: show each new revision (L)"><span'
  + ' id="live-follow-text">Follow on</span> <kbd class="key-hint">L</kbd></button></div>';

const HUD = '<div id="live-hud" class="live-hud" hidden><div id="live-chip" class="live-chip"'
  + ' data-tone="neutral" role="status" aria-live="polite"><span class="live-dot"'
  + ' aria-hidden="true"></span><span id="live-chip-text" class="live-text"></span>'
  + '<button id="live-chip-cancel" class="live-action" type="button" hidden>Cancel</button>'
  + '<button id="live-chip-latest" class="live-action" type="button" hidden>Go to latest</button>'
  + '</div><button id="live-available" class="live-available" type="button" hidden></button>'
  + '</div>';

const BUSY = '<div id="live-busy" class="live-busy" role="progressbar" aria-label="Building"'
  + ' hidden><span class="live-busy-bar"></span></div>';

export function createPill(ctx) {
  const { slots, commands, dom: { $ } } = ctx;
  slots.header.status({ id: 'live.pill', order: 5, html: PILL });
  slots.statusBar.item({ id: 'live.trust', order: 5, html: HUD });
  slots.add('stage', { id: 'live.busy', order: 2, html: BUSY });

  commands.bind('#live-pill-cancel', 'live.cancel');
  commands.bind('#live-chip-cancel', 'live.cancel');
  commands.bind('#live-pill-latest', 'live.latest');
  commands.bind('#live-chip-latest', 'live.latest');
  commands.bind('#live-available', 'live.latest');
  commands.bind('#live-pill-details', 'live.details');
  commands.bind('#live-pill-rebuild', 'live.rebuild');
  commands.bind('#live-follow', 'live.follow');

  const show = (selector, visible) => {
    const element = $(selector);
    if (element && element.hidden === visible) element.hidden = !visible;
  };
  const text = (selector, value) => {
    const element = $(selector);
    if (element && element.textContent !== value) element.textContent = value;
  };
  const attribute = (selector, name, value) => {
    const element = $(selector);
    if (!element) return;
    if (name.startsWith('data-')) element.dataset[name.slice(5)] = value;
    else element.setAttribute(name, value);
  };

  // view: { visible, trust: { row, tone, text, actions }, extra, follow,
  //         followNote, available: { revision, note } | null, busy }
  function render(view) {
    const header = $('.header-center');
    if (header) header.dataset.live = view.live ? 'true' : 'false';
    // .brep.json-only workspaces keep the header status; the chip still shows.
    show('#live-pill', view.visible && view.live);
    show('#live-hud', view.visible);
    show('#live-busy', view.visible && !!view.busy);
    if (!view.visible) return;
    const { trust } = view;
    for (const target of ['#live-pill', '#live-chip']) {
      attribute(target, 'data-tone', trust.tone);
      attribute(target, 'data-row', trust.row);
      const element = $(target);
      if (element) element.title = trust.text;
    }
    text('#live-pill-text', trust.text);
    text('#live-chip-text', trust.text);
    text('#live-pill-extra', view.extra ? `· ${view.extra}` : '');
    const has = action => trust.actions.includes(action);
    show('#live-pill-cancel', has('cancel'));
    show('#live-chip-cancel', has('cancel'));
    show('#live-pill-latest', has('latest'));
    show('#live-chip-latest', has('latest') && !view.available);
    show('#live-pill-details', has('details'));
    show('#live-pill-rebuild', has('rebuild'));
    show('#live-follow', view.live);
    attribute('#live-follow', 'aria-pressed', String(view.follow === 'on'));
    attribute('#live-follow', 'data-follow', view.follow);
    text('#live-follow-text', `Follow ${view.follow}`);
    const follow = $('#live-follow');
    if (follow) {
      follow.title = view.follow === 'paused' ? `Follow live paused: ${view.followNote} (L)`
        : view.follow === 'on' ? 'Follow live: show each new revision (L)'
          : 'Follow live is off: new revisions wait (L)';
    }
    const available = view.available;
    show('#live-available', !!available);
    if (available) {
      text('#live-available', `r${available.revision} available`
        + (available.note ? ` · ${available.note}` : ''));
      const element = $('#live-available');
      if (element) element.title = `Show r${available.revision} (keeps the camera)`;
    }
    const busy = $('#live-busy');
    if (busy && view.busy) busy.setAttribute('aria-label', view.busy);
  }

  return { render };
}
