import {cfg} from '../server/config.js';
import {RedisKV, Users} from '../server/store.js';
import {telegram} from '../server/tg.js';
import {handleUpdate, fetchPost} from '../server/bot.js';

// Telegram присылает сюда все события бота (webhook): https://<проект>.vercel.app/api/telegram
export async function POST(request: Request) {
  const secret = request.headers.get('x-telegram-bot-api-secret-token');
  if (!cfg.webhookSecret() || secret !== cfg.webhookSecret()) return new Response('Forbidden', {status: 403});
  const update = await request.json().catch(() => null);
  if (update) await handleUpdate({tg: telegram, users: new Users(new RedisKV()), fetchPost}, update);
  return new Response('OK'); // всегда 200, чтобы Telegram не слал повторы
}

export function GET() {
  return new Response('Halloween bot webhook is alive 🎃');
}
