import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
process.env.CHANNEL_ID='-1003772984999'; process.env.ADMIN_ID='6713072327'; process.env.CHANNEL_INVITE_LINK='https://t.me/+abc';
const {MemoryKV, Users} = await import('../server/store.js');
const bot = await import('../server/bot.js');
const {makePoster} = await import('../server/poster.js');

const log=[]; let members=new Set([1]);
const tg={
  async call(m,b){ log.push([m,b]);
    if(m==='getChatMember') return {status: members.has(b.user_id)?'member':'left'};
    if(m==='getChat') { if(b.chat_id==='@bigchan') return {id:-1,type:'channel',title:'Большой'}; if(b.chat_id==='@small') return {id:-2,type:'channel',title:'Мал'}; throw new Error('nf'); }
    if(m==='getChatMemberCount') return b.chat_id==='@bigchan'?250:12;
    if(m==='sendMediaGroup') return b.media.map((_,i)=>({document:{file_id:'C'+i}}));
    return {}; },
  async upload(m,f,files){ log.push([m,f,files.map(x=>x.filename)]);
    if(m==='sendMediaGroup') return files.map((_,i)=>({document:{file_id:'F'+i}}));
    if(m==='sendPhoto') return {photo:[{file_id:'P'}]}; return {}; },
  async download(){ return new Uint8Array(readFileSync(new URL('./fixtures/face.jpg', import.meta.url))); },
};
const users=new Users(new MemoryKV());
const d={tg,users,fetchPost:async(c,id)=> c==='bigchan'&&id==='77' ? '<div class="tgme_widget_message_text">@SantaHalloween2026bot</div>' : '<div class="tgme_widget_message_error">x</div>'};
let uid=0; const U=(id)=>({id,username:'u'+id,first_name:'Имя'+id});
const msg=(id,text,extra={})=>({update_id:++uid,message:{chat:{type:'private'},from:U(id),text,...extra}});
const cb=(id,data)=>({update_id:++uid,callback_query:{id:'q'+uid,from:U(id),data}});
const names=()=>log.map(x=>x[0]); const texts=()=>log.filter(x=>x[0]==='sendMessage').map(x=>x[1].text);

// 1. заявка в канал: DM до approve
await bot.handleUpdate(d,{update_id:++uid,chat_join_request:{chat:{id:-1003772984999},from:U(5),user_chat_id:5}});
const n=names(); assert.ok(n.indexOf('approveChatJoinRequest')>n.indexOf('sendMessage'), 'DM before approve');
assert.ok(log.some(x=>x[0]==='sendPhoto'&&x[1].chat_id==='5')||log.some(x=>x[0]==='sendPhoto'), 'welcome photo');
// дубль апдейта игнорируется
const before=log.length; await bot.handleUpdate(d,{update_id:uid,chat_join_request:{chat:{id:-1003772984999},from:U(5),user_chat_id:5}}); assert.equal(log.length,before);

