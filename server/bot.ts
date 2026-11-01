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
import {cfg, isOver, deadlineStr, asset, refOpen, refDeadlineStr} from './config.js';
import {Users, type User} from './store.js';
import {type TG, TelegramError} from './tg.js';
import {makePoster} from './poster.js';
import {timerPng, remainStr} from './timer.js';

export type Deps = {tg: TG; users: Users; fetchPost: (channel: string, id: string) => Promise<string | null>};

// ---------- тексты ----------
const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
type Btn = {text: string; data?: string; url?: string; webApp?: string};
const kb = (rows: Btn[][]) => ({
  inline_keyboard: rows.map(r => r.map(b =>
    b.webApp ? {text: b.text, web_app: {url: b.webApp}} : b.url ? {text: b.text, url: b.url} : {text: b.text, callback_data: b.data})),
});
const starsBtn = () => [{text: `⭐ Купить за ${cfg.priceStars()} звёзд`, data: 'path_stars'}];
const kristinaBtn = () => [{text: '🎃 Оставить фото Кристины', data: 'photo_kristina'}];

export const preamble = () =>
  'Друзья, добрый день!\n' +
  'Я стараюсь развиваться, чтобы делать вашу жизнь легче и интереснее.\n' +
  'Поэтому забираю подарок от Кристины — набор, чтобы сделать себе ИИ-помощника самостоятельно, — и делюсь им с вами.\n' +
  'С праздником! 🎃\n\n' +
  `Забрать набор: @${cfg.botUsername()}`;

const welcome = () =>
  '🎃 <b>Привет! Это хэллоуинский бот Кристины.</b>\n\n' +
  '<b>Психолог, коуч — сделайте себе ИИ-помощника сами.</b>\nВ наборе:\n' +
  '🗺 Бесплатные курсы от создателей Claude: с чего начать и в каком порядке\n' +
  '📂 Памятка для ИИ: чтобы он сразу понимал ваш проект\n' +
  '🧪 Как один раз научить ИИ вашей задаче — и больше не объяснять\n' +
  '⚡ Шпаргалка: главные команды, чтобы управлять ИИ-помощником\n' +
  '🎁 И бонус — 10 топовых навыков для ИИ: тексты, маркетинг, проверка идей\n\n' +
  'Всё — для Claude Code: с ним можно начать собирать бота или сайт самостоятельно. Для работы нужна подписка Claude Pro/Max.\n\n' +
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

async function sendWelcome(d: Deps, chat: number, viaLink = false) {
  if (isOver()) return send(d, chat, over());
  // После заявки в канал человек ещё не нажимал «Старт» — кнопка ведёт в бот через /start kit
  const markup = viaLink
    ? kb([[{text: '🎁 Забрать набор', url: `https://t.me/${cfg.botUsername()}?start=kit`}]])
    : kb([[{text: '🎁 Забрать набор', data: 'kit'}]]);
  try {
    const cached = await d.users.getCache<string>('welcome-v3-coach');
    if (cached) return await d.tg.call('sendPhoto', {chat_id: chat, photo: cached, caption: welcome(), parse_mode: 'HTML', reply_markup: markup});
    const r = await d.tg.upload('sendPhoto', {chat_id: String(chat), caption: welcome(), parse_mode: 'HTML', reply_markup: markup},
      [{name: 'photo', data: new Uint8Array(await readFile(asset('assets/welcome.png'))), filename: 'welcome.png', type: 'image/png'}]);
    await d.users.setCache('welcome-v3-coach', r.photo.at(-1).file_id);
  } catch (e) {
    console.warn('welcome photo failed', e);
    await send(d, chat, welcome(), {reply_markup: markup});
  }
}

// ---------- выдача набора ----------
export async function deliverKit(d: Deps, userId: number) {
  await send(d, userId, '🎁 <b>Ваш набор «ИИ-помощник своими руками»!</b>');
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

  let subs: number;
  try { subs = await d.tg.call('getChatMemberCount', {chat_id: `@${name}`}); }
  catch { return send(d, uid, 'Не смогла посчитать подписчиков канала 😔 Попробуйте прислать ссылку ещё раз через минуту.'); }
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
  if (!(await d.users.claimChannel(channel, uid))) {
    await d.users.patch(uid, {state: null});
    return send(d, uid, 'С этого канала набор уже забирали 🙂 Один канал — один подарок.');
  }
  await d.users.patch(uid, {postLink: link, path: 'repost'});
  await send(d, uid, '✅ Пост на месте, спасибо, что делитесь! 🧡');
  await deliverKit(d, uid);
  await notifyAdmin(d, `📢 Репост: ${who(u)} — канал @${esc(channel)} (${u.channelSubs} подп.)\n${link}`);
}

