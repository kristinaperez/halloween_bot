/**
 * Логика @SantaHalloween2026bot.
 *  1. Заявка в закрытый канал → пишем в личку и одобряем.
 *  2. «Забрать набор» → проверка подписки → путь:
 *     а) свой публичный канал 100+ → обложка с фото → готовый пост → ссылка на пост → набор;
 *     б) нет такого канала → 499 ⭐ → набор.
 *  3. После дедлайна — «раздача завершилась».
 */
import {readFile} from 'node:fs/promises';
import {readdirSync} from 'node:fs';
import {cfg, isOver, deadlineStr, asset} from './config.js';
import {Users, type User} from './store.js';
import {type TG, TelegramError} from './tg.js';
import {makePoster} from './poster.js';

export type Deps = {tg: TG; users: Users; fetchPost: (channel: string, id: string) => Promise<string | null>};

// ---------- тексты ----------
const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kb = (rows: {text: string; data?: string; url?: string}[][]) => ({
  inline_keyboard: rows.map(r => r.map(b => (b.url ? {text: b.text, url: b.url} : {text: b.text, callback_data: b.data}))),
});
const starsBtn = () => [{text: `⭐ Купить за ${cfg.priceStars()} звёзд`, data: 'path_stars'}];
const kristinaBtn = () => [{text: '🎃 Оставить фото Кристины', data: 'photo_kristina'}];

export const preamble = () =>
  'Друзья, добрый день!\n' +
  'Я стараюсь развиваться, чтобы делать вашу жизнь легче и интереснее.\n' +
  'Поэтому забираю подарок от Кристины — стартовый набор вайб-кодера — и делюсь им с вами.\n' +
  'С праздником! 🎃\n\n' +
  `Забрать набор: @${cfg.botUsername()}`;

const welcome = () =>
  '🎃 <b>Привет! Это хэллоуинский бот Кристины.</b>\n\n' +
  'Здесь живёт <b>Стартовый набор вайб-кодера</b>:\n' +
  '🗺 Карта бесплатных курсов Академии Claude\n' +
  '📂 Шаблон CLAUDE.md для веб-проекта\n' +
  '🧪 Шаблон первого скилла\n' +
  '⚡ Шпаргалка команд Claude Code\n' +
  '🎁 И бонус — 10 скиллов для Claude Code\n\n' +
  `Раздача до ${deadlineStr()}. Жмите кнопку 👇`;

const over = () =>
  `🦇 Хэллоуинская раздача завершилась ${deadlineStr()}.\n` +
  'Но в канале «Кристина о нейронках» впереди много полезного — оставайтесь!';

export const CHANNEL_RE = /^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,})\/?$|^@?([A-Za-z0-9_]{4,})$/;
export const POST_RE = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{4,})\/(\d+)/;

export const postOk = (page: string | null) =>
  !!page && !page.includes('tgme_widget_message_error') && page.toLowerCase().includes(cfg.botUsername().toLowerCase());

const who = (u: {username?: string; firstName?: string; first_name?: string}) =>
  esc(`${u.firstName ?? u.first_name ?? ''}${u.username ? ` (@${u.username})` : ''}`);

// ---------- помощники ----------
async function send(d: Deps, chat: number, text: string, extra: Record<string, unknown> = {}) {
  return d.tg.call('sendMessage', {chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra});
}

async function notifyAdmin(d: Deps, text: string) {
  if (!cfg.adminId()) return;
  try { await send(d, cfg.adminId(), text); } catch (e) { console.warn('notifyAdmin', e); }
}

async function isMember(d: Deps, userId: number) {
  try {
    const m = await d.tg.call('getChatMember', {chat_id: cfg.channelId(), user_id: userId});
    return ['member', 'administrator', 'creator'].includes(m.status) || (m.status === 'restricted' && m.is_member);
  } catch (e) {
    console.warn('getChatMember', e);
    return false;
  }
}

async function sendWelcome(d: Deps, chat: number) {
  if (isOver()) return send(d, chat, over());
  const markup = kb([[{text: '🎁 Забрать набор', data: 'kit'}]]);
  try {
    const cached = await d.users.getCache<string>('welcome');
    if (cached) return await d.tg.call('sendPhoto', {chat_id: chat, photo: cached, caption: welcome(), parse_mode: 'HTML', reply_markup: markup});
    const r = await d.tg.upload('sendPhoto', {chat_id: String(chat), caption: welcome(), parse_mode: 'HTML', reply_markup: markup},
      [{name: 'photo', data: new Uint8Array(await readFile(asset('assets/welcome.png'))), filename: 'welcome.png', type: 'image/png'}]);
    await d.users.setCache('welcome', r.photo.at(-1).file_id);
  } catch (e) {
    console.warn('welcome photo failed', e);
    await send(d, chat, welcome(), {reply_markup: markup});
  }
}

