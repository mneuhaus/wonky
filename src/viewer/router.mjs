// Method + path router (frozen contract).
//
//   router.add(method, pattern, handler, { legacy })
//
// `pattern` is an exact path string or a RegExp tested against the pathname;
// capture groups arrive as `match` (RegExp result) in the handler context.
// Handlers receive (req, res, { url, match }). Routes are tried in
// registration order; the first match answers. Nothing matches: 404
// "Unknown route".
//
// Error mapping: an HttpError answers with its status. Otherwise a legacy
// route (every route that existed before the foundation) keeps the old
// mapping ENOENT -> 404, anything else -> 400; new routes map ENOENT -> 404
// and anything else -> 500.
import { HttpError, send } from './http.mjs';

export function errorStatus(error, legacy) {
  if (error instanceof HttpError) return error.status;
  if (error?.code === 'ENOENT') return 404;
  return legacy ? 400 : 500;
}

export function createRouter() {
  const routes = [];
  const matches = (route, method, pathname) => {
    if (route.method !== method && route.method !== '*') return null;
    if (typeof route.pattern === 'string') return route.pattern === pathname ? [pathname] : null;
    return route.pattern.exec(pathname);
  };
  return {
    add(method, pattern, handler, { legacy = false, name } = {}) {
      if (typeof handler !== 'function') throw new TypeError('Route handler must be a function');
      if (typeof pattern !== 'string' && !(pattern instanceof RegExp)) {
        throw new TypeError('Route pattern must be a path string or a RegExp');
      }
      routes.push({ method: method.toUpperCase(), pattern, handler, legacy, name });
    },
    routes: () => routes.map(({ method, pattern, legacy, name }) => ({
      method, pattern: String(pattern), legacy, name,
    })),
    // Returns true when a route answered.
    async handle(req, res, url) {
      for (const route of routes) {
        const match = matches(route, req.method, url.pathname);
        if (!match) continue;
        try {
          await route.handler(req, res, { url, match });
        } catch (error) {
          if (res.headersSent) {
            res.destroy(error);
          } else {
            send(res, errorStatus(error, route.legacy), { error: error.message });
          }
        }
        return true;
      }
      return false;
    },
  };
}