// ---------- путь «звёзды» ----------
async function sendInvoice(d: Deps, uid: number) {
  await d.tg.call('sendInvoice', {
    chat_id: uid,
    title: 'ИИ-помощник своими руками',
    description: 'Карта бесплатных курсов от создателей Claude, памятка и шаблон навыка для ИИ, шпаргалка команд + подборка 10 топовых навыков. Для старта в Claude Code (нужна подписка Claude Pro/Max). 5 PDF прямо в бот.',
    payload: `kit:${uid}`,
    currency: 'XTR',
    prices: [{label: 'Набор', amount: cfg.priceStars()}],
  });
}

// ---------- рефералка «приведи 3 подруг» ----------
export const refLink = (uid: number) => `https://t.me/${cfg.botUsername()}?start=ref_${uid}`;
const left = (n: number) => {
  const r = Math.max(0, cfg.refGoal() - n);
  return r === 1 ? 'Осталась одна' : `Осталось ${r}`;
};
const shareUrl = (uid: number) =>
  'https://t.me/share/url?url=' + encodeURIComponent(refLink(uid)) +
  '&text=' + encodeURIComponent('Кристина на Хэллоуин раздаёт набор, чтобы сделать себе ИИ-помощника 🎃 Заходи по моей ссылке — нажми «Старт», мне засчитается 🙏');
const refMs = () => cfg.refDeadline().getTime() - Date.now();
const timerUrl = (n: number) => `${cfg.siteUrl()}/timer.html?until=${cfg.refDeadline().getTime()}&n=${n}&g=${cfg.refGoal()}`;
const refKb = (uid: number, n = 0) => kb([
  ...(cfg.siteUrl().startsWith('https://') ? [[{text: '⏳ Живой таймер', webApp: timerUrl(n)}]] : []),
  [{text: '📤 Отправить подругам', url: shareUrl(uid)}],
  [{text: '📊 Сколько уже пришло', data: 'ref_status'}],
]);

/** Картинка с красным таймером + подпись + кнопки. photoId — уже загруженная картинка (для рассылки). */
async function sendTimer(d: Deps, uid: number, caption: string, n: number, photoId?: string): Promise<string | undefined> {
  const extra = {caption, parse_mode: 'HTML', reply_markup: refKb(uid, n)};
  try {
    if (photoId) { await d.tg.call('sendPhoto', {chat_id: uid, photo: photoId, ...extra}); return photoId; }
    const r = await d.tg.upload('sendPhoto', {chat_id: String(uid), ...extra},
      [{name: 'photo', data: await timerPng(refMs()), filename: 'timer.png', type: 'image/png'}]);
    return r?.photo?.at(-1)?.file_id;
  } catch (e) {
    if (e instanceof TelegramError && /blocked|deactivated|chat not found/i.test(e.message)) throw e;
    console.warn('timer photo failed', e);
    await send(d, uid, caption, {reply_markup: refKb(uid, n)});
    return photoId;
  }
}
const timerCaption = () => `⏳ <b>Время пошло!</b>\nОкошко закроется в ${refDeadlineStr()} — осталось ${remainStr(refMs())}.`;

