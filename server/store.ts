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
  path?: 'repost' | 'stars' | 'refunded' | 'referral';
  chargeId?: string;
  stars?: number;
  deliveredAt?: string;
  recheckedAt?: string;
  /** Кто привёл (id), сколько друзей привёл сам. */
  referredBy?: number;
  refCount?: number;
}

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  /** Записать, только если ключа ещё нет. true — записали (ключ был свободен). */
  setOnce(key: string, ttlSeconds: number): Promise<boolean>;
  /** Записать значение, только если ключа ещё нет. */
  setIfAbsent(key: string, value: unknown): Promise<boolean>;
  getMany<T>(keys: string[]): Promise<(T | null)[]>;
  list(prefix: string): Promise<string[]>;
  /** Атомарно +1, возвращает новое значение. */
  incr(key: string): Promise<number>;
}

/**
 * Redis от Upstash (Vercel → Storage / Marketplace → Upstash Redis).
 * Переменные подставляются интеграцией автоматически: KV_REST_API_URL / KV_REST_API_TOKEN
 * (или UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
 */
export class RedisKV implements KV {
  private url: string;
  private token: string;
  constructor() {
    this.url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '';
    this.token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
    if (!this.url || !this.token) throw new Error('Redis не подключён: нет KV_REST_API_URL / KV_REST_API_TOKEN');
  }
  private async cmd(...args: (string | number)[]): Promise<any> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(5000),
    });
    const j: any = await res.json();
    if (!res.ok || j.error) throw new Error(`Redis: ${j.error ?? res.status}`);
    return j.result;
  }
  async get<T>(key: string) {
    const v = await this.cmd('GET', key);
    return v == null ? null : (JSON.parse(v) as T);
  }
  async set(key: string, value: unknown) { await this.cmd('SET', key, JSON.stringify(value)); }
  async setOnce(key: string, ttlSeconds: number) {
    return (await this.cmd('SET', key, '1', 'NX', 'EX', ttlSeconds)) === 'OK';
  }
  async setIfAbsent(key: string, value: unknown) {
    return (await this.cmd('SET', key, JSON.stringify(value), 'NX')) === 'OK';
  }
  async getMany<T>(keys: string[]) {
    const out: (T | null)[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      const vals: (string | null)[] = await this.cmd('MGET', ...keys.slice(i, i + 100));
      out.push(...vals.map(v => (v == null ? null : (JSON.parse(v) as T))));
    }
    return out;
  }
  async incr(key: string) { return Number(await this.cmd('INCR', key)); }
  async list(prefix: string) {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.cmd('SCAN', cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      keys.push(...batch);
      cursor = String(next);
    } while (cursor !== '0');
    return keys;
  }
}

/** Для тестов. */
export class MemoryKV implements KV {
  data = new Map<string, unknown>();
  async get<T>(key: string) { return (this.data.has(key) ? structuredClone(this.data.get(key)) : null) as T | null; }
  async set(key: string, value: unknown) { this.data.set(key, structuredClone(value)); }
  async setOnce(key: string) { if (this.data.has(key)) return false; this.data.set(key, 1); return true; }
  async setIfAbsent(key: string, value: unknown) { if (this.data.has(key)) return false; this.data.set(key, structuredClone(value)); return true; }
  async getMany<T>(keys: string[]) { return Promise.all(keys.map(k => this.get<T>(k))); }
  async list(prefix: string) { return [...this.data.keys()].filter(k => k.startsWith(prefix)); }
  async incr(key: string) { const v = Number(this.data.get(key) ?? 0) + 1; this.data.set(key, v); return v; }
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
    return (await this.kv.getMany<User>(keys)).filter(Boolean) as User[];
  }
  /** Один канал — один подарок. */
  async channelOwner(channel: string) { return this.kv.get<number>(`channel:${channel.toLowerCase()}`); }
  /** Атомарно: true — канал наш (свободен или уже за этим же человеком). */
  async claimChannel(channel: string, userId: number): Promise<boolean> {
    const key = `channel:${channel.toLowerCase()}`;
    if (await this.kv.setIfAbsent(key, userId)) return true;
    return (await this.kv.get<number>(key)) === userId;
  }
  /** Оплата хранится отдельным ключом, чтобы одновременные обновления профиля её не затёрли. */
  savePayment(userId: number, chargeId: string, stars: number) { return this.kv.set(`pay:${userId}`, {chargeId, stars}); }
  getPayment(userId: number) { return this.kv.get<{chargeId: string; stars: number}>(`pay:${userId}`); }
  /** Защита от повторной доставки одного и того же апдейта (хранится 3 дня). */
  async seenUpdate(updateId: number): Promise<boolean> {
    return !(await this.kv.setOnce(`upd:${updateId}`, 3 * 24 * 3600));
  }
  /** Друг засчитывается только одному пригласившему. true — засчитали сейчас. */
  claimReferral(friendId: number, referrerId: number) { return this.kv.setIfAbsent(`ref:by:${friendId}`, referrerId); }
  /** +1 друг у пригласившего, возвращает новый счёт. */
  addReferral(referrerId: number) { return this.kv.incr(`ref:count:${referrerId}`); }
  async refCount(referrerId: number) { return Number((await this.kv.get<number>(`ref:count:${referrerId}`)) ?? 0); }
  /** Рассылку одному человеку отправляем один раз. */
  async markBroadcast(userId: number) { return this.kv.setIfAbsent(`ref:sent:${userId}`, 1); }
  getCache<T>(key: string) { return this.kv.get<T>(`cache:${key}`); }
  setCache(key: string, v: unknown) { return this.kv.set(`cache:${key}`, v); }
}
