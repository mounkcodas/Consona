import worker, { SocialUser, ListeningSession } from '../src/index.js';
export { ListeningSession };
export class MeasuredSocialUser extends SocialUser {
  constructor(ctx, env) {
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS test_metrics(id INTEGER PRIMARY KEY,reads INTEGER,writes INTEGER)');
    ctx.storage.sql.exec('INSERT OR IGNORE INTO test_metrics VALUES(1,0,0)');
    const count = result => { ctx.storage.sql.exec('UPDATE test_metrics SET reads=reads+?,writes=writes+? WHERE id=1', result.meta?.rows_read || 0, result.meta?.rows_written || 0); return result; };
    const wrap = statement => ({
      raw: statement, bind(...args) { return wrap(statement.bind(...args)); },
      async all() { return count(await statement.all()); }, async run() { return count(await statement.run()); },
      async first(column) { const row = count(await statement.all()).results[0] || null; return column && row ? row[column] : row; },
    });
    const DB = { prepare(sql) { return wrap(env.DB.prepare(sql)); }, async batch(statements) { return (await env.DB.batch(statements.map(s => s.raw))).map(count); } };
    super(ctx, { ...env, DB });
  }
  metrics() { return this.ctx.storage.sql.exec('SELECT reads,writes FROM test_metrics').toArray()[0]; }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/_test/metrics') return Response.json(await env.SOCIAL.getByName(url.searchParams.get('user')).metrics());
    return worker.fetch(request, env, ctx);
  },
};