// ---------- выдача набора ----------
export async function deliverKit(d: Deps, userId: number) {
  await send(d, userId, '🎁 <b>Ваш Стартовый набор вайб-кодера!</b>');
  const cached = await d.users.getCache<string[]>('kit');
  const files = readdirSync(asset('assets/kit')).filter(f => f.endsWith('.pdf')).sort();
  const caption = (f: string) => (f.includes('Бонус') ? 'И ещё бонус от меня 🎁' : undefined);
  if (cached && cached.length === files.length) {
    await d.tg.call('sendMediaGroup', {chat_id: userId, media: cached.map((id, i) => ({type: 'document', media: id, caption: caption(files[i])}))});
  } else {
    const media = files.map((f, i) => ({type: 'document', media: `attach://f${i}`, caption: caption(f)}));
    const uploads = await Promise.all(files.map(async (f, i) => ({
      name: `f${i}`, data: new Uint8Array(await readFile(asset(`assets/kit/${f}`))), filename: f, type: 'application/pdf',
    })));
    const msgs = await d.tg.upload('sendMediaGroup', {chat_id: String(userId), media}, uploads);
    await d.users.setCache('kit', msgs.map((m: any) => m.document.file_id));
  }
  await send(d, userId,
    'Счастливого Хэллоуина! 🎃\nНачните с карты курсов, а шпаргалку держите под рукой.\n\n' +
    `Вопросы и идеи — пишите Кристине: ${cfg.contact()}`);
  const u = await d.users.get(userId);
  await d.users.patch(userId, {state: null, deliveredAt: u?.deliveredAt ?? new Date().toISOString()});
}

// ---------- путь «канал 100+» ----------
async function handleChannel(d: Deps, uid: number, text: string) {
  if (/t\.me\/\+|joinchat|t\.me\/c\//.test(text)) {
    return send(d, uid, 'Это ссылка на закрытый канал — его пост я проверить не смогу 😔\nПришлите публичный канал (@имя) или заберите набор за звёзды.',
      {reply_markup: kb([starsBtn()])});
  }
  const m = CHANNEL_RE.exec(text.trim());
  const pm = POST_RE.exec(text);
  const name = m ? (m[1] || m[2]) : pm?.[1];
  if (!name) return send(d, uid, 'Не узнаю ссылку 🤔 Пришлите в виде @имя_канала или https://t.me/имя_канала');

  let chat: any;
  try { chat = await d.tg.call('getChat', {chat_id: `@${name}`}); }
  catch { return send(d, uid, 'Не нашла такой канал. Проверьте имя — оно после t.me/'); }
  if (chat.type !== 'channel') return send(d, uid, 'Это не канал (похоже на группу или аккаунт). Нужна ссылка именно на канал.');

  let subs = 0;
  try { subs = await d.tg.call('getChatMemberCount', {chat_id: chat.id}); } catch { /* 0 */ }
  if (subs < cfg.minSubs()) {
    await d.users.patch(uid, {state: null});
    return send(d, uid,
      `В «${esc(chat.title)}» сейчас ${subs} подписчиков, а для бесплатного набора нужно от ${cfg.minSubs()}.\nМожно забрать набор за ${cfg.priceStars()} ⭐`,
      {reply_markup: kb([starsBtn()])});
  }
  const owner = await d.users.channelOwner(name);
  if (owner && owner !== uid) {
    await d.users.patch(uid, {state: null});
    return send(d, uid, 'С этого канала набор уже забирали 🙂 Один канал — один подарок.');
  }
  await d.users.patch(uid, {channel: name, channelTitle: chat.title, channelSubs: subs, state: 'await_photo'});
  return send(d, uid,
    `✅ «${esc(chat.title)}» — ${subs} подписчиков, подходит!\n\n` +
    'Соберу для вашего поста обложку. Пришлите своё фото одним сообщением — лучше портрет, где хорошо видно лицо. Я вставлю его в круг на плакате.\n\n' +
    'Не хотите своё фото — оставлю на обложке Кристину.',
    {reply_markup: kb([kristinaBtn()])});
}

