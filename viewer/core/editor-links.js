// "Open in editor" links: file:line:column in the configured editor scheme.
// Default zed:// (setting "editor", scope G).
export const EDITOR_SCHEMES = Object.freeze({
  zed: 'zed://file',
  vscode: 'vscode://file',
  cursor: 'cursor://file',
});

export const DEFAULT_EDITOR = 'zed';

export function editorLink({ file, line, column } = {}, scheme = DEFAULT_EDITOR) {
  const base = EDITOR_SCHEMES[scheme];
  if (!base) throw new Error(`Unknown editor scheme ${scheme}`);
  if (!file || !file.startsWith('/')) return null;
  const path = file.split('/').map(encodeURIComponent).join('/');
  const position = line ? `:${line}${column ? `:${column}` : ''}` : '';
  return `${base}${path}${position}`;
}

// Location of a recorded source descriptor ({file, span: {line, column}} or
// {file, span: {start: {line, column}}}).
export function sourceLocation(source) {
  const start = source?.span?.start ?? source?.span;
  return { file: source?.file, line: start?.line, column: start?.column };
}
