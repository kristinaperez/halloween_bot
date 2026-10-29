import {existsSync} from 'node:fs';
import path from 'node:path';

const env = (k: string, d = '') => process.env[k] ?? d;

export const cfg = {
  token: () => env('TELEGRAM_BOT_TOKEN'),
  webhookSecret: () => env('TELEGRAM_WEBHOOK_SECRET'),
  channelId: () => Number(env('CHANNEL_ID')),
  adminId: () => Number(env('ADMIN_ID', '0')),
  inviteLink: () => env('CHANNEL_INVITE_LINK'),
  contact: () => env('CONTACT', '@KristinaPerez9'),
  botUsername: () => env('BOT_USERNAME', 'SantaHalloween2026bot'),
  minSubs: () => Number(env('MIN_SUBS', '100')),
  priceStars: () => Number(env('PRICE_STARS', '499')),
  // Конец раздачи: 8 ноября 23:59 по Мадриду (UTC+1 зимой)
  deadline: () => new Date(env('DEADLINE', '2026-11-08T23:59:00+01:00')),
};

export const isOver = (now = new Date()) => now > cfg.deadline();

export function deadlineStr(): string {
  const d = cfg.deadline();
  const f = new Intl.DateTimeFormat('ru-RU', {timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'});
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}.${p.month} в ${p.hour}:${p.minute} по Мадриду`;
}

/** Файлы из included_files: ищем в нескольких местах, т.к. корень функции зависит от среды. */
export function asset(rel: string): string {
  const roots = [process.cwd(), process.env.LAMBDA_TASK_ROOT ?? '', path.resolve('.')].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, rel);
    if (existsSync(p)) return p;
  }
  return path.join(process.cwd(), rel);
}