async function sendReadyPost(d: Deps, uid: number, photo?: Uint8Array) {
  await send(d, uid, '🧙‍♀️ Колдую обложку…');
  const poster = await makePoster(photo);
  await d.tg.upload('sendPhoto', {chat_id: String(uid), caption: preamble()},
    [{name: 'photo', data: poster, filename: 'halloween.jpg', type: 'image/jpeg'}]);
  await d.users.patch(uid, {state: 'await_post'});
  await send(d, uid,
    '☝️ Это ваш готовый пост.\n\n' +
    '<b>1.</b> Перешлите его в свой канал (или сохраните картинку и опубликуйте с этим же текстом — ' +
    `главное, чтобы в посте осталось @${cfg.botUsername()}).\n` +
    '<b>2.</b> Откройте опубликованный пост → «Копировать ссылку» и пришлите ссылку мне.\n\n' +
    'Как только проверю — пришлю набор 🎁');
}

async function handlePostLink(d: Deps, uid: number, text: string) {
  const u = (await d.users.get(uid))!;
  const m = POST_RE.exec(text);
  if (!m) return send(d, uid, 'Нужна ссылка на сам пост, вида https://t.me/имя_канала/123\nОткройте пост в канале → «Копировать ссылку».');
  const [, channel, msgId] = m;
  if (u.channel && channel.toLowerCase() !== u.channel.toLowerCase()) {
    return send(d, uid, `Этот пост из другого канала. Жду ссылку на пост из @${esc(u.channel)}`);
  }
  const page = await d.fetchPost(channel, msgId);
  if (page === null) return send(d, uid, 'Не получилось открыть пост 😔 Проверьте, что он опубликован, и пришлите ссылку ещё раз.');
  if (!postOk(page)) {
    return send(d, uid, `Вижу пост, но в нём нет @${cfg.botUsername()}. Опубликуйте пост вместе с текстом, который я прислала, и пришлите ссылку ещё раз.`);
  }
  const link = `https://t.me/${channel}/${msgId}`;
  await d.users.patch(uid, {postLink: link, path: 'repost'});
  await d.users.claimChannel(channel, uid);
  await send(d, uid, '✅ Пост на месте, спасибо, что делитесь! 🧡');
  await deliverKit(d, uid);
  await notifyAdmin(d, `📢 Репост: ${who(u)} — канал @${esc(channel)} (${u.channelSubs} подп.)\n${link}`);
}

// ---------- путь «звёзды» ----------
async function sendInvoice(d: Deps, uid: number) {
  await d.tg.call('sendInvoice', {
    chat_id: uid,
    title: 'Стартовый набор вайб-кодера',
    description: 'Карта курсов Академии Claude, шаблоны CLAUDE.md и первого скилла, шпаргалка Claude Code + бонус: 10 скиллов. 5 PDF прямо в бот.',
    payload: `kit:${uid}`,
    currency: 'XTR',
    prices: [{label: 'Стартовый набор', amount: cfg.priceStars()}],
  });
}

// ---------- обработчики ----------
async function onJoinRequest(d: Deps, req: any) {
  if (req.chat.id !== cfg.channelId()) return;
  await d.users.upsert(req.from);
  // Писать можно, пока заявка не обработана: сначала пишем, потом одобряем.
  try {
    await send(d, req.user_chat_id, '👻 Заявка принята — добро пожаловать в канал «Кристина о нейронках»!');
    await sendWelcome(d, req.user_chat_id);
  } catch (e) { console.warn('join DM failed', e); }
  try { await d.tg.call('approveChatJoinRequest', {chat_id: req.chat.id, user_id: req.from.id}); }
  catch (e) { console.error('approve failed', e); }
}

