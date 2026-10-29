// Запуск после деплоя: npm run telegram:webhook (или ... status). Токен и секрет — в локальном .env.
const token = process.env.TELEGRAM_BOT_TOKEN, secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !secret) throw Error('Укажите TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET локально в .env');
const site = new URL(process.env.SITE_URL || '');
if (site.protocol !== 'https:' || site.pathname !== '/') throw Error('SITE_URL должен быть адресом сайта вида https://имя.vercel.app');
const action = process.argv[2] || 'set';
const method = action === 'status' ? 'getWebhookInfo' : 'setWebhook';
const payload = action === 'status' ? {} : {
  url: site.origin + '/api/telegram',
  secret_token: secret,
  // chat_join_request и pre_checkout_query обязательны: заявки в канал и оплата звёздами
  allowed_updates: ['message', 'callback_query', 'chat_join_request', 'pre_checkout_query'],
  max_connections: 5,
  drop_pending_updates: false,
};
try {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)});
  const j = await r.json();
  if (!r.ok || !j.ok) throw Error(j.description || 'Telegram отказал');
  if (action === 'set') console.log('Webhook подключён: ' + site.origin + '/api/telegram. Откройте @SantaHalloween2026bot → /start.');
  else console.log(JSON.stringify({url: j.result.url, pending: j.result.pending_update_count, last_error: j.result.last_error_message || null}, null, 2));
} catch (e) { console.error('Не удалось: ' + e.message + '. Проверьте токен и SITE_URL.'); process.exitCode = 1; }