/** Сообщение для рассылки тем, кто зашёл, но набор не забрал. */
export const refPitch = (u: {id: number; firstName?: string}) =>
  `🎃 ${u.firstName ? esc(u.firstName) + ', п' : 'П'}ривет! Это Кристина.\n\n` +
  'Счастливого Хэллоуина! Рада, что ты с нами 🧡\n' +
  'Как празднуешь? Тыква, костюм или сериал под пледом? 😄\n\n' +
  'А теперь к делу.\n' +
  `Вижу, канала на ${cfg.minSubs()} подписчиков у тебя пока нет.\n` +
  'И звёзды ты решила приберечь.\n' +
  'Понимаю. Сама такая 😁\n\n' +
  'Но откладывать вайб-кодинг на потом — плохая идея. Поэтому вот тебе хэллоуинская сделка:\n\n' +
  `👯 <b>Приведи в бот ${cfg.refGoal()} подруг по своей ссылке — и набор твой. Бесплатно.</b>\n\n` +
  `⏳ Но окошко открыто только до <b>${refDeadlineStr()}</b> — это ${remainStr(refMs())}. Потом карета превращается в тыкву 🎃\n\n` +
  'Для смелости: я за один вечер привела в бот 9 человек. Причём совсем незнакомых.\n' +
  `А тебе нужно всего ${cfg.refGoal()}. Мама, сестра, подруга, коллега — сегодня воскресенье, все дома 😉\n\n` +
  `Твоя ссылка:\n${refLink(u.id)}\n\n` +
  `Как только ${cfg.refGoal() === 3 ? 'третья' : 'последняя'} подруга нажмёт в боте «Старт» — набор сам прилетит сюда 👇`;

async function refStatus(d: Deps, uid: number) {
  if (await hasKit(d, uid)) return send(d, uid, 'Набор у тебя уже есть 🎁 Нажми /start → «Забрать набор», если нужно прислать ещё раз.');
  const n = await d.users.refCount(uid);
  if (!refOpen()) return send(d, uid, `🦇 Окошко закрылось в ${refDeadlineStr()}. Пришло подруг: ${n} из ${cfg.refGoal()}.\nНабор всё ещё можно забрать за ${cfg.priceStars()} ⭐`, {reply_markup: kb([starsBtn()])});
  await sendTimer(d, uid,
    `👯 Пришло по твоей ссылке: <b>${n} из ${cfg.refGoal()}</b>\n${left(n)} — и набор твой.\n` +
    `⏳ Окошко закроется в ${refDeadlineStr()} — осталось ${remainStr(refMs())}.\n\nТвоя ссылка:\n${refLink(uid)}`, n);
}

/** Новый человек пришёл по ссылке ref_<id>. */
async function onReferral(d: Deps, friend: any, referrerId: number) {
  if (!refOpen() || referrerId === friend.id) return;
  const ref = await d.users.get(referrerId);
  if (!ref || !(await d.users.claimReferral(friend.id, referrerId))) return;
  await d.users.patch(friend.id, {referredBy: referrerId});
  const n = await d.users.addReferral(referrerId);
  const name = esc(friend.first_name ?? 'Подруга');
  if (await hasKit(d, referrerId)) return;
  if (n < cfg.refGoal()) {
    const lines = n === 1
      ? `🎉 Есть первая! ${name} уже в боте.\n${left(n)}. Ты в игре 😉`
      : `🔥 ${name} тоже здесь! Это ${n} из ${cfg.refGoal()}.\n${left(n)} — и набор твой 🎃`;
    await send(d, referrerId, `${lines}\n⏳ До закрытия окошка: ${remainStr(refMs())}`, {reply_markup: refKb(referrerId, n)}).catch(e => console.warn('referral notify', e));
    return;
  }
  if (n !== cfg.refGoal()) return; // INCR атомарный: ровно один обработчик видит n === цель
  // Сначала отмечаем право на набор — если доставка упадёт, «Забрать набор» пришлёт его без оплаты
  await d.users.patch(referrerId, {path: 'referral'});
  try {
    await send(d, referrerId, `🎃 ${name} — ${n}-я! Ты сделала это!\nДержи заслуженный набор 👇`);
    await deliverKit(d, referrerId);
  } catch (e) {
    console.error('referral deliver failed', e);
    await send(d, referrerId, 'Набор твой, но Telegram сейчас капризничает 😔 Нажми /start → «Забрать набор» — пришлю сразу.').catch(() => {});
    await notifyAdmin(d, `🚨 Рефералка: ${who(ref)} привела ${n} друзей, но набор не доставлен (id ${referrerId})`);
    return;
  }
  await notifyAdmin(d, `👯 Рефералка: ${who(ref)} привела ${n} друзей и забрала набор`);
}