async function onCallback(d: Deps, q: any) {
  await d.tg.call('answerCallbackQuery', {callback_query_id: q.id}).catch(() => {});
  const uid = q.from.id;
  await d.users.upsert(q.from);
  if (isOver()) return send(d, uid, over());

  switch (q.data) {
    case 'kit': {
      if (!(await isMember(d, uid))) {
        return send(d, uid, 'Сначала вступите в канал «Кристина о нейронках» — заявки принимаю моментально ⚡\nПотом нажмите «Проверить».',
          {reply_markup: kb([[{text: '📢 Вступить в канал', url: cfg.inviteLink()}], [{text: '✅ Проверить', data: 'kit'}]])});
      }
      const u = await d.users.get(uid);
      if (u?.deliveredAt) {
        await send(d, uid, 'Набор у вас уже есть — присылаю ещё раз 😉');
        return deliverKit(d, uid);
      }
      return send(d, uid,
        'Вы в канале — отлично! 🎉\n\nКак забрать набор:\n' +
        `📢 <b>Есть свой публичный канал от ${cfg.minSubs()} подписчиков?</b> Опубликуйте у себя пост с подарком — набор бесплатно. Я даже соберу обложку с вашим фото.\n` +
        `⭐ <b>Канала нет?</b> Набор можно забрать за ${cfg.priceStars()} звёзд.`,
        {reply_markup: kb([[{text: `📢 У меня канал ${cfg.minSubs()}+`, data: 'path_repost'}], starsBtn()])});
    }
    case 'path_repost':
      await d.users.patch(uid, {state: 'await_channel'});
      return send(d, uid, 'Пришлите ссылку на ваш канал или его @имя.\nНапример: <code>@my_channel</code> или <code>https://t.me/my_channel</code>\n\nКанал должен быть публичным — так я смогу проверить пост.');
    case 'path_stars':
      return sendInvoice(d, uid);
    case 'photo_kristina': {
      const u = await d.users.get(uid);
      if (u?.state !== 'await_photo') return send(d, uid, 'Начнём сначала: нажмите /start');
      return sendReadyPost(d, uid);
    }
  }
}

async function onPreCheckout(d: Deps, q: any) {
  if (isOver()) return d.tg.call('answerPreCheckoutQuery', {pre_checkout_query_id: q.id, ok: false, error_message: 'Раздача уже закончилась 🦇'});
  if (String(q.invoice_payload).startsWith('kit:')) return d.tg.call('answerPreCheckoutQuery', {pre_checkout_query_id: q.id, ok: true});
  return d.tg.call('answerPreCheckoutQuery', {pre_checkout_query_id: q.id, ok: false, error_message: 'Что-то пошло не так, попробуйте ещё раз.'});
}

async function onPaid(d: Deps, msg: any) {
  const p = msg.successful_payment;
  const uid = msg.from.id;
  await d.users.upsert(msg.from);
  await d.users.patch(uid, {path: 'stars', chargeId: p.telegram_payment_charge_id, stars: p.total_amount});
  await send(d, uid, '⭐ Оплата прошла, спасибо!');
  await deliverKit(d, uid);
  await notifyAdmin(d, `⭐ Покупка за ${p.total_amount} звёзд: ${who(msg.from)}\ncharge_id: <code>${esc(p.telegram_payment_charge_id)}</code>`);
}

async function onAdmin(d: Deps, uid: number, cmd: string, arg?: string) {
  if (uid !== cfg.adminId()) return false;
  const all = await d.users.all();
  if (cmd === '/stats') {
    const rep = all.filter(u => u.path === 'repost' && u.deliveredAt);
    const paid = all.filter(u => u.path === 'stars');
    await send(d, uid,
      `📊 Пользователей в боте: ${all.length}\n` +
      `📢 Забрали за пост: ${rep.length} (суммарно ${rep.reduce((s, u) => s + (u.channelSubs ?? 0), 0)} подписчиков в их каналах)\n` +
      `⭐ Купили: ${paid.length} на ${paid.reduce((s, u) => s + (u.stars ?? 0), 0)} звёзд\n` +
      `⏳ Раздача до ${deadlineStr()}`);
    return true;
  }
  if (cmd === '/export') {
    const cols: (keyof User)[] = ['id', 'username', 'firstName', 'createdAt', 'path', 'channel', 'channelTitle', 'channelSubs', 'postLink', 'stars', 'chargeId', 'deliveredAt'];
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.join(','), ...all.map(u => cols.map(c => q(u[c])).join(','))].join('\n');
    await d.tg.upload('sendDocument', {chat_id: String(uid)}, [{name: 'document', data: new TextEncoder().encode(csv), filename: 'participants.csv', type: 'text/csv'}]);
    return true;
  }
  if (cmd === '/refund') {
    const target = all.find(u => String(u.id) === arg);
    if (!target?.chargeId) { await send(d, uid, 'Использование: /refund <user_id> (у пользователя должна быть оплата)'); return true; }
    try {
      await d.tg.call('refundStarPayment', {user_id: target.id, telegram_payment_charge_id: target.chargeId});
      await d.users.patch(target.id, {path: 'refunded'});
      await send(d, uid, '✅ Звёзды возвращены.');
    } catch (e) { await send(d, uid, `Не получилось: ${esc(String(e))}`); }
    return true;
  }
  return false;
}

