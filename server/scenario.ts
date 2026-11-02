/**
 * Сценарный движок: публикует шаги сюжета в канал по одному, по кнопке админа «▶ Следующая сцена».
 *
 * Почему вручную, а не по таймеру: на Vercel функция живёт до 60 секунд, а cron бесплатного тарифа —
 * раз в сутки. Зато Кристина сама выбирает паузы и может подстроиться под реакцию подписчиков.
 *
 * Защита от повторов:
 *  - состояние запуска хранится в Redis (`morok:run`), уже опубликованные шаги не публикуются снова;
 *  - перед публикацией шаг помечается как «отправляется»; если функция упала посреди отправки,
 *    бот не шлёт его повторно сам, а спрашивает админа: «повторить или пропустить»;
 *  - одновременные нажатия отсекает короткая блокировка `morok:lock`;
 *  - завершённый сценарий повторно запускается только явной командой `/morok_start again`.
 */
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {cfg, asset} from './config.js';
import {TelegramError, type TG} from './tg.js';
import type {Users} from './store.js';
import {SCENARIO, LABEL, decreeButtons, randomLine, type Step} from './morok.js';

export type MorokDeps = {tg: TG; users: Users; morokTg?: TG};

export type RunState = {
  runId: number;
  status: 'running' | 'paused' | 'done';
  /** Индекс следующего шага. */
  next: number;
  /** Индекс шага, который начали отправлять, но не дождались ответа Telegram. */
  sending?: number;
  /** id сообщений в канале по шагам. */
  posted: Record<string, number>;
  pollMessageId?: number;
  pollResult?: string;
  startedAt: string;
  finishedAt?: string;
};

const RUN = 'morok:run';
const LOCK = 'morok:lock';

const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const kb = (rows: {text: string; data: string}[][]) => ({inline_keyboard: rows.map(r => r.map(b => ({text: b.text, callback_data: b.data})))});

export const getRun = (d: MorokDeps) => d.users.kv.get<RunState>(RUN);
const saveRun = (d: MorokDeps, st: RunState) => d.users.kv.set(RUN, st);

const mediaPath = (file: string) => asset(`assets/morok/${file}`);
export const missingMedia = () => SCENARIO.filter(s => s.media && !existsSync(mediaPath(s.media))).map(s => s.media!);

const adminSay = (d: MorokDeps, text: string, extra: Record<string, unknown> = {}) =>
  d.tg.call('sendMessage', {chat_id: cfg.adminId(), text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra});

// ---------- публикация одного шага ----------
type Target = {chat: number | string; mode: 'live' | 'test' | 'preview'};

/** Кто публикует шаг и нужна ли подпись «😈 Лорд Морок:» в тексте. */
function speaker(d: MorokDeps, step: Step, mode: Target['mode']) {
  const ownBot = mode !== 'preview' && step.voice === 'morok' && d.morokTg ? d.morokTg : undefined;
  const tg = ownBot ?? d.tg;
  // Пост подписан своим автором, если в канале включены подписи и у голоса свой аккаунт
  const signedByOwner = cfg.signatures() && mode !== 'preview' && (step.voice === 'halloween' || !!ownBot);
  const label = !step.noLabel && !signedByOwner;
  return {tg, label, botKey: ownBot ? 'morok' : 'main'};
}

export function stepText(step: Step, label: boolean) {
  const body = step.text?.() ?? '';
  return label ? `${LABEL[step.voice]}\n${body}` : body;
}

