import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

function statements(sql) {
  let buffer = ''; const result = [];
  for (const line of sql.replace(/^--.*$/gm, '').split('\n')) { buffer += line + '\n'; if (/CREATE TRIGGER/i.test(buffer) ? /END;\s*$/.test(buffer) : /;\s*$/.test(buffer)) { result.push(buffer.trim()); buffer = ''; } }
  return result;
}
const base = 'https://social.test', a = randomUUID(), b = randomUUID(), c = randomUUID(), track = randomUUID();
const tokens = new Map([[a,'a'.repeat(64)],[b,'b'.repeat(64)],[c,'c'.repeat(64)]]);
test('friends, private chat and musical sessions run in the real D1/R2/DO runtime', async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: ['api/test/social-harness.js','api/src/index.js','api/src/import-workspace.js','api/src/library-cache.js','api/src/social-api.js','api/src/social-core.js','api/src/social-realtime.js'].map(path => ({ type:'ESModule',path:resolve(path) })),
    compatibilityDate:'2026-11-03', d1Databases:['DB'], r2Buckets:['MEDIA'], durableObjects:{ SOCIAL:{className:'MeasuredSocialUser',useSQLite:true}, LISTENING:{className:'ListeningSession',useSQLite:true} } }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('api/migrations')).sort()) for (const sql of statements(await readFile(`api/migrations/${file}`,'utf8'))) await db.prepare(sql).run();
  for (const [id,name] of [[a,'alice'],[b,'bob'],[c,'outsider']]) {
    await db.prepare("INSERT INTO users(id,username,display_name,password_salt,password_hash) VALUES(?,?,?,'','')").bind(id,name,name).run();
    await db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,datetime('now','+1 day'))").bind(createHash('sha256').update(tokens.get(id)).digest('hex'),id).run();
  }
  await db.prepare("INSERT INTO tracks(id,title,artist,album,audio_key,duration_seconds,added_by) VALUES(?,'Song','Artist','Album','tracks/test.mp3',240,?)").bind(track,a).run();
  async function request(path, user = a, method = 'GET', body) {
    const headers = { Origin:'https://consona.live', ...(user ? {Authorization:`Bearer ${tokens.get(user)}`} : {}) };
    if (body && !(body instanceof FormData)) headers['Content-Type']='application/json';
    let payload = body ? JSON.stringify(body) : undefined;
    if (body instanceof FormData) { const encoded = new Request(base + path,{method,body});headers['Content-Type']=encoded.headers.get('Content-Type');payload=new Uint8Array(await encoded.arrayBuffer()); }
    const response = await mf.dispatchFetch(base + path, {method,headers,body:payload});
    return { status:response.status, body:await response.json().catch(() => null), headers:response.headers };
  }
  const social = (path, user = a, method = 'GET', body) => request('/api/social' + path,user,method,body);
  const ok = response => { assert.ok(response.status < 300, JSON.stringify(response)); return response.body; };
  let conversation, wsA, wsB, sent, attachment;
  const eventsA = [], eventsB = [];
  async function connect(id, events) {
    const ticket = ok(await social('/ticket',id,'POST'));
    const response = await mf.dispatchFetch(ticket.url.replace('wss:','https:'),{headers:{Upgrade:'websocket',Origin:'https://consona.live'}});
    assert.equal(response.status,101); const ws=response.webSocket; ws.accept();
    ws.addEventListener('message',e => { if(e.data !== 'pong') events.push(JSON.parse(e.data)); });
    return { ws, url:ticket.url.replace('wss:','https:') };
  }
  async function until(fn) { for(let i=0;i<80;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}assert.ok(fn(),'expected real-time event'); }
  await t.test('requires auth, searches users and accepts only addressed requests',async()=>{
    assert.equal((await social('/state',null)).status,401);
    const state=ok(await social('/state')); assert.equal(state.settings.show_activity,0); assert.deepEqual(state.friends,[]);
    assert.equal(ok(await social('/users?q=bo')).users[0].id,b);
    ok(await social(`/friends/${b}`,a,'POST'));
    assert.equal((await social(`/requests/${a}`,c,'POST',{action:'accept'})).status,409);
    assert.equal(ok(await social('/state',b)).incoming[0].id,a);
    ok(await social(`/requests/${a}`,b,'POST',{action:'accept'}));
    assert.equal(ok(await social('/state')).friends[0].id,b);
    conversation=ok(await social('/conversations',a,'POST',{userId:b})).id;
    assert.equal(ok(await social('/conversations',b,'POST',{userId:a})).id,conversation);
    assert.equal((await social('/conversations',c,'POST',{userId:b})).status,403);
  });
  await t.test('one-use websocket tickets and persisted private, idempotent messages',async()=>{
    const one=await connect(a,eventsA); wsA=one.ws; wsB=(await connect(b,eventsB)).ws;
    assert.equal((await mf.dispatchFetch(one.url,{headers:{Upgrade:'websocket'}})).status,401);
    const clientId=randomUUID(), data={text:'Olá música https://consona.live',clientId};
    sent=ok(await social(`/conversations/${conversation}/messages`,a,'POST',data)).message;
    const retry=ok(await social(`/conversations/${conversation}/messages`,a,'POST',data)).message;
    assert.equal(sent.id,retry.id);
    await until(()=>eventsB.some(e=>e.type==='message'&&e.message.id===sent.id));
    await until(()=>eventsA.some(e=>e.type==='message'&&e.message.id===sent.id));
    assert.equal(ok(await social('/state',b)).conversations[0].unread,1);
    assert.equal((await social(`/conversations/${conversation}/messages`,c)).status,404);
    assert.equal((await social(`/messages/${sent.id}`,b,'PUT',{text:'hack'})).status,404);
    ok(await social(`/conversations/${conversation}/receipt`,b,'POST',{seq:sent.seq,read:true}));
    assert.equal(ok(await social('/state',b)).conversations[0].unread,0);
    await until(()=>eventsA.some(e=>e.type==='receipt'&&e.readSeq===sent.seq));
    ok(await social(`/messages/${sent.id}`,a,'PUT',{text:'Música editada'}));
    assert.equal(ok(await social(`/conversations/${conversation}/messages?q=editada`,b)).messages[0].id,sent.id);
  });
  await t.test('attachments validate content and never bypass conversation authorization',async()=>{
    const invalid=new FormData();invalid.set('file',new File(['<script>alert(1)</script>'],'fake.png',{type:'image/png'}));
    assert.equal((await social(`/attachments?conversation=${conversation}`,a,'POST',invalid)).status,400);
    const form=new FormData();form.set('file',new File(['mensagem segura'],'notes.txt',{type:'text/plain'}));
    attachment=ok(await social(`/attachments?conversation=${conversation}`,a,'POST',form));
    assert.equal((await social(`/attachments/${attachment.id}`,b)).status,403);
    const data={clientId:randomUUID(),kind:'attachment',attachmentId:attachment.id};
    const msg=ok(await social(`/conversations/${conversation}/messages`,a,'POST',data)).message;
    assert.equal(ok(await social(`/conversations/${conversation}/messages`,a,'POST',data)).message.id,msg.id);
    assert.equal((await social(`/attachments/${attachment.id}`,b)).status,200);
    assert.equal((await social(`/attachments/${attachment.id}`,c)).status,404);
    assert.equal((await request(`/api/media/${encodeURIComponent(`social/${a}/${attachment.id}`)}`,null)).status,404);
    ok(await social(`/messages/${msg.id}`,a,'DELETE'));
    assert.equal((await social(`/attachments/${attachment.id}`,b)).status,404);
  });
  await t.test('pagination is indexed, ordered and search never leaks another conversation',async()=>{
    for(let start=0;start<120;start+=30) await db.batch(Array.from({length:30},(_,i)=>db.prepare("INSERT INTO messages(id,conversation_id,sender_id,client_id,body,created_at) VALUES(?,?,?,?,'Historical music',?)").bind(randomUUID(),conversation,a,randomUUID(),Date.now()+start+i)));
    const first=ok(await social(`/conversations/${conversation}/messages`,b));
    assert.equal(first.messages.length,40);assert.equal(first.hasMore,true);
    const second=ok(await social(`/conversations/${conversation}/messages?before=${first.nextBefore}`,b));
    assert.equal(second.messages.length,40);assert.ok(second.messages.at(-1).seq<first.messages[0].seq);
    assert.equal(ok(await social(`/conversations/${conversation}/messages?q=Historical`,b)).messages.length,40);
    const otherConversation=[a,c].sort().join(':');
    await db.prepare('INSERT INTO conversations(id,created_at,updated_at) VALUES(?,?,?)').bind(otherConversation,Date.now(),Date.now()).run();
    for(let start=0;start<600;start+=30) await db.batch(Array.from({length:30},()=>db.prepare("INSERT INTO messages(id,conversation_id,sender_id,client_id,body,created_at) VALUES(?,?,?,?,'Historical music outside',?)").bind(randomUUID(),otherConversation,c,randomUUID(),Date.now())));
    const scoped=await db.prepare('SELECT m.* FROM social_message_search JOIN messages m ON m.seq=social_message_search.rowid WHERE social_message_search MATCH ? AND m.conversation_id=? ORDER BY m.seq DESC LIMIT 41').bind(`search_scope : "${conversation.replaceAll(':','').replaceAll('-','')}" AND body : ("Historical")`,conversation).all();
    assert.equal(scoped.results.length,41);assert.ok(scoped.meta.rows_read<600,`scoped search read ${scoped.meta.rows_read} rows`);
    const plan=await db.prepare('EXPLAIN QUERY PLAN SELECT * FROM messages WHERE conversation_id=? AND seq<? ORDER BY seq DESC LIMIT 41').bind(conversation,999999).all();
    assert.ok(plan.results.some(r=>r.detail.includes('idx_messages_page')));
  });
  await t.test('presence, typing and repeated track position updates do not read or write D1',async()=>{
    ok(await social('/settings',a,'PUT',{show_activity:true,share_history:true}));
    const send=position=>wsA.send(JSON.stringify({type:'presence',trackId:track,playing:true,position}));send(10);
    await until(()=>eventsB.some(e=>e.type==='presence'&&e.value.activity?.position===10));
    const before=ok(await request(`/_test/metrics?user=${a}`));
    for(let i=11;i<16;i++)send(i);
    wsA.send(JSON.stringify({type:'typing',peerId:b,conversationId:conversation,typing:true}));
    await until(()=>eventsB.some(e=>e.type==='presence'&&e.value.activity?.position===15));
    await until(()=>eventsB.some(e=>e.type==='typing'));
    assert.deepEqual(ok(await request(`/_test/metrics?user=${a}`)),before);
    console.log(JSON.stringify({socialHeartbeats:5,d1RowsRead:0,d1RowsWritten:0}));
    ok(await social('/settings',a,'PUT',{presence:'invisible'}));
    const profile=ok(await social(`/profiles/${a}`,b));assert.equal(profile.presence.activity,null);assert.deepEqual(profile.recent,[]);
    ok(await social('/settings',a,'PUT',{presence:'online'}));
  });
  let session;
  await t.test('listening requires consent and only the host controls playback by default',async()=>{
    session=ok(await social('/listen',a,'POST',{userId:b,trackId:track})).session;
    assert.equal((await social(`/listen/${session.id}`,c,'POST')).status,409);
    assert.equal(ok(await social(`/listen/${session.id}`,b)).session.status,'pending');
    const active=ok(await social(`/listen/${session.id}`,b,'POST')).session;assert.equal(active.status,'active');
    wsB.send(JSON.stringify({type:'listen_control',sessionId:session.id,position:99,playing:false}));
    await until(()=>eventsB.some(e=>e.type==='error'));
    assert.equal(ok(await social(`/listen/${session.id}`,b)).session.position,0);
    wsA.send(JSON.stringify({type:'listen_control',sessionId:session.id,position:45,playing:true}));
    await until(()=>eventsB.some(e=>e.type==='listening'&&e.session.position===45));
  });
  await t.test('block immediately removes access, presence, messages and synchronized sessions',async()=>{
    ok(await social(`/blocks/${a}`,b,'POST'));
    assert.deepEqual(ok(await social('/state',b)).friends,[]);
    assert.equal((await social(`/conversations/${conversation}/messages`,a)).status,403);
    assert.equal((await social(`/conversations/${conversation}/messages`,a,'POST',{clientId:randomUUID(),text:'not allowed'})).status,403);
    assert.equal((await social(`/profiles/${b}`,a)).status,403);
    assert.equal((await social(`/friends/${b}`,a,'POST')).status,403);
    assert.equal((await db.prepare('SELECT status FROM listening_sessions WHERE id=?').bind(session.id).first()).status,'ended');
    await until(()=>eventsA.some(e=>e.type==='social_changed'&&e.removed?.includes(b)));
    ok(await social(`/blocks/${a}`,b,'DELETE'));
    assert.deepEqual(ok(await social('/state',b)).friends,[]);
  });
  await t.test('logout revokes a live socket and old session authentication',async()=>{
    const unused=ok(await social('/ticket',a,'POST'));
    let closed=false;wsA.addEventListener('close',()=>{closed=true;});
    ok(await request('/api/auth/logout',a,'POST'));await until(()=>closed);
    assert.equal((await mf.dispatchFetch(unused.url.replace('wss:','https:'),{headers:{Upgrade:'websocket'}})).status,401);
    assert.equal((await social('/state',a)).status,401);wsB.close();
  });
});
