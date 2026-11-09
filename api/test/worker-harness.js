import worker from '../src/index.js';

// Test-only wrapper: exercise the actual Worker/D1/R2/Cache runtime and expose
// D1 accounting without adding diagnostics or test routes to production.
export default {
  async fetch(request, env, ctx) {
    let reads = 0;
    const count = result => { reads += result.meta?.rows_read || 0; return result; };
    const wrap = statement => ({
      raw: statement,
      bind(...args) { return wrap(statement.bind(...args)); },
      async all() { return count(await statement.all()); },
      async run() { return count(await statement.run()); },
      async first(column) {
        const row = count(await statement.all()).results[0] || null;
        return column && row ? row[column] : row;
      },
    });
    const DB = {
      prepare(sql) { return wrap(env.DB.prepare(sql)); },
      async batch(statements) { return (await env.DB.batch(statements.map(item => item.raw))).map(count); },
    };
    const response = await worker.fetch(request, { ...env, DB }, ctx);
    const headers = new Headers(response.headers);
    headers.set('X-Test-D1-Rows-Read', String(reads));
    return new Response(response.body, { status: response.status, headers });
  },
};