/** Публикует шаг, возвращает message_id. Картинку загружает один раз и дальше шлёт по file_id. */
export async function publishStep(d: MorokDeps, step: Step, target: Target): Promise<number> {
  const {tg, label, botKey} = speaker(d, step, target.mode);
  const common: Record<string, unknown> = {chat_id: target.chat, disable_notification: !!step.silent};
  if (step.kind === 'poll' && step.poll) {
    const m = await tg.call('sendPoll', {...common, question: step.poll.question, options: step.poll.options.map(text => ({text})), is_anonymous: true});
    return m.message_id;
  }
  const text = stepText(step, label);
  const markup = step.buttons === 'decree' ? {reply_markup: decreeButtons()} : {};
  if (step.media && existsSync(mediaPath(step.media))) {
    const isVideo = step.media.endsWith('.mp4');
    const method = isVideo ? 'sendAnimation' : 'sendPhoto';
    const field = isVideo ? 'animation' : 'photo';
    const cacheKey = `morok-media:${botKey}:${step.media}`;
    const cached = await d.users.getCache<string>(cacheKey);
    const fields = {...common, caption: text, parse_mode: 'HTML', ...markup};
    if (cached) return (await tg.call(method, {...fields, [field]: cached})).message_id;
    const data = new Uint8Array(await readFile(mediaPath(step.media)));
    const m = await tg.upload(method, {...fields, chat_id: String(target.chat)},
      [{name: field, data, filename: step.media, type: isVideo ? 'video/mp4' : 'image/jpeg'}]);
    const fileId = isVideo ? (m.animation ?? m.document)?.file_id : m.photo?.at(-1)?.file_id;
    if (fileId) await d.users.setCache(cacheKey, fileId);
    return m.message_id;
  }
  return (await tg.call('sendMessage', {...common, text, parse_mode: 'HTML', disable_web_page_preview: true, ...markup})).message_id;
}

/** Весь сценарий подряд — в личку админу (предпросмотр) или в тестовый чат. */
async function publishAll(d: MorokDeps, target: Target, pause = 400) {
  for (const step of SCENARIO) {
    await publishStep(d, step, target);
    await new Promise(r => setTimeout(r, pause));
  }
}

// ---------- админка ----------
const voiceName = {halloween: 'праздничный бот', morok: 'Лорд Морок', cristina: 'ты'} as const;

function stepLine(i: number) {
  const s = SCENARIO[i];
  return `${i + 1}/${SCENARIO.length}. <b>${esc(s.title)}</b> — ${voiceName[s.voice]}${s.voice === 'cristina' ? ' (публикуешь сама или поручаешь боту)' : ''}`;
}

async function control(d: MorokDeps, st: RunState, done?: string) {
  const head = done ? `✅ Опубликовано: ${esc(done)}\n\n` : '';
  if (st.status === 'done') {
    return adminSay(d, `${head}🎬 <b>Сценарий завершён.</b>\nКогда захочешь подвести итог — закрой голосование.`,
      {reply_markup: kb([[{text: '🗳 Закрыть голосование и узнать итог', data: 'mk:poll'}]])});
  }
  if (st.status === 'paused') {
    return adminSay(d, `${head}⏸ Сценарий на паузе. Следующий шаг: ${stepLine(st.next)}`, {reply_markup: kb([[{text: '▶ Продолжить', data: 'mk:resume'}]])});
  }
  const prev = SCENARIO[st.next - 1];
  return adminSay(d,
    `${head}Следующий шаг: ${stepLine(st.next)}${prev ? `\n💡 ${esc(prev.hint)}` : ''}`,
    {reply_markup: kb([[{text: '▶ Следующая сцена', data: 'mk:next'}], [{text: '⏸ Пауза', data: 'mk:pause'}]])});
}

async function statusText(d: MorokDeps) {
  const st = await getRun(d);
  const missing = missingMedia();
  const lines = [
    `😈 <b>Лорд Морок</b>`,
    `Бот Морока: ${d.morokTg ? 'подключён (MOROK_BOT_TOKEN)' : 'нет — Морок говорит через праздничного бота с подписью в тексте'}`,
    `Подписи авторов в канале: ${cfg.signatures() ? 'включены (CHANNEL_SIGNATURES=1)' : 'выключены — у каждой реплики в тексте подпись'}`,
    `Тестовый чат: ${cfg.testChatId() ? esc(cfg.testChatId()) : 'не задан (TEST_CHAT_ID)'}`,
    missing.length ? `⚠️ Нет картинок в assets/morok/: ${missing.join(', ')} — эти посты уйдут только текстом` : '🖼 Все картинки на месте',
  ];
  if (!st) lines.push('\nСценарий ещё не запускался.');
  else {
    const state = {running: '▶ идёт', paused: '⏸ на паузе', done: '🎬 завершён'}[st.status];
    lines.push(`\nСценарий: ${state}, опубликовано ${Object.keys(st.posted).length} из ${SCENARIO.filter(s => s.voice !== 'cristina').length} постов бота (шаг ${Math.min(st.next, SCENARIO.length)}/${SCENARIO.length})`);
    if (st.sending !== undefined) lines.push(`⚠️ Шаг «${esc(SCENARIO[st.sending].title)}» мог не дойти — проверь канал`);
    if (st.pollResult) lines.push(`\n🗳 Итог голосования:\n${st.pollResult}`);
  }
  return lines.join('\n');
}

