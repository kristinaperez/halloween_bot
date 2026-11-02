import assert from 'node:assert/strict';
process.env.CHANNEL_ID = '-1003772984999'; process.env.ADMIN_ID = '6713072327'; process.env.CHANNEL_INVITE_LINK = 'https://t.me/+abc';
delete process.env.CHANNEL_SIGNATURES; delete process.env.TEST_CHAT_ID;
const {MemoryKV, Users} = await import('../server/store.js');
const {TelegramError} = await import('../server/tg.js');
const bot = await import('../server/bot.js');
const {SCENARIO, MOROK_LINES} = await import('../server/morok.js');

const ADMIN = 6713072327, CH = -1003772984999;
let mid = 100;
const mkTg = (name, log) => ({
  async call(m, b) {
    log.push([m, b, name]); hist.push([m, b, name]);
    if (m === 'stopPoll') return {total_voter_count: 10, options: [{text: '😈 Оставить! Нам нужен злодей!', voter_count: 7}, {text: '🧹 Библиотека', voter_count: 3}]};
    return {message_id: ++mid};
  },
  async upload(m, f, files) {
    log.push([m, f, name, files.map(x => x.filename)]); hist.push([m, f, name]);
    return {message_id: ++mid, photo: [{file_id: 'P' + mid}], animation: {file_id: 'A' + mid}};
  },
  async download() { return new Uint8Array(); },
});
const log = [];
const tg = mkTg('main', log);
const users = new Users(new MemoryKV());
const d = {tg, users, fetchPost: async () => null};
let uid = 0;
const U = id => ({id, username: 'u' + id, first_name: 'Имя' + id});
const msg = (id, text) => ({update_id: ++uid, message: {chat: {type: 'private'}, from: U(id), text}});
const cb = (id, data, extra = {}) => ({update_id: ++uid, callback_query: {id: 'q' + uid, from: U(id), data, ...extra}});
const toChannel = () => log.filter(x => x[1]?.chat_id === CH || x[1]?.chat_id === String(CH));
const adminTexts = () => log.filter(x => x[0] === 'sendMessage' && x[1].chat_id === ADMIN).map(x => x[1].text);
/** Данные последней кнопки с таким действием из сообщений админу (как нажала бы Кристина). */
const btn = (action, from = log) => {
  for (let k = from.length - 1; k >= 0; k--) {
    const rm = from[k][1]?.reply_markup;
    for (const row of rm?.inline_keyboard ?? []) for (const b of row) if (b.callback_data?.startsWith(`mk:${action}`)) return b.callback_data;
  }
  throw new Error('no button ' + action);
};
let hist = [];
const press = async (dd, action) => { const data = btn(action, hist); return bot.handleUpdate(dd, cb(ADMIN, data)); };
const forbidden = () => log.filter(x => /ban|kick|restrict|unban|deleteMessage/i.test(x[0]));
const botSteps = SCENARIO.filter(s => s.voice !== 'cristina').length;

// 1. не админ не может управлять Мороком
log.length = 0; await bot.handleUpdate(d, msg(5, '/morok_start'));
assert.ok(!adminTexts().some(t => /Запуск/.test(t ?? '')), 'non-admin cannot start');
log.length = 0; await bot.handleUpdate(d, cb(5, 'mk:go'));
assert.equal(toChannel().length, 0); assert.equal(await users.kv.get('morok:run'), null);

// 2. предпросмотр — только в личку админу, канал не трогаем
log.length = 0; await bot.handleUpdate(d, msg(ADMIN, '/morok_preview'));
assert.equal(toChannel().length, 0, 'preview does not touch channel');
const pv = log.filter(x => x[1]?.chat_id === ADMIN || x[1]?.chat_id === String(ADMIN));
assert.ok(pv.length >= SCENARIO.length, 'every step previewed');
assert.ok(pv.some(x => x[0] === 'sendPoll'), 'poll previewed');
assert.ok(pv.some(x => (x[1].text ?? x[1].caption ?? '').includes('😈 <b>Лорд Морок:</b>')), 'Morok labelled in preview');

// 3. тестовый чат не задан → подсказка
log.length = 0; await bot.handleUpdate(d, msg(ADMIN, '/morok_test')); assert.match(adminTexts()[0], /TEST_CHAT_ID/);

// 4. запуск: подтверждение → первый шаг — реплика Кристины ей в личку
log.length = 0; await bot.handleUpdate(d, msg(ADMIN, '/morok_start'));
assert.match(adminTexts()[0], /Запускаем\?/); assert.equal(toChannel().length, 0, 'nothing before confirm');
const goBtn = btn('go', hist);
log.length = 0; await bot.handleUpdate(d, cb(ADMIN, goBtn));
assert.equal(toChannel().length, 0, 'Cristina line is not auto-posted');
assert.ok(adminTexts().some(t => /Хэллоуин закончился/.test(t)), 'admin got her line');
// двойное нажатие «Запустить» не создаёт второй запуск
const run1 = (await users.kv.get('morok:run')).runId;
await bot.handleUpdate(d, cb(ADMIN, goBtn)); assert.equal((await users.kv.get('morok:run')).runId, run1);

