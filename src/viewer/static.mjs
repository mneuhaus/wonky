// Static serving of viewer/** (ES modules, CSS, icons) without a build step.
//
// `/viewer/` serves index.html. Paths are percent-decoded and normalized;
// anything that is not a regular file inside viewer/ with a known type
// (traversal, dotfiles, directories, unknown extensions, missing files)
// answers 404 "Unknown viewer asset".
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { HttpError, sendBinary } from './http.mjs';

export const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
});

const unknown = () => new HttpError(404, 'Unknown viewer asset');

// Maps a URL pathname below /viewer/ to an absolute file path, or throws 404.
export function resolveViewerPath(viewerDirectory, pathname) {
  if (!pathname.startsWith('/viewer/')) throw unknown();
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname.slice('/viewer/'.length));
  } catch {
    throw unknown();
  }
  if (relativePath === '') relativePath = 'index.html';
  const segments = relativePath.split('/');
  const bad = segment => segment === '' || segment === '.' || segment === '..'
    || segment.startsWith('.') || /[\\\0:]/.test(segment);
  if (segments.some(bad)) throw unknown();
  const root = resolve(viewerDirectory);
  const file = resolve(root, ...segments);
  if (!file.startsWith(root + sep)) throw unknown();
  if (!MIME_TYPES[extname(file)]) throw unknown();
  return file;
}

export function createStaticHandler(viewerDirectory) {
  return async function serveViewer(req, res, { url }) {
    const file = resolveViewerPath(viewerDirectory, url.pathname);
    let info;
    try {
      info = await stat(file);
    } catch {
      throw unknown();
    }
    if (!info.isFile()) throw unknown();
    sendBinary(res, 200, await readFile(file), { type: MIME_TYPES[extname(file)] });
  };
}

export const viewerDirectoryOf = projectRoot => join(projectRoot, 'viewer');