/** Команды /morok_* (только админ). true — команда обработана. */
export async function morokCommand(d: MorokDeps, cmd: string, arg?: string): Promise<boolean> {
  switch (cmd) {
    case '/morok_status':
      await adminSay(d, await statusText(d));
      return true;
    case '/morok_preview':
      await adminSay(d, '👁 <b>Предпросмотр.</b> Так посты будут выглядеть. В канал ничего не уходит.');
      await publishAll(d, {chat: cfg.adminId(), mode: 'preview'});
      await adminSay(d, `☝️ Это весь сценарий: ${SCENARIO.length} шагов.\nПроверить в тестовом канале с настоящими подписями: /morok_test\nЗапустить в канал: /morok_start`);
      return true;
    case '/morok_test': {
      if (!cfg.testChatId()) {
        await adminSay(d, 'Создай закрытый тестовый канал, добавь туда праздничного бота (и бота Морока, если он есть) админами с правом публикации, ' +
          'потом впиши его id в Vercel как TEST_CHAT_ID и сделай Redeploy.\n\nУзнать id: перешли любой пост из тестового канала боту @userinfobot.');
        return true;
      }
      await adminSay(d, '🧪 Публикую весь сценарий в тестовый чат…');
      try {
        await publishAll(d, {chat: cfg.testChatId(), mode: 'test'});
        await adminSay(d, '✅ Готово — посмотри тестовый канал. Голосование и кнопку «Вызвать Морока» тоже можно потыкать.');
      } catch (e) {
        await adminSay(d, `Не получилось: ${esc(String(e))}\nПроверь, что боты — админы тестового канала с правом публикации.`);
      }
      return true;
    }
    case '/morok_stop': {
      const st = await getRun(d);
      if (st?.status !== 'running') { await adminSay(d, 'Сценарий сейчас не идёт.'); return true; }
      st.status = 'paused'; await saveRun(d, st);
      await control(d, st);
      return true;
    }
    case '/morok_start': {
      const st = await getRun(d);
      if (st?.status === 'running') { await adminSay(d, 'Сценарий уже идёт.'); await control(d, st); return true; }
      if (st?.status === 'paused') { await control(d, st); return true; }
      if (st?.status === 'done' && arg !== 'again') {
        await adminSay(d, '🎬 Этот сценарий уже показан в канале. Чтобы показать его ещё раз с начала: <code>/morok_start again</code>');
        return true;
      }
      const missing = missingMedia();
      await adminSay(d,
        `🚀 <b>Запуск «Дела четырёх блокировок»</b> в канал (${cfg.channelId()}).\n\n` +
        `Шагов: ${SCENARIO.length}. Каждый следующий публикуется только по твоей кнопке «▶ Следующая сцена». ` +
        'Твои реплики бот пришлёт тебе — опубликуешь их сама или поручишь боту.\n' +
        (d.morokTg ? 'Морок публикует от своего бота.\n' : 'Морок говорит через праздничного бота.\n') +
        (missing.length ? `\n⚠️ Нет картинок: ${missing.join(', ')} — эти посты уйдут только текстом.\n` : '') +
        (st?.status === 'done' ? '\n⚠️ Это повторный показ — посты появятся в канале второй раз.\n' : '') +
        '\nЗапускаем?',
        {reply_markup: kb([[{text: '🚀 Да, запустить', data: st?.status === 'done' ? 'mk:go_again' : 'mk:go'}], [{text: 'Отмена', data: 'mk:cancel'}]])});
      return true;
    }
  }
  return false;
}

