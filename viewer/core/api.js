// HTTP helpers over the environment's fetch. json() keeps the exact request
// shape and error mapping of the pre-foundation `api()` helper.
export function createApi(env) {
  const fetch = (...args) => env.fetch(...args);
  async function json(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const response = await fetch(path, { headers, ...options });
    const failed = () => ({ error: `Request failed (${response.status})` });
    const data = await response.json().catch(failed);
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  return {
    fetch,
    json,
    post: (path, body, options = {}) => json(path, {
      method: 'POST', body: JSON.stringify(body), ...options,
    }),
    put: (path, body, options = {}) => json(path, {
      method: 'PUT', body: JSON.stringify(body), ...options,
    }),
    async text(path, { unavailable = `Request failed`, ...options } = {}) {
      const response = await fetch(path, options);
      if (!response.ok) throw new Error(unavailable);
      return response.text();
    },
    async binary(path, options = {}) {
      const response = await fetch(path, options);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${response.status})`);
      }
      const etag = response.headers?.get?.('ETag') ?? null;
      return { buffer: await response.arrayBuffer(), etag };
    },
  };
}
