// Inline SVG icon set (no network fonts, no CDN) and [data-icon] hydration.
export const ICON_PATHS = Object.freeze({
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/>'
    + '<path d="m4 7.5 8 4.5 8-4.5M12 12v9M8 5.3l8 4.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  cursor: '<path d="m5 3 14 10-7 1-3 7-4-18Z"/>',
  orbit: '<ellipse cx="12" cy="12" rx="9" ry="5" transform="rotate(-35 12 12)"/>'
    + '<path d="m16 3 4 1-1 4"/><circle cx="12" cy="12" r="2"/>',
  comment: '<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 9h8M7 13h5"/>',
  arrow: '<path d="M5 19 19 5M7 5h12v12"/>',
  box: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  pen: '<path d="m4 16-1 5 5-1L20 8a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m14 6 4 4M4 16l4 4"/>',
  undo: '<path d="m9 5-5 5 5 5M4 10h9a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
  edges: '<path d="m12 3 8 5v8l-8 5-8-5V8l8-5ZM4 8l8 5 8-5M12 13v8"/>'
    + '<path d="m12 3 0 10" stroke-dasharray="2 3"/>',
  fit: '<path d="M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6M8 8h8v8H8z"/>',
  compare: '<path d="M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4"/>',
  swap: '<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>',
  save: '<path d="M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8"/>',
  link: '<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-5 5'
    + 'a4 4 0 0 1-6 0" transform="translate(0 0) scale(.96)"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 13-2l2 3M4 16l2 3a8 8 0 0 0 13-2"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  report: '<path d="M5 3h10l4 4v14H5V3ZM14 3v5h5M8 12h8M8 16h5"/>',
  face: '<path d="m5 7 12-3 3 12-12 4L5 7Z"/>',
  edge: '<path d="m5 18 14-12"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/>',
  vertex: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  trash: '<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
});

// Tree row icons (parts tab, workspace tree): eye, crossed eye, chevron.
const rowSvg = paths => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + `${paths}</svg>`;
export const EYE = rowSvg('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/>'
  + '<circle cx="12" cy="12" r="3"/>');
export const EYE_OFF = rowSvg('<path d="m3 3 18 18M10.6 6.1c.5-.1.9-.1 1.4-.1 6.4 0 10 6 10 6'
  + 'a17 17 0 0 1-3.1 3.8M6.5 6.6C3.7 8.4 2 12 2 12s3.6 6.5 10 6.5c2 0 3.8-.6 5.3-1.5'
  + 'M9.9 9.9a3 3 0 0 0 4.2 4.2"/>');
export const CHEVRON = rowSvg('<path d="m9 6 6 6-6 6"/>');

export const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + `${ICON_PATHS[name] ?? ICON_PATHS.cube}</svg>`;

// Fills every [data-icon] element below `root` (or `root` itself).
export function hydrateIcons(root) {
  if (!root?.querySelectorAll) return;
  const elements = [...(root.matches?.('[data-icon]') ? [root] : []),
    ...root.querySelectorAll('[data-icon]')];
  for (const element of elements) element.innerHTML = icon(element.dataset.icon);
}