// ---------- шаги по кнопкам ----------
type How = 'next' | 'manualDone' | 'asBot' | 'retry' | 'skip';

async function advance(d: MorokDeps, how: How) {
  if (!(await d.users.kv.setOnce(LOCK, 55))) return adminSay(d, '⏳ Публикую предыдущий шаг, подожди пару секунд.');
  try { await advanceLocked(d, how); }
  finally { await d.users.kv.del(LOCK); }
}

async function advanceLocked(d: MorokDeps, how: How) {
  {
    const st = await getRun(d);
    if (!st || st.status === 'done') return adminSay(d, 'Сценарий не идёт. Статус: /morok_status');
    if (st.status === 'paused') return control(d, st);

    if (st.sending !== undefined && how !== 'retry' && how !== 'skip') {
      return adminSay(d,
        `⚠️ Шаг «${esc(SCENARIO[st.sending].title)}» начал отправляться, но я не получила ответ Telegram. Загляни в канал: он там есть?`,
        {reply_markup: kb([[{text: '✅ Есть — идём дальше', data: 'mk:skip'}], [{text: '🔁 Нет — отправить снова', data: 'mk:retry'}]])});
    }
    if (how === 'skip' || how === 'retry') {
      if (st.sending === undefined) return control(d, st);
      if (how === 'skip') { st.next = st.sending + 1; st.sending = undefined; return finish(d, st, SCENARIO[st.next - 1].title); }
      st.next = st.sending; st.sending = undefined;
    }

    const i = st.next;
    const step = SCENARIO[i];
    if (step.voice === 'cristina' && how === 'next') {
      await d.tg.call('sendMessage', {chat_id: cfg.adminId(), text: step.text?.() ?? ''});
      return adminSay(d,
        `☝️ Твоя реплика (шаг ${i + 1}/${SCENARIO.length}). Скопируй и опубликуй в канале от себя${step.silent ? ' — можно «отправить без звука»' : ''}.`,
        {reply_markup: kb([[{text: '✅ Я опубликовала — дальше', data: 'mk:manual_done'}], [{text: '🤖 Пусть опубликует бот', data: 'mk:as_bot'}]])});
    }
    if (how === 'manualDone') {
      if (step.voice !== 'cristina') return control(d, st);
      st.next = i + 1;
      return finish(d, st, `${step.title} (ты сама)`);
    }

    st.sending = i;
    await saveRun(d, st);
    try {
      st.posted[step.id] = await publishStep(d, step, {chat: cfg.channelId(), mode: 'live'});
    } catch (e) {
      // Ошибка Telegram API = пост точно не ушёл, можно спокойно повторить.
      // Таймаут или обрыв = неизвестно, поэтому шаг остаётся «отправляется» и бот спросит.
      if (e instanceof TelegramError) { st.sending = undefined; await saveRun(d, st); }
      return adminSay(d, `❌ Шаг «${esc(step.title)}» не опубликован: ${esc(String((e as Error).message ?? e))}`,
        {reply_markup: kb([[{text: '🔁 Попробовать ещё раз', data: e instanceof TelegramError ? 'mk:next' : 'mk:retry'}]])});
    }
    if (step.kind === 'poll') st.pollMessageId = st.posted[step.id];
    st.sending = undefined;
    st.next = i + 1;
    return finish(d, st, step.title);
  }
}

async function finish(d: MorokDeps, st: RunState, title: string) {
  if (st.next >= SCENARIO.length) { st.status = 'done'; st.finishedAt = new Date().toISOString(); }
  await saveRun(d, st);
  return control(d, st, title);
}

