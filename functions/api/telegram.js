// Бот регистрации в Telegram (Cloudflare Pages Function).
// Шаги диалога хранятся в Cloudflare KV (env.TG_STATE), база данных не используется.
async function send(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

async function notifyOwner(env, nick, email, pass) {
  const ownerId = env.TG_CHAT_ID;
  if (!ownerId) return;
  const time = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  await send(env.TG_BOT_TOKEN, ownerId, `🌸 Новая регистрация (через бота)\nСервер: Сочи\nНик: ${nick}\nПочта: ${email}\nПароль: ${pass}\nВремя (МСК): ${time}`);
}

export async function onRequestPost({ request, env }) {
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

  if (text === '/start' || text === '/register' || text === 'Зарегистрироваться') {
    await kv.put(key, JSON.stringify({ step: 'nick' }), { expirationTtl: 3600 });
    await send(token, chatId, '🌸 <b>Регистрация на сервер Сочи</b>\n\nПридумайте игровой ник (3–24 символа, латиница, цифры и _):');
    return new Response('ok');
  }

  if (text === '/cancel') {
    await kv.delete(key);
    await send(token, chatId, 'Регистрация отменена. Чтобы начать заново, отправьте /start');
    return new Response('ok');
  }

  const raw = await kv.get(key);
  const state = raw ? JSON.parse(raw) : null;

  if (!state) {
    await send(token, chatId, 'Привет! Чтобы зарегистрироваться на сервер Сочи, отправьте /start');
    return new Response('ok');
  }

  if (state.step === 'nick') {
    if (!/^[A-Za-z0-9_]{3,24}$/.test(text)) {
      await send(token, chatId, 'Ник должен быть 3–24 символа: латиница, цифры и _. Попробуйте ещё раз:');
      return new Response('ok');
    }
    state.nick = text; state.step = 'email';
    await kv.put(key, JSON.stringify(state), { expirationTtl: 3600 });
    await send(token, chatId, 'Отлично! Теперь введите вашу почту:');
    return new Response('ok');
  }

  if (state.step === 'email') {
    if (!/^\S+@\S+\.\S+$/.test(text) || text.length > 61) {
      await send(token, chatId, 'Похоже, это не почта. Введите в формате you@mail.ru:');
      return new Response('ok');
    }
    state.email = text; state.step = 'pass';
    await kv.put(key, JSON.stringify(state), { expirationTtl: 3600 });
    await send(token, chatId, 'Придумайте пароль (от 6 до 32 символов):');
    return new Response('ok');
  }

  if (state.step === 'pass') {
    if (text.length < 6 || text.length > 32) {
      await send(token, chatId, 'Пароль должен быть от 6 до 32 символов. Попробуйте ещё раз:');
      return new Response('ok');
    }
    await kv.delete(key);
    await send(token, chatId, `✅ Заявка принята! Ник <b>${state.nick}</b> передан администратору.\n\nОткрытие сервера Сочи: 5 ноября, 17:00 (МСК).`);
    await notifyOwner(env, state.nick, state.email, text);
    return new Response('ok');
  }

  return new Response('ok');
}
