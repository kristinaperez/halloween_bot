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
  deadline: () => {
    const d = new Date(env('DEADLINE', '2026-11-08T23:59:00+01:00'));
    if (Number.isNaN(d.getTime())) {
      console.error('DEADLINE задан неверно, использую 2026-11-08T23:59:00+01:00');
      return new Date('2026-11-08T23:59:00+01:00');
    }
    return d;
  },
  // Реферальное окошко: до 2 ноября 05:00 по Москве
  refDeadline: () => {
    const d = new Date(env('REF_DEADLINE', '2026-11-02T05:00:00+03:00'));
    return Number.isNaN(d.getTime()) ? new Date('2026-11-02T05:00:00+03:00') : d;
  },
  refGoal: () => { const n = Number(env('REF_GOAL', '3')); return Number.isInteger(n) && n > 0 ? n : 3; },
};

export const refOpen = (now = new Date()) => now <= cfg.refDeadline() && !isOver(now);

/** «05:00 по Москве» */
export function refDeadlineStr(): string {
  const f = new Intl.DateTimeFormat('ru-RU', {timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit'});
  return `${f.format(cfg.refDeadline())} по Москве`;
}

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