// 5. «Я опубликовала» → следующий шаг; «Следующая сцена» → пост в канал
log.length = 0; await press(d, 'manual_done');
assert.equal(toChannel().length, 0); assert.ok(adminTexts().some(t => /Тревога праздничного бота/.test(t)));
const nextAlarm = btn('next', hist);
log.length = 0; await bot.handleUpdate(d, cb(ADMIN, nextAlarm));
assert.equal(toChannel().length, 1); assert.match(toChannel()[0][1].text ?? toChannel()[0][1].caption, /четверо меня заблокировали/);
assert.ok(adminTexts().some(t => /2–5 минут/.test(t)), 'pacing hint shown');

// 6. дубль апдейта, второе нажатие той же кнопки и старая кнопка не публикуют лишнего
const dup = cb(ADMIN, btn('next', hist));
log.length = 0; await bot.handleUpdate(d, dup); await bot.handleUpdate(d, dup);
assert.equal(toChannel().length, 1, 'duplicate update ignored');
log.length = 0; await bot.handleUpdate(d, cb(ADMIN, dup.callback_query.data));
assert.equal(toChannel().length, 0, 'second tap on the same button ignored'); assert.match(adminTexts()[0], /устарела/);
log.length = 0; await bot.handleUpdate(d, cb(ADMIN, nextAlarm)); assert.equal(toChannel().length, 0, 'old button ignored');
log.length = 0; await bot.handleUpdate(d, cb(ADMIN, 'mk:next')); assert.equal(toChannel().length, 0, 'button without step ignored');
// нажатая кнопка убирается
log.length = 0; await bot.handleUpdate(d, cb(ADMIN, 'mk:pause', {message: {message_id: 555, chat: {id: ADMIN}}}));
assert.ok(log.some(x => x[0] === 'editMessageReplyMarkup' && x[1].message_id === 555));
await press(d, 'resume');

// 7. обрыв связи посреди отправки → бот не шлёт сам, а спрашивает; «Есть» — идём дальше без повтора
const oc = tg.call;
tg.call = async (m, b) => { if (b?.chat_id === CH) { log.push([m, b, 'main']); throw new Error('timeout'); } return oc(m, b); };
log.length = 0; await press(d, 'next');
assert.ok(adminTexts().some(t => /Пост мог уйти/.test(t)), 'admin asked after timeout');
assert.ok(!JSON.stringify(log).includes('Попробовать ещё раз'), 'no blind retry button after timeout');
tg.call = oc;
log.length = 0; await bot.handleUpdate(d, cb(ADMIN, btn('next', hist.slice(0, -3))));
assert.equal(toChannel().length, 0, 'unknown step not resent automatically');
log.length = 0; await bot.handleUpdate(d, msg(ADMIN, '/morok_status'));
assert.ok(adminTexts().some(t => /в канале есть\?/.test(t)), 'status offers fresh buttons');
log.length = 0; await press(d, 'skip');
assert.equal(toChannel().length, 0, 'skip does not post');
assert.equal((await users.kv.get('morok:run')).next, 4);

// 8. ошибка Telegram API (пост точно не ушёл) → можно сразу повторить
tg.call = async (m, b) => { if (b?.chat_id === CH) throw new TelegramError('Bad Request: not enough rights'); return oc(m, b); };
log.length = 0; await press(d, 'next'); tg.call = oc;
assert.equal((await users.kv.get('morok:run')).sending, undefined);
log.length = 0; await press(d, 'next'); assert.equal(toChannel().length, 1, 'retried after API error');

// 9. пауза и продолжение
const beforeStop = btn('next', hist);
log.length = 0; await bot.handleUpdate(d, msg(ADMIN, '/morok_stop'));
await bot.handleUpdate(d, cb(ADMIN, beforeStop)); assert.equal(toChannel().length, 0, 'paused');
await press(d, 'resume');

// 10. доходим до конца: реплики Кристины — одну сама, остальные поручаем боту
log.length = 0;
for (let guard = 0; guard < 40; guard++) {
  const st = await users.kv.get('morok:run');
  if (st.status === 'done') break;
  const step = SCENARIO[st.next];
  await press(d, 'next');
  if (step.voice === 'cristina') await press(d, 'as_bot');
}
const st = await users.kv.get('morok:run');
assert.equal(st.status, 'done');
const ch = toChannel();
assert.ok(ch.some(x => x[0] === 'sendAnimation' || x[0] === 'sendMessage' && /ИЗГНАН/.test(x[1].text)), 'exile posted');
const poll = ch.find(x => x[0] === 'sendPoll'); assert.ok(poll && poll[1].is_anonymous === true && poll[1].options.length === 4);
const decree = ch.find(x => /УКАЗ ЛОРДА МОРОКА/.test(x[1].text ?? x[1].caption ?? ''));
assert.match(JSON.stringify(decree[1].reply_markup), /mk:call/); assert.match(JSON.stringify(decree[1].reply_markup), /start=kit/);
assert.match(decree[1].text ?? decree[1].caption, /всего 5 подписчиков/);
assert.ok(ch.some(x => /🧙‍♀️ <b>Кристина:<\/b>/.test(x[1].text ?? '')), 'Cristina via bot is labelled');
assert.ok(ch.filter(x => /Демократия/.test(x[1].text ?? '')).every(x => x[1].disable_notification === true), 'dialogue is silent');
assert.ok(ch.some(x => /четверо меня/.test(x[1].text ?? x[1].caption ?? '')) === false, 'alarm not reposted');
assert.equal(forbidden().length, 0, 'no ban/kick/delete calls');
assert.ok(adminTexts().some(t => /Сценарий завершён/.test(t)));