// ---------- обработчики ----------
async function onJoinRequest(d: Deps, req: any) {
  if (req.chat.id !== cfg.channelId()) return;
  await d.users.upsert(req.from);
  // Писать можно, пока заявка не обработана: сначала пишем, потом одобряем.
  try {
    await send(d, req.user_chat_id, '👻 Заявка принята — добро пожаловать в канал «Кристина о нейронках»!');
    await sendWelcome(d, req.user_chat_id, true);
  } catch (e) { console.warn('join DM failed', e); }
  try { await d.tg.call('approveChatJoinRequest', {chat_id: req.chat.id, user_id: req.from.id}); }
  catch (e) {
    console.error('approve failed', e);
    await notifyAdmin(d, `⚠️ Не получилось одобрить заявку ${who(req.from)}: ${esc(String(e))}\nПроверьте, что у бота есть право приглашать пользователей.`);
  }
}


async function hasKit(d: Deps, uid: number) {
  const u = await d.users.get(uid);
  return !!(u?.deliveredAt || u?.path === 'referral' || (u?.path === 'stars' && u.chargeId) || (await d.users.getPayment(uid)));
}

async function kitAction(d: Deps, uid: number) {
  if (await hasKit(d, uid)) {
    await send(d, uid, 'Набор у вас уже есть — присылаю ещё раз 😉');
    return deliverKit(d, uid);
  }
  if (!(await isMember(d, uid))) {
    return send(d, uid, 'Сначала вступите в канал «Кристина о нейронках» — заявки принимаю моментально ⚡\nПотом нажмите «Проверить».',
      {reply_markup: kb([[{text: '📢 Вступить в канал', url: cfg.inviteLink()}], [{text: '✅ Проверить', data: 'kit'}]])});
  }
  return send(d, uid,
    'Вы в канале — отлично! 🎉\n\nКак забрать набор:\n' +
    `📢 <b>Есть свой публичный канал от ${cfg.minSubs()} подписчиков?</b> Опубликуйте у себя пост с подарком — набор бесплатно. Я даже соберу обложку с вашим фото.\n` +
    `⭐ <b>Канала нет?</b> Набор можно забрать за ${cfg.priceStars()} звёзд.`,
    {reply_markup: kb([[{text: `📢 У меня канал ${cfg.minSubs()}+`, data: 'path_repost'}], starsBtn(),
      ...(refOpen() ? [[{text: `👯 Позвать ${cfg.refGoal()} подруг — бесплатно`, data: 'ref_status'}]] : [])])});
}

