// Route module loader. Every module is imported in isolation and exports
// `register(router, ctx)`. A module that fails to import or register logs
// its error; its planned paths then answer 500 "route module <name> failed
// to load" and the server still starts.
//
// `planned` lists each module's paths (method + pattern) so a failed module
// still answers explicitly. Stub modules register nothing yet; their planned
// paths fall through to 404 "Unknown route" until the owning package lands.
import { HttpError } from '../http.mjs';

const MODEL = '[a-f0-9]{64}';
const model = suffix => new RegExp(`^/api/models/${MODEL}/${suffix}$`);

export const ROUTE_MODULES = Object.freeze([
  {
    name: 'core',
    planned: [
      ['GET', '/'], ['GET', /^\/viewer\//], ['GET', '/api/workspace'],
      ['GET', new RegExp(`^/api/models/${MODEL}$`)], ['GET', model('summary')],
      ['GET', model('entities/[^/]+')], ['GET', new RegExp(`^/api/source/${MODEL}$`)],
      ['GET', /^\/api\/reports\//], ['POST', model('archive')],
    ],
  },
  { name: 'settings', planned: [['GET', '/api/settings'], ['PUT', '/api/settings']] },
  {
    name: 'reviews',
    planned: [['GET', /^\/api\/feedback\/[^/]+(\/context)?$/], ['POST', '/api/feedback']],
  },
  {
    name: 'live',
    planned: [
      ['GET', '/api/events'], ['GET', '/api/live'], ['POST', '/api/live/pins'],
      ['POST', /^\/api\/live\/[^/]+\/(rebuild|cancel)$/],
    ],
  },
  { name: 'draw', planned: [['GET', model('draw')]] },
  { name: 'topology', planned: [['GET', model('topology')]] },
  { name: 'geometry', planned: [['GET', model('geometry')]] },
  { name: 'measure', planned: [['POST', model('measure')]] },
  { name: 'compare', planned: [['GET', '/api/compare'], ['GET', '/api/compare/revisions']] },
  { name: 'resolve', planned: [['POST', model('resolve')]] },
  { name: 'history', planned: [['GET', model('history')]] },
  { name: 'selection', planned: [['GET', '/api/selection'], ['POST', '/api/selection']] },
  { name: 'export', planned: [['GET', model('print\\.(stl|json)')]] },
  { name: 'parts', planned: [['GET', model('parts')]] },
  { name: 'printability', planned: [['POST', model('printability')]] },
  { name: 'section', planned: [['POST', model('section')]] },
  { name: 'diff', planned: [['GET', '/api/diff']] },
  { name: 'thickness', planned: [['POST', model('thickness')]] },
]);

// Loads `modules` in order. Each entry may carry `url` (tests inject broken
// modules this way); otherwise ./<name>.mjs next to this file.
export async function loadRoutes(router, ctx, {
  modules = ROUTE_MODULES,
  log = message => console.error(message),
} = {}) {
  const failures = [];
  for (const entry of modules) {
    const staged = [];
    const stagingRouter = {
      add: (method, pattern, handler, options) => staged.push([method, pattern, handler, options]),
    };
    try {
      const url = entry.url ?? new URL(`./${entry.name}.mjs`, import.meta.url);
      const module = await import(url);
      if (typeof module.register !== 'function') {
        throw new Error('module does not export register(router, ctx)');
      }
      await module.register(stagingRouter, ctx);
      for (const route of staged) router.add(...route);
    } catch (error) {
      failures.push({ name: entry.name, error });
      log(`wonky-view: route module ${entry.name} failed to load: ${error.message}`);
      const fail = () => {
        throw new HttpError(500, `route module ${entry.name} failed to load`);
      };
      for (const [method, pattern] of entry.planned ?? []) router.add(method, pattern, fail);
    }
  }
  return failures;
}
