/* STVX Portfolio — Cloudflare Pages Function for /api/contact → Telegram
   Secrets come from Cloudflare Pages environment variables:
     TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID                       */
'use strict';

const PROJECT_TYPES = ['تطوير مواقع', 'تصميم جرافيك', 'تصميم هوية بصرية', 'UI/UX', 'تصميم منشورات السوشيال ميديا', 'مشروع آخر'];
const BUDGETS = ['أقل من $100', '$100 - $300', '$300 - $500', '$500 - $1000', 'أكثر من $1000'];
const CONTACT_METHODS = ['البريد الإلكتروني', 'واتساب', 'تيليجرام'];

const MAX_NAME = 80;
const MAX_EMAIL = 120;
const MAX_PHONE = 30;
const MAX_DETAILS = 3000;
const MIN_DETAILS = 10;

const MAX_BODY = 20000;

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const rateBuckets = new Map();
const blocked = new Map();

function clientIp(request) {
  const fwd = request.headers.get('cf-connecting-ip');
  if (fwd) return fwd;
  const xfwd = request.headers.get('x-forwarded-for');
  if (xfwd) return String(xfwd).split(',')[0].trim();
  return 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const b = blocked.get(ip);
  if (b && now < b) return true;

  const bucket = rateBuckets.get(ip) || { count: 0, windowStart: now };
  if (now - bucket.windowStart > RATE_WINDOW_MS) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);

  if (bucket.count > RATE_LIMIT) {
    blocked.set(ip, now + RATE_WINDOW_MS);
    return true;
  }
  return false;
}

function clean(v, maxLen) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function validate(data) {
  const name = clean(data.name, MAX_NAME);
  const email = clean(data.email, MAX_EMAIL);
  const phone = clean(data.phone, MAX_PHONE);
  const projectType = clean(data.projectType, 80);
  const budget = clean(data.budget, 40);
  const contactMethod = clean(data.contactMethod, 40);
  const details = clean(data.details, MAX_DETAILS);

  if (!name) return { ok: false, error: 'الاسم مطلوب.' };
  if (name.length > MAX_NAME) return { ok: false, error: 'الاسم طويل جدًا.' };
  if (!email) return { ok: false, error: 'البريد الإلكتروني مطلوب.' };
  if (!isValidEmail(email)) return { ok: false, error: 'البريد الإلكتروني غير صحيح.' };
  if (email.length > MAX_EMAIL) return { ok: false, error: 'البريد الإلكتروني طويل جدًا.' };
  if (phone.length > MAX_PHONE) return { ok: false, error: 'رقم الهاتف طويل جدًا.' };
  if (!projectType) return { ok: false, error: 'نوع المشروع مطلوب.' };
  if (PROJECT_TYPES.indexOf(projectType) === -1) return { ok: false, error: 'نوع المشروع غير صحيح.' };
  if (budget && BUDGETS.indexOf(budget) === -1) return { ok: false, error: 'الميزانية غير صحيحة.' };
  if (contactMethod && CONTACT_METHODS.indexOf(contactMethod) === -1) return { ok: false, error: 'طريقة التواصل غير صحيحة.' };
  if (details.length < MIN_DETAILS) return { ok: false, error: 'تفاصيل المشروع قصيرة جدًا.' };
  if (details.length > MAX_DETAILS) return { ok: false, error: 'تفاصيل المشروع طويلة جدًا.' };

  return { ok: true, data: { name, email, phone, projectType, budget, contactMethod, details } };
}

function buildTelegramMessage(d) {
  return [
    '🚀 طلب مشروع جديد',
    '',
    `👤 الاسم: ${d.name}`,
    `📧 البريد: ${d.email}`,
    `📱 الهاتف: ${d.phone || 'غير مذكور'}`,
    `💼 نوع المشروع: ${d.projectType}`,
    `💰 الميزانية: ${d.budget || 'غير محددة'}`,
    `📞 طريقة التواصل: ${d.contactMethod || 'غير محددة'}`,
    '',
    '📝 تفاصيل المشروع:',
    d.details,
    '',
    '━━━━━━━━━━━━━━━━━━',
    '🌐 المصدر: STVX Portfolio'
  ].join('\n');
}

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }

  const ip = clientIp(request);
  if (isRateLimited(ip)) {
    return json(429, { ok: false, error: 'طلبات كثيرة جدًا، حاول لاحقًا.' });
  }

  const botToken = env.TELEGRAM_BOT_TOKEN || '';
  const chatId = env.TELEGRAM_CHAT_ID || '';

  if (!botToken || !chatId) {
    return json(500, { ok: false, error: 'الخدمة غير مهيأة بعد — أضف TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID في إعدادات المشروع على Cloudflare Pages.' });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY) {
    return json(413, { ok: false, error: 'الطلب كبير جدًا.' });
  }

  let raw;
  try {
    raw = await request.text();
  } catch (e) {
    return json(400, { ok: false, error: 'بيانات غير صحيحة.' });
  }
  if (raw.length > MAX_BODY) {
    return json(413, { ok: false, error: 'الطلب كبير جدًا.' });
  }

  let data;
  try {
    data = JSON.parse(raw || '{}');
  } catch (e) {
    return json(400, { ok: false, error: 'بيانات غير صحيحة.' });
  }

  const result = validate(data);
  if (!result.ok) {
    return json(400, { ok: false, error: result.error });
  }

  const message = buildTelegramMessage(result.data);

  try {
    const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true
      })
    });

    const telegramData = await telegramRes.json().catch(() => ({}));

    if (!telegramRes.ok || !telegramData.ok) {
      console.error('Telegram error:', telegramRes.status, JSON.stringify(telegramData));
      return json(502, { ok: false, error: 'تعذر إرسال الطلب، حاول مرة أخرى.' });
    }

    return json(200, { ok: true });
  } catch (e) {
    console.error('Telegram fetch error:', e.message);
    return json(502, { ok: false, error: 'تعذر إرسال الطلب، حاول مرة أخرى.' });
  }
}
