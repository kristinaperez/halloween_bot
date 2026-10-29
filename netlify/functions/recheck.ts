import {BlobKV, Users} from '../../server/store.ts';
import {telegram} from '../../server/tg.ts';
import {recheckPosts, fetchPost} from '../../server/bot.ts';

// Раз в час проверяет, не удалили ли участники пост через сутки. Работает только на опубликованном сайте.
export default async () => {
  if (!process.env.TELEGRAM_BOT_TOKEN) return new Response('Not configured');
  await recheckPosts({tg: telegram, users: new Users(new BlobKV()), fetchPost});
  return new Response('OK');
};
export const config = {schedule: '@hourly'};