async function onMessage(d: Deps, msg: any) {
  if (msg.chat.type !== 'private') return;
  if (msg.successful_payment) return onPaid(d, msg);
  const uid = msg.from.id;
  await d.users.upsert(msg.from);
  const text: string = msg.text ?? '';

  if (text.startsWith('/')) {
    const [cmd, arg] = text.split(/\s+/);
    const c = cmd.split('@')[0];
    if (await onAdmin(d, uid, c, arg)) return;
    if (c === '/terms') {
      return send(d, uid,
        `📄 Условия\n\n«Стартовый набор вайб-кодера» — 5 PDF-файлов. Оплата ${cfg.priceStars()} ⭐ Telegram Stars.\n` +
        'Файлы приходят сюда, в бот, сразу после оплаты.\nЕсли файлы не пришли или что-то пошло не так — напишите в /paysupport, разберёмся или вернём звёзды.\n' +
        'Материалы — для личного использования.');
    }
    if (c === '/paysupport') {
      return send(d, uid, `💬 Поддержка по оплатам: напишите ${cfg.contact()}.\nУкажите, когда платили, — платёж я найду сама.`);
    }
    // /start и всё остальное
    await d.users.patch(uid, {state: null});
    return sendWelcome(d, uid);
  }

  if (isOver()) return send(d, uid, over());
  const u = await d.users.get(uid);

  const photoId: string | undefined = msg.photo?.at(-1)?.file_id ??
    (msg.document?.mime_type?.startsWith('image/') ? msg.document.file_id : undefined);
  if (photoId) {
    if (u?.state !== 'await_photo') return send(d, uid, 'Классное фото! Но сначала нажмите /start 🙂');
    try {
      const data = await d.tg.download(photoId);
      return await sendReadyPost(d, uid, data);
    } catch (e) {
      console.error('poster failed', e);
      return send(d, uid, 'Не получилось открыть это фото 😔 Пришлите другое — обычным фото, не файлом.');
    }
  }

  switch (u?.state) {
    case 'await_channel': return handleChannel(d, uid, text);
    case 'await_post': return handlePostLink(d, uid, text);
    case 'await_photo': return send(d, uid, 'Жду фото 📸 Или нажмите кнопку, чтобы оставить Кристину.', {reply_markup: kb([kristinaBtn()])});
    default: return sendWelcome(d, uid);
  }
}

export async function handleUpdate(d: Deps, update: any) {
  if (update.update_id !== undefined && (await d.users.seenUpdate(update.update_id))) return;
  try {
    if (update.chat_join_request) return await onJoinRequest(d, update.chat_join_request);
    if (update.callback_query) return await onCallback(d, update.callback_query);
    if (update.pre_checkout_query) return await onPreCheckout(d, update.pre_checkout_query);
    if (update.message) return await onMessage(d, update.message);
  } catch (e) {
    if (e instanceof TelegramError) console.warn('telegram:', e.message);
    else console.error(e);
  }
}

/** Публичная страница поста (работает для публичных каналов). */
export async function fetchPost(channel: string, id: string): Promise<string | null> {
  try {
    const res = await fetch(`https://t.me/${channel}/${id}?embed=1&mode=tme`, {
      headers: {'User-Agent': 'Mozilla/5.0 (HalloweenBot)'}, signal: AbortSignal.timeout(6000),
    });
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

/** Раз в час: посты, которым больше суток, проверяем повторно. */
export async function recheckPosts(d: Deps) {
  const day = 24 * 3600 * 1000;
  for (const u of await d.users.all()) {
    if (u.path !== 'repost' || !u.postLink || u.recheckedAt || !u.deliveredAt) continue;
    if (Date.now() - Date.parse(u.deliveredAt) < day) continue;
    const m = POST_RE.exec(u.postLink)!;
    const page = await d.fetchPost(m[1], m[2]);
    await d.users.patch(u.id, {recheckedAt: new Date().toISOString()});
    if (!postOk(page)) await notifyAdmin(d, `⚠️ Через сутки пост не найден: ${who(u)} — ${u.postLink}`);
  }
}
