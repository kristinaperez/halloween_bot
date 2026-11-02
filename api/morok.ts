import {cfg} from '../server/config.js';
import {RedisKV, Users} from '../server/store.js';
import {morokTelegram} from '../server/tg.js';
import {morokCallback, morokPrivate} from '../server/scenario.js';

// Webhook отдельного бота Лорда Морока (если он есть): https://<проект>.vercel.app/api/morok
// Ловит «Вызвать Морока» под его постами и личные сообщения ему. Сценарием управляет праздничный бот.
export async function POST(request: Request) {
  const secret = request.headers.get('x-telegram-bot-api-secret-token');
  if (!cfg.webhookSecret() || secret !== cfg.webhookSecret()) return new Response('Forbidden', {status: 403});
  const morok = morokTelegram();
  const update = await request.json().catch(() => null);
  if (!morok || !update) return new Response('OK');
  const users = new Users(new RedisKV());
  if (update.update_id !== undefined && (await users.seenUpdate(update.update_id, 'mupd'))) return new Response('OK');
  try {
    if (update.callback_query?.data === 'mk:call') await morokCallback({tg: morok, users}, update.callback_query);
    else if (update.callback_query) await morok.call('answerCallbackQuery', {callback_query_id: update.callback_query.id}).catch(() => {});
    else if (update.message?.chat?.type === 'private') await morokPrivate({tg: morok, users, morokTg: morok}, update.message);
  } catch (e) { console.warn('morok webhook', e); }
  return new Response('OK');
}

export function GET() {
  return new Response('Lord Morok is watching 😈');
}