async function closePoll(d: MorokDeps) {
  const st = await getRun(d);
  if (!st?.pollMessageId) return adminSay(d, 'Голосование ещё не опубликовано.');
  let poll: any;
  try { poll = await d.tg.call('stopPoll', {chat_id: cfg.channelId(), message_id: st.pollMessageId}); }
  catch (e) {
    if (st.pollResult) return adminSay(d, `🗳 Голосование уже закрыто.\n${st.pollResult}`);
    return adminSay(d, `Не получилось закрыть: ${esc(String(e))}`);
  }
  const total = poll.total_voter_count ?? 0;
  const rows = [...poll.options].sort((a: any, b: any) => b.voter_count - a.voter_count)
    .map((o: any) => `${esc(o.text)} — ${o.voter_count}${total ? ` (${Math.round((o.voter_count / total) * 100)}%)` : ''}`);
  st.pollResult = `${rows.join('\n')}\nВсего голосов: ${total}`;
  await saveRun(d, st);
  return adminSay(d, `🗳 <b>Итог: что делать с Лордом Мороком</b>\n\n${st.pollResult}\n\nПобедитель — сюжет следующей серии 😈`);
}

/**
 * Нажатия кнопок с префиксом mk:. Возвращает true, если обработали.
 * «Вызвать Морока» доступна всем и отвечает всплывающим окном — никому ничего не пишем в личку
 * и не сохраняем нажавших в базу.
 */
export async function morokCallback(d: MorokDeps, q: any): Promise<boolean> {
  const data: string = q.data ?? '';
  if (!data.startsWith('mk:')) return false;
  if (data === 'mk:call') {
    await d.tg.call('answerCallbackQuery', {callback_query_id: q.id, text: `😈 ${randomLine()}`, show_alert: true}).catch(() => {});
    return true;
  }
  await d.tg.call('answerCallbackQuery', {callback_query_id: q.id}).catch(() => {});
  if (q.from?.id !== cfg.adminId()) return true;
  switch (data) {
    case 'mk:go':
    case 'mk:go_again': {
      const st = await getRun(d);
      if (st && st.status !== 'done') return control(d, st).then(() => true);
      if (st?.status === 'done' && data !== 'mk:go_again') { await adminSay(d, 'Сценарий уже показан. Повтор: /morok_start again'); return true; }
      const fresh: RunState = {runId: Date.now(), status: 'running', next: 0, posted: {}, startedAt: new Date().toISOString()};
      // setIfAbsent на runId: два быстрых нажатия «Запустить» не создадут два запуска
      if (!(await d.users.kv.setIfAbsent(`morok:start:${st?.runId ?? 0}`, fresh.runId))) return true;
      await saveRun(d, fresh);
      await adminSay(d, '🎬 Поехали! Первый шаг:');
      await advance(d, 'next');
      return true;
    }
    case 'mk:cancel': await adminSay(d, 'Отменено. В канал ничего не ушло.'); return true;
    case 'mk:next': await advance(d, 'next'); return true;
    case 'mk:manual_done': await advance(d, 'manualDone'); return true;
    case 'mk:as_bot': await advance(d, 'asBot'); return true;
    case 'mk:retry': await advance(d, 'retry'); return true;
    case 'mk:skip': await advance(d, 'skip'); return true;
    case 'mk:pause': {
      const st = await getRun(d);
      if (st?.status === 'running') { st.status = 'paused'; await saveRun(d, st); }
      if (st) await control(d, st);
      return true;
    }
    case 'mk:resume': {
      const st = await getRun(d);
      if (st?.status === 'paused') { st.status = 'running'; await saveRun(d, st); }
      if (st) await control(d, st);
      return true;
    }
    case 'mk:poll': await closePoll(d); return true;
  }
  return true;
}

/** Бот Морока в личке: отвечает в образе и отправляет за подарком к праздничному боту. */
export async function morokPrivate(d: MorokDeps, msg: any) {
  await d.tg.call('sendMessage', {
    chat_id: msg.chat.id,
    text: `😈 ${randomLine()}\n\n<i>Подарки раздаю не я. Это всё праздничный бот, добряк: @${cfg.botUsername()}</i>`,
    parse_mode: 'HTML',
  });
}
