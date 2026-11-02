import assert from 'node:assert/strict';
process.env.CHANNEL_ID = '-1003772984999'; process.env.ADMIN_ID = '6713072327'; process.env.CHANNEL_INVITE_LINK = 'https://t.me/+abc';
const {MemoryKV, Users} = await import('../server/store.js');
const bot = await import('../server/bot.js');
const ADMIN = 6713072327;
const log = []; const behave = new Map();
const tg = {
  async call(m, b) {
    log.push([m, b]);
    if (m === 'sendChatAction') { const e = behave.get(b.chat_id); if (e) throw new Error(e); return true; }
    if (m === 'getChat') return b.chat_id === 11 ? {personal_chat: {id: -100500, title: 'Dolce Vita', username: 'hochuDolceVita'}} : {};
    if (m === 'getChatMemberCount') return 1351;
    return {};
  },
  async upload() { return {}; }, async download() { return new Uint8Array(); },
};
const users = new Users(new MemoryKV());
const d = {tg, users, fetchPost: async () => null};
for (const [id, name] of [[11, 'vita'], [12, 'blocker'], [13, 'ghost'], [14, 'neverstart']]) await users.upsert({id, username: name, first_name: name});
behave.set(12, 'Forbidden: bot was blocked by the user');
behave.set(13, 'Forbidden: user is deactivated');
behave.set(14, "Forbidden: bot can't initiate conversation with a user");
let uid = 0;
const msg = (id, text) => ({update_id: ++uid, message: {chat: {type: 'private'}, from: {id}, text}});
const last = () => log.filter(x => x[0] === 'sendMessage' && x[1].chat_id === ADMIN).at(-1)[1].text;

await bot.handleUpdate(d, msg(ADMIN, '/check @vita'));
assert.match(last(), /не блокировал/); assert.match(last(), /Dolce Vita/); assert.match(last(), /1351/);
assert.ok(log.some(x => x[0] === 'sendChatAction' && x[1].chat_id === 11 && x[1].action === 'typing'));
await bot.handleUpdate(d, msg(ADMIN, '/check @blocker')); assert.match(last(), /Заблокировал бота/); assert.match(last(), /не указан/);
await bot.handleUpdate(d, msg(ADMIN, '/check 13')); assert.match(last(), /удалён/);
await bot.handleUpdate(d, msg(ADMIN, '/check @neverstart')); assert.match(last(), /ни разу не нажимал/);
await bot.handleUpdate(d, msg(ADMIN, '/check @nobody')); assert.match(last(), /Использование/);
// не админ: ничего не пингуем и ничего не узнаём
log.length = 0; await bot.handleUpdate(d, msg(12, '/check @vita'));
assert.ok(!log.some(x => x[0] === 'sendChatAction'), 'non-admin cannot ping');
assert.ok(!log.some(x => x[0] === 'sendMessage' && /Dolce Vita/.test(x[1].text)), 'non-admin learns nothing');
// ничего публичного и никаких удалений
assert.ok(!log.concat([]).some(x => /ban|kick|restrict|deleteMessage/i.test(x[0])));
console.log('CHECK TESTS PASSED');
