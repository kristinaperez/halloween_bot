import {RedisKV, Users} from '../server/store.js';
import {telegram} from '../server/tg.js';
import {recheckPosts, fetchPost} from '../server/bot.js';

// Vercel Cron (раз в день, см. vercel.json): проверяет, не удалили ли участники пост через сутки.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Forbidden', {status: 403});
  if (!process.env.TELEGRAM_BOT_TOKEN) return new Response('Not configured');
  await recheckPosts({tg: telegram, users: new Users(new RedisKV()), fetchPost});
  return new Response('OK');
}
