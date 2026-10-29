import {cfg} from './config.js';

export type FileField = {name: string; data: Uint8Array; filename: string; type: string};

export interface TG {
  call(method: string, body?: Record<string, unknown>): Promise<any>;
  upload(method: string, fields: Record<string, unknown>, files: FileField[]): Promise<any>;
  download(fileId: string): Promise<Uint8Array>;
}

export class TelegramError extends Error {}

const api = (m: string) => `https://api.telegram.org/bot${cfg.token()}/${m}`;

async function parse(res: Response) {
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new TelegramError(j.description || `HTTP ${res.status}`);
  return j.result;
}

export const telegram: TG = {
  async call(method, body = {}) {
    const res = await fetch(api(method), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body), signal: AbortSignal.timeout(6000),
    });
    return parse(res);
  },
  async upload(method, fields, files) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    for (const f of files) form.append(f.name, new Blob([f.data], {type: f.type}), f.filename);
    const res = await fetch(api(method), {method: 'POST', body: form, signal: AbortSignal.timeout(9000)});
    return parse(res);
  },
  async download(fileId) {
    const file = await this.call('getFile', {file_id: fileId});
    if (!file.file_path || (file.file_size ?? 0) > 10 * 1024 * 1024) throw new TelegramError('Фото слишком большое');
    const res = await fetch(`https://api.telegram.org/file/bot${cfg.token()}/${file.file_path}`, {signal: AbortSignal.timeout(6000)});
    if (!res.ok) throw new TelegramError('Не удалось скачать фото');
    return new Uint8Array(await res.arrayBuffer());
  },
};
