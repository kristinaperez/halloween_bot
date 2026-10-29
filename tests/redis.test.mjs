// Проверка RedisKV на имитации Upstash REST API (тот же формат: POST [команда, ...аргументы] → {result}).
import assert from 'node:assert/strict';
import http from 'node:http';
const db = new Map();
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    assert.equal(req.headers.authorization, 'Bearer tok');
    const [cmd, ...a] = JSON.parse(body); let result = null;
    if (cmd === 'GET') result = db.get(a[0]) ?? null;
    if (cmd === 'SET') { if (a[2] === 'NX' && db.has(a[0])) result = null; else { db.set(a[0], a[1]); result = 'OK'; } }
    if (cmd === 'SCAN') { const p = a[2].slice(0, -1); result = ['0', [...db.keys()].filter(k => k.startsWith(p))]; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({result}));
  });
}).listen(0);
const port = srv.address().port;
process.env.KV_REST_API_URL = `http://127.0.0.1:${port}`; process.env.KV_REST_API_TOKEN = 'tok';
const {RedisKV, Users} = await import('../server/store.js');
const users = new Users(new RedisKV());
await users.upsert({id: 1, username: 'a', first_name: 'А'});
await users.patch(1, {state: 'await_post'});
assert.equal((await users.get(1)).state, 'await_post');
assert.equal(await users.seenUpdate(10), false);
assert.equal(await users.seenUpdate(10), true);
assert.equal((await users.all()).length, 1);
await users.claimChannel('BigChan', 1); assert.equal(await users.channelOwner('bigchan'), 1);
srv.close(); console.log('REDIS TESTS PASSED');