async function onCallback(d: Deps, q: any) {
  await d.tg.call('answerCallbackQuery', {callback_query_id: q.id}).catch(() => {});
  const uid = q.from.id;
  await d.users.upsert(q.from);
  // после дедлайна оплатившие всё равно могут забрать набор
  if (isOver()) return q.data === 'kit' && (await hasKit(d, uid)) ? kitAction(d, uid) : send(d, uid, over());

  switch (q.data) {
    case 'kit':
      return kitAction(d, uid);
    case 'ref_status':
      return refStatus(d, uid);
    case 'path_repost':
      await d.users.patch(uid, {state: 'await_channel'});
      return send(d, uid, 'Пришлите ссылку на ваш канал или его @имя.\nНапример: <code>@my_channel</code> или <code>https://t.me/my_channel</code>\n\nКанал должен быть публичным — так я смогу проверить пост.');
    case 'path_stars': {
      if (await hasKit(d, uid)) {
        await send(d, uid, 'Набор у вас уже есть — платить второй раз не нужно 😉');
        return deliverKit(d, uid);
      }
      return sendInvoice(d, uid);
    }
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
  await d.users.savePayment(uid, p.telegram_payment_charge_id, p.total_amount);
  await d.users.patch(uid, {path: 'stars', chargeId: p.telegram_payment_charge_id, stars: p.total_amount});
  await send(d, uid, '⭐ Оплата прошла, спасибо!');
  try {
    await deliverKit(d, uid);
  } catch (e) {
    console.error('deliver after payment failed', e);
    await send(d, uid, 'Оплата прошла, но файлы не отправились из-за сбоя Telegram 😔 Нажмите /start → «Забрать набор» — пришлю без повторной оплаты.').catch(() => {});
    await notifyAdmin(d, `🚨 Оплата есть, набор не доставлен: ${who(msg.from)}, id ${uid}, charge_id <code>${esc(p.telegram_payment_charge_id)}</code>`);
    return;
  }
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
      `👯 Пришли по ссылкам друзей: ${all.filter(u => u.referredBy).length}, забрали за ${cfg.refGoal()} друзей: ${all.filter(u => u.path === 'referral').length}\n` +
      `⏳ Раздача до ${deadlineStr()}`);
    return true;
  }
  if (cmd === '/export') {
    const cols: (keyof User)[] = ['id', 'username', 'firstName', 'createdAt', 'path', 'channel', 'channelTitle', 'channelSubs', 'postLink', 'stars', 'chargeId', 'deliveredAt', 'refCount', 'referredBy'];
    for (const u of all) u.refCount = await d.users.refCount(u.id) || undefined;
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cols.join(','), ...all.map(u => cols.map(c => q(u[c])).join(','))].join('\n');
    await d.tg.upload('sendDocument', {chat_id: String(uid)}, [{name: 'document', data: new TextEncoder().encode(csv), filename: 'participants.csv', type: 'text/csv'}]);
    return true;
  }
  if (cmd === '/ref_preview') {
    await send(d, uid, refPitch({id: uid, firstName: all.find(u => u.id === uid)?.firstName}));
    await sendTimer(d, uid, timerCaption(), 0);
    await send(d, uid, '☝️ Так увидят сообщение участники без набора. Отправить всем: /ref_send');
    return true;
  }
  if (cmd === '/ref_send') {
    if (!refOpen()) { await send(d, uid, `Окошко уже закрыто (${refDeadlineStr()}). Поменяйте REF_DEADLINE в Vercel.`); return true; }
    let ok = 0, fail = 0, skip = 0;
    let photoId: string | undefined;
    for (const u of all) {
      if (u.id === uid || (await hasKit(d, u.id))) { skip++; continue; }
      if (!(await d.users.markBroadcast(u.id))) { skip++; continue; }
      try {
        await send(d, u.id, refPitch(u));
        photoId = await sendTimer(d, u.id, timerCaption(), 0, photoId);
        ok++;
      }
      catch (e) { fail++; console.warn('broadcast', u.id, e); }
      await new Promise(r => setTimeout(r, 60));
    }
    await send(d, uid, `📨 Разослала: ${ok}\n🚫 Не дошло (заблокировали бота или ни разу не нажимали «Старт»): ${fail}\n⏭ Пропущено (есть набор или уже получали): ${skip}`);
    return true;
  }
  if (cmd === '/refund') {
    const target = all.find(u => String(u.id) === arg);
    const pay = target ? await d.users.getPayment(target.id) : null;
    if (target && pay) target.chargeId = pay.chargeId;
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
  const isNew = !(await d.users.get(uid));
  await d.users.upsert(msg.from);
  const text: string = msg.text ?? '';

  if (text.startsWith('/')) {
    const [cmd, arg] = text.split(/\s+/);
    const c = cmd.split('@')[0];
    if (await onAdmin(d, uid, c, arg)) return;
    if (c === '/terms') {
      return send(d, uid,
        `📄 Условия\n\n«ИИ-помощник своими руками» — 5 PDF-файлов. Оплата ${cfg.priceStars()} ⭐ Telegram Stars.\n` +
        'Файлы приходят сюда, в бот, сразу после оплаты.\nЕсли файлы не пришли или что-то пошло не так — напишите в /paysupport, разберёмся или вернём звёзды.\n' +
        'Материалы — для личного использования.');
    }
    if (c === '/paysupport') {
      return send(d, uid, `💬 Поддержка по оплатам: напишите ${cfg.contact()}.\nУкажите, когда платили, — платёж я найду сама.`);
    }
    // /start kit — пришли по кнопке из приветствия после заявки в канал
    await d.users.patch(uid, {state: null});
    const rm = c === '/start' && arg ? /^ref_(\d+)$/.exec(arg) : null;
    if (rm && isNew) {
      try { await onReferral(d, msg.from, Number(rm[1])); } catch (e) { console.warn('referral failed', e); }
    }
    if (c === '/start' && arg === 'kit') {
      if (isOver() && !(await hasKit(d, uid))) return send(d, uid, over());
      return kitAction(d, uid);
    }
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
      return send(d, uid, 'Не получилось собрать обложку с этим фото 😔 Пришлите другое — обычным фото, не файлом. Или оставьте на обложке Кристину.',
        {reply_markup: kb([kristinaBtn()])});
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

/** Раз в день (Vercel Cron): посты, которым больше суток, проверяем повторно. */
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
