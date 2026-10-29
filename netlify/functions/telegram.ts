import {cfg} from '../../server/config.ts';
import {BlobKV, Users} from '../../server/store.ts';
import {telegram} from '../../server/tg.ts';
import {handleUpdate, fetchPost} from '../../server/bot.ts';

// Telegram присылает сюда все события бота (webhook).
export default async (request: Request) => {
  if (request.method !== 'POST') return new Response('OK');
  const secret = request.headers.get('x-telegram-bot-api-secret-token');
  if (!cfg.webhookSecret() || secret !== cfg.webhookSecret()) return new Response('Forbidden', {status: 403});
  const update = await request.json().catch(() => null);
  if (update) await handleUpdate({tg: telegram, users: new Users(new BlobKV()), fetchPost}, update);
  return new Response('OK'); // всегда 200, чтобы Telegram не слал повторы
};