// 2. не подписан → просим вступить
log.length=0; await bot.handleUpdate(d,cb(9,'kit')); assert.match(texts()[0],/Сначала вступите/);
// 3. подписан → выбор пути
log.length=0; await bot.handleUpdate(d,cb(1,'kit')); assert.match(texts()[0],/Как забрать набор/);
// 4. маленький канал
await bot.handleUpdate(d,cb(1,'path_repost')); log.length=0;
await bot.handleUpdate(d,msg(1,'@small')); assert.match(texts()[0],/12 подписчиков/);
// 5. закрытый канал
await bot.handleUpdate(d,cb(1,'path_repost')); log.length=0;
await bot.handleUpdate(d,msg(1,'https://t.me/+xyz')); assert.match(texts()[0],/закрытый канал/);
// 6. большой канал → фото → обложка
await bot.handleUpdate(d,cb(1,'path_repost')); log.length=0;
await bot.handleUpdate(d,msg(1,'https://t.me/bigchan')); assert.match(texts()[0],/250 подписчиков, подходит/);
log.length=0; await bot.handleUpdate(d,msg(1,undefined,{photo:[{file_id:'x'}]}));
const ph=log.find(x=>x[0]==='sendPhoto'); assert.ok(ph && ph[1].caption.includes('@SantaHalloween2026bot'));
assert.equal((await users.get(1)).state,'await_post');
// 7. пост из другого канала, потом без бота, потом правильный
log.length=0; await bot.handleUpdate(d,msg(1,'https://t.me/other/5')); assert.match(texts()[0],/другого канала/);
log.length=0; await bot.handleUpdate(d,msg(1,'https://t.me/bigchan/5')); assert.match(texts()[0],/нет @SantaHalloween2026bot/);
log.length=0; await bot.handleUpdate(d,msg(1,'https://t.me/bigchan/77'));
assert.ok(log.some(x=>x[0]==='sendMediaGroup'&&x[2]?.length===5), 'kit uploaded');
assert.ok(texts().some(t=>t.startsWith('📢 Репост')), 'admin notified');
const u1=await users.get(1); assert.equal(u1.path,'repost'); assert.ok(u1.deliveredAt);
// 8. тот же канал другим человеком
members.add(2); await bot.handleUpdate(d,cb(2,'path_repost')); log.length=0;
await bot.handleUpdate(d,msg(2,'@bigchan')); assert.match(texts()[0],/уже забирали/);
// 9. звёзды: счёт, pre-checkout, оплата → набор из кэша
log.length=0; await bot.handleUpdate(d,cb(2,'path_stars'));
const inv=log.find(x=>x[0]==='sendInvoice')[1]; assert.equal(inv.currency,'XTR'); assert.equal(inv.prices[0].amount,499);
log.length=0; await bot.handleUpdate(d,{update_id:++uid,pre_checkout_query:{id:'pc',invoice_payload:'kit:2'}}); assert.equal(log[0][1].ok,true);
log.length=0; await bot.handleUpdate(d,msg(2,undefined,{successful_payment:{telegram_payment_charge_id:'ch1',total_amount:499}}));
assert.ok(log.some(x=>x[0]==='sendMediaGroup'&&x[1].media[0].media==='F0'), 'kit from cache');
// 10. админ
log.length=0; await bot.handleUpdate(d,msg(6713072327,'/stats')); assert.match(texts()[0],/Забрали за пост: 1/); assert.match(texts()[0],/499 звёзд/);
log.length=0; await bot.handleUpdate(d,msg(6713072327,'/export')); assert.equal(log[0][0],'sendDocument');
log.length=0; await bot.handleUpdate(d,msg(1,'/stats')); assert.match(log[0]?.[0]??'', /sendPhoto|sendMessage/); // не админ → приветствие
// 11. дедлайн
process.env.DEADLINE='2020-01-01T00:00:00Z'; log.length=0; await bot.handleUpdate(d,cb(9,'kit')); assert.match(texts()[0],/завершилась/);
log.length=0; await bot.handleUpdate(d,{update_id:++uid,pre_checkout_query:{id:'pc2',invoice_payload:'kit:2'}}); assert.equal(log[0][1].ok,false);
delete process.env.DEADLINE;
// 12. обложка
const out = await makePoster(new Uint8Array(readFileSync(new URL('./fixtures/face.jpg', import.meta.url)))); assert.ok(out.length > 100000, 'poster built');

