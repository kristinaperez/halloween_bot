import {getStore} from '@netlify/blobs';

export interface User {
  id: number;
  username?: string;
  firstName?: string;
  createdAt: string;
  state?: 'await_channel' | 'await_photo' | 'await_post' | null;
  channel?: string;
  channelTitle?: string;
  channelSubs?: number;
  postLink?: string;
  path?: 'repost' | 'stars' | 'refunded';
  chargeId?: string;
  stars?: number;
  deliveredAt?: string;
  recheckedAt?: string;
}

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** Netlify Blobs — встроенное хранилище Netlify, отдельная база не нужна. */
export class BlobKV implements KV {
  private s = getStore({name: 'halloween-bot', consistency: 'strong'});
  async get<T>(key: string) { return (await this.s.get(key, {type: 'json'})) as T | null; }
  async set(key: string, value: unknown) { await this.s.setJSON(key, value); }
  async list(prefix: string) { return (await this.s.list({prefix})).blobs.map(b => b.key); }
}

/** Для тестов. */
export class MemoryKV implements KV {
  data = new Map<string, unknown>();
  async get<T>(key: string) { return (this.data.has(key) ? structuredClone(this.data.get(key)) : null) as T | null; }
  async set(key: string, value: unknown) { this.data.set(key, structuredClone(value)); }
  async list(prefix: string) { return [...this.data.keys()].filter(k => k.startsWith(prefix)); }
}

export class Users {
  private kv: KV;
  constructor(kv: KV) { this.kv = kv; }
  get(id: number) { return this.kv.get<User>(`user:${id}`); }
  async upsert(from: {id: number; username?: string; first_name?: string}): Promise<User> {
    const u = (await this.get(from.id)) ?? {id: from.id, createdAt: new Date().toISOString()};
    u.username = from.username;
    u.firstName = from.first_name;
    await this.kv.set(`user:${u.id}`, u);
    return u;
  }
  async patch(id: number, fields: Partial<User>): Promise<User> {
    const u = (await this.get(id)) ?? {id, createdAt: new Date().toISOString()};
    Object.assign(u, fields);
    await this.kv.set(`user:${id}`, u);
    return u;
  }
  async all(): Promise<User[]> {
    const keys = await this.kv.list('user:');
    const rows = await Promise.all(keys.map(k => this.kv.get<User>(k)));
    return rows.filter(Boolean) as User[];
  }
  /** Один канал — один подарок. */
  async channelOwner(channel: string) { return this.kv.get<number>(`channel:${channel.toLowerCase()}`); }
  async claimChannel(channel: string, userId: number) { await this.kv.set(`channel:${channel.toLowerCase()}`, userId); }
  /** Защита от повторной доставки одного и того же апдейта. */
  async seenUpdate(updateId: number): Promise<boolean> {
    const k = `upd:${updateId}`;
    if (await this.kv.get(k)) return true;
    await this.kv.set(k, 1);
    return false;
  }
  getCache<T>(key: string) { return this.kv.get<T>(`cache:${key}`); }
  setCache(key: string, v: unknown) { return this.kv.set(`cache:${key}`, v); }
}