// 11. после завершения ничего не публикуется; повтор — только явно
log.length = 0; await bot.handleUpdate(d, cb(ADMIN, btn('next', hist))); assert.equal(toChannel().length, 0);
log.length = 0; await bot.handleUpdate(d, msg(ADMIN, '/morok_start')); assert.match(adminTexts()[0], /morok_start again/);
log.length = 0; await bot.handleUpdate(d, cb(ADMIN, goBtn)); assert.equal(toChannel().length, 0, 'old confirm button cannot rerun');
assert.equal((await users.kv.get('morok:run')).runId, run1);
log.length = 0; await bot.handleUpdate(d, msg(ADMIN, '/morok_start again')); assert.match(adminTexts()[0], /повторный показ/);

// 12. итог голосования
log.length = 0; await press(d, 'poll');
assert.ok(log.some(x => x[0] === 'stopPoll' && x[1].message_id === st.pollMessageId));
assert.match(adminTexts().at(-1), /Оставить! Нам нужен злодей! — 7 \(70%\)/);
log.length = 0; await bot.handleUpdate(d, msg(ADMIN, '/morok_status')); assert.match(adminTexts()[0], /завершён/); assert.match(adminTexts()[0], /Итог голосования/);

// 13. «Вызвать Морока» — всплывающее окно, человек не попадает в базу, в личку ничего не пишем
const before = (await users.all()).length;
log.length = 0; await bot.handleUpdate(d, cb(777, 'mk:call', {message: {chat: {id: CH, type: 'channel'}}}));
const ans = log.find(x => x[0] === 'answerCallbackQuery');
assert.equal(ans[1].show_alert, true); assert.ok(ans[1].text.length <= 200);
assert.equal(log.filter(x => x[0] === 'sendMessage').length, 0, 'no DM on summon');
assert.equal((await users.all()).length, before, 'summoner not stored');
assert.ok(MOROK_LINES.every(l => `😈 ${l}`.length <= 200), 'all lines fit alert');

// 14. отдельный бот Морока: его реплики идут от него, при включённых подписях — без подписи в тексте
process.env.CHANNEL_SIGNATURES = '1';
const mlog = [];
const morokTg = mkTg('morok', mlog);
const users2 = new Users(new MemoryKV());
const d2 = {tg: mkTg('main', log), users: users2, fetchPost: async () => null, morokTg};
log.length = 0;
await bot.handleUpdate(d2, msg(ADMIN, '/morok_start')); await press(d2, 'go');
for (let guard = 0; guard < 40; guard++) {
  const s2 = await users2.kv.get('morok:run'); if (s2.status === 'done') break;
  const step = SCENARIO[s2.next];
  await press(d2, 'next');
  if (step.voice === 'cristina') await press(d2, 'manual_done');
}
const morokPosts = mlog.filter(x => x[1]?.chat_id === CH || x[1]?.chat_id === String(CH));
assert.equal(morokPosts.length, SCENARIO.filter(s => s.voice === 'morok').length, 'Morok bot posts his lines');
assert.ok(morokPosts.every(x => !(x[1].text ?? x[1].caption ?? '').includes('Лорд Морок:</b>')), 'no text label when signed');
assert.equal(toChannel().length, SCENARIO.filter(s => s.voice === 'halloween').length, 'main bot posts only its lines; Cristina posted herself');
delete process.env.CHANNEL_SIGNATURES;

// 15. сам вебхук бота Морока закрыт без секрета
const {POST} = await import('../api/morok.js');
process.env.TELEGRAM_WEBHOOK_SECRET = 's';
assert.equal((await POST(new Request('http://x/api/morok', {method: 'POST', body: '{}'}))).status, 403);
delete process.env.TELEGRAM_WEBHOOK_SECRET;

// 16. если в Vercel остался MIN_SUBS=100 — предупреждаем перед запуском
process.env.MIN_SUBS = '100';
log.length = 0; await bot.handleUpdate(d2, msg(ADMIN, '/morok_status')); assert.ok(adminTexts().some(t => /MIN_SUBS=100/.test(t)));
delete process.env.MIN_SUBS;

assert.equal(botSteps > 0, true);
console.log('MOROK TESTS PASSED');