// 13. повторная оплата невозможна: кнопка «Купить» у оплатившего → набор без счёта
log.length=0; await bot.handleUpdate(d,cb(2,'path_stars'));
assert.ok(!log.some(x=>x[0]==='sendInvoice'), 'no second invoice'); assert.ok(log.some(x=>x[0]==='sendMediaGroup'));
// 14. оплатил, доставка упала → админ предупреждён, потом «Забрать набор» выдаёт без оплаты и без проверки подписки
members.delete(3);
const origCall=tg.call; let fail=true;
tg.call=async(m,b)=>{ if(fail&&m==='sendMediaGroup') throw new Error('tg down'); return origCall(m,b); };
log.length=0; await bot.handleUpdate(d,msg(3,undefined,{successful_payment:{telegram_payment_charge_id:'ch3',total_amount:499}}));
assert.ok(texts().some(t=>t.startsWith('🚨 Оплата есть')), 'admin alerted');
fail=false; log.length=0; await bot.handleUpdate(d,cb(3,'kit'));
assert.ok(log.some(x=>x[0]==='sendMediaGroup'), 'redelivered'); assert.ok(!texts().some(t=>/Сначала вступите/.test(t)));
assert.equal((await users.getPayment(3)).chargeId,'ch3');
// 15. /start kit из приветствия после заявки
members.add(4); log.length=0; await bot.handleUpdate(d,msg(4,'/start kit')); assert.match(texts()[0],/Как забрать набор/);
// 16. гонка за один канал: второй человек с той же ссылкой на пост не получает набор
await users.patch(7,{state:'await_post',channel:'bigchan'}); log.length=0;
await bot.handleUpdate(d,msg(7,'https://t.me/bigchan/77')); assert.match(texts()[0],/уже забирали/);
// 17. приветствие после заявки — кнопка-ссылка на /start kit
log.length=0; await bot.handleUpdate(d,{update_id:++uid,chat_join_request:{chat:{id:-1003772984999},from:U(8),user_chat_id:8}});
const w=log.find(x=>x[0]==='sendPhoto'); assert.match(JSON.stringify(w[1].reply_markup),/start=kit/);
// 18. cron без секрета закрыт
const {GET}=await import('../api/recheck.js'); delete process.env.CRON_SECRET; assert.equal((await GET(new Request('http://x/api/recheck'))).status,403);
// 19. после дедлайна оплативший всё равно получает набор
process.env.DEADLINE='2020-01-01T00:00:00Z'; log.length=0; await bot.handleUpdate(d,cb(3,'kit'));
assert.ok(log.some(x=>x[0]==='sendMediaGroup'), 'paid user after deadline'); delete process.env.DEADLINE;
// 20. рефералка: рассылка, 3 новых друга → набор; повторы, сам себя и старые пользователи не считаются
process.env.REF_DEADLINE='2099-01-01T05:00:00+03:00'; process.env.DEADLINE='2099-01-02T00:00:00Z';
await users.upsert(U(50)); await users.upsert(U(60));
log.length=0; await bot.handleUpdate(d,msg(6713072327,'/ref_preview'));
assert.match(texts()[0],/start=ref_6713072327/); assert.match(texts()[0],/05:00 по Москве/);
log.length=0; await bot.handleUpdate(d,msg(6713072327,'/ref_send'));
const sentTo=log.filter(x=>x[0]==='sendMessage'&&/хэллоуинская сделка/.test(x[1].text)).map(x=>x[1].chat_id);
assert.ok(sentTo.includes(50)&&sentTo.includes(60), 'broadcast to users without kit');
assert.ok(!sentTo.includes(1)&&!sentTo.includes(2)&&!sentTo.includes(6713072327), 'skip kit owners and admin');
log.length=0; await bot.handleUpdate(d,msg(6713072327,'/ref_send'));
assert.ok(!log.some(x=>x[0]==='sendMessage'&&/хэллоуинская сделка/.test(x[1].text)), 'no double broadcast');
await bot.handleUpdate(d,msg(50,'/start ref_50'));                 // сам себя
await bot.handleUpdate(d,msg(60,'/start ref_50'));                 // старый пользователь
assert.equal(await users.refCount(50),0);
log.length=0; await bot.handleUpdate(d,msg(101,'/start ref_50'));
assert.ok(texts().some(t=>/первая/.test(t)), 'referrer notified 1');
assert.ok(log.some(x=>x[0]==='sendPhoto'||x[0]==='sendMessage'&&x[1].chat_id===101), 'friend gets welcome');
await bot.handleUpdate(d,msg(101,'/start ref_50'));                 // повтор того же друга
assert.equal(await users.refCount(50),1);
await bot.handleUpdate(d,msg(102,'/start ref_50')); assert.equal(await users.refCount(50),2);
log.length=0; await bot.handleUpdate(d,msg(103,'/start ref_50'));
assert.ok(log.some(x=>x[0]==='sendMediaGroup'&&x[1].chat_id===50), 'kit delivered at 3');
assert.ok(texts().some(t=>t.startsWith('👯 Рефералка')), 'admin notified');
const r50=await users.get(50); assert.equal(r50.path,'referral'); assert.ok(r50.deliveredAt); assert.equal((await users.get(103)).referredBy,50);
log.length=0; await bot.handleUpdate(d,msg(104,'/start ref_50'));   // 4-й — набор второй раз не шлём
assert.ok(!log.some(x=>x[0]==='sendMediaGroup'&&x[1].chat_id===50));
log.length=0; await bot.handleUpdate(d,cb(60,'ref_status')); assert.match(texts()[0],/0 из 3/);
log.length=0; await bot.handleUpdate(d,msg(6713072327,'/stats')); assert.match(texts()[0],/Пришли по ссылкам друзей: 4, забрали за 3 друзей: 1/);
// доставка на третьем друге упала → право на набор сохраняется, админ предупреждён
await users.upsert(U(70));
for (const f of [201,202]) await bot.handleUpdate(d,msg(f,'/start ref_70'));
{ const oc=tg.call; tg.call=async(m,b)=>{ if(m==='sendMediaGroup') throw new Error('tg down'); return oc(m,b); };
  log.length=0; await bot.handleUpdate(d,msg(203,'/start ref_70')); tg.call=oc; }
assert.ok(texts().some(t=>t.startsWith('🚨 Рефералка')), 'admin alerted on failed referral delivery');
log.length=0; await bot.handleUpdate(d,cb(70,'kit')); assert.ok(log.some(x=>x[0]==='sendMediaGroup'&&x[1].chat_id===70), 'referral kit redelivered');
// окошко закрыто → не считается
process.env.REF_DEADLINE='2020-01-01T00:00:00Z';
await bot.handleUpdate(d,msg(105,'/start ref_60')); assert.equal(await users.refCount(60),0);
log.length=0; await bot.handleUpdate(d,cb(60,'ref_status')); assert.match(texts()[0],/Окошко закрылось/);
log.length=0; await bot.handleUpdate(d,cb(4,'kit')); assert.ok(!JSON.stringify(log).includes('ref_status'), 'no ref button after window');
delete process.env.REF_DEADLINE; delete process.env.DEADLINE;
console.log('ALL TESTS PASSED');
