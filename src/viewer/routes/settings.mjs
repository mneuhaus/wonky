// GET/PUT /api/settings (spec D19): the settings document, scopes G/S/SB.
// PUT takes a patch ({global?, sources?, bodies?}; null deletes a key) and
// answers the merged document.
import { readJson, sendJson } from '../http.mjs';
import { SETTINGS_LIMIT } from '../settings.mjs';

export function register(router, ctx) {
  router.add('GET', '/api/settings', async (_req, res) => {
    sendJson(res, 200, await ctx.settings.read());
  });
  router.add('PUT', '/api/settings', async (req, res) => {
    const patch = await readJson(req, {
      limit: SETTINGS_LIMIT, tooLarge: 'Settings exceed 256 KiB',
    });
    sendJson(res, 200, await ctx.settings.update(patch));
  });
}
