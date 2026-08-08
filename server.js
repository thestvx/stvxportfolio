/* STVX Portfolio — local server + /api/contact → Telegram */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

/* ---------- .env loader (no dependencies) ---------- */
function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    raw.split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) {
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        process.env[m[1]] = val;
      }
    });
  } catch (e) {
    /* .env optional — env vars may be set in the shell */
  }
}
loadEnv();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

/* ---------- validation constants ---------- */
const PROJECT_TYPES = ['تطوير مواقع', 'تصميم جرافيك', 'تصميم هوية بصرية', 'UI/UX', 'تصميم منشورات السوشيال ميديا', 'مشروع آخر'];
const BUDGETS = ['أقل من $100', '$100 - $300', '$300 - $500', '$500 - $1000', 'أكثر من $1000'];
const CONTACT_METHODS = ['البريد الإلكتروني', 'واتساب', 'تيليجرام'];

const MAX_NAME = 80;
const MAX_EMAIL = 120;
const MAX_PHONE = 30;
const MAX_DETAILS = 3000;
const MIN_DETAILS = 10;

/* ---------- spam + rate limiting ---------- */
const rateBuckets = new Map();
const RATE_LIMIT = 5; /* max requests */
const RATE_WINDOW_MS = 10 * 60 * 1000; /* per 10 min per IP */
const BLOCKED_IPS = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const blocked = BLOCKED_IPS.get(ip);
  if (blocked && Date.now() < blocked) return true;

  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, windowStart: now };
  if (now - bucket.windowStart > RATE_WINDOW_MS) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);

  if (bucket.count > RATE_LIMIT) {
    BLOCKED_IPS.set(ip, now + RATE_WINDOW_MS);
    return true;
  }
  return false;
}

/* ---------- sanitize ---------- */
function clean(v, maxLen) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLen);
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

/* ---------- Telegram message ---------- */
function buildTelegramMessage(d) {
  const lines = [
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
  ];
  return lines.join('\n');
}

/* ---------- helpers ---------- */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname;
  if (filePath === '/' || filePath === '') filePath = '/index.html';

  const full = path.normalize(path.join(ROOT, filePath));
  if (!full.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    });
    fs.createReadStream(full).pipe(res);
  });
}

/* ---------- request body ---------- */
function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ---------- API handler ---------- */
async function handleContact(req, res) {
  const ip = clientIp(req);

  if (isRateLimited(ip)) {
    sendJson(res, 429, { ok: false, error: 'طلبات كثيرة جدًا، حاول لاحقًا.' });
    return;
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    sendJson(res, 500, { ok: false, error: 'الخدمة غير مهيأة بعد — أضف TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID في ملف .env' });
    return;
  }

  let body;
  try {
    body = await readBody(req, 20000);
  } catch (e) {
    sendJson(res, 413, { ok: false, error: 'الطلب كبير جدًا.' });
    return;
  }

  let data;
  try {
    data = JSON.parse(body || '{}');
  } catch (e) {
    sendJson(res, 400, { ok: false, error: 'بيانات غير صحيحة.' });
    return;
  }

  const result = validate(data);
  if (!result.ok) {
    sendJson(res, 400, { ok: false, error: result.error });
    return;
  }

  const message = buildTelegramMessage(result.data);

  try {
    const telegramRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        disable_web_page_preview: true
      })
    });

    const telegramData = await telegramRes.json().catch(() => ({}));

    if (!telegramRes.ok || !telegramData.ok) {
      console.error('Telegram error:', telegramRes.status, JSON.stringify(telegramData));
      sendJson(res, 502, { ok: false, error: 'تعذر إرسال الطلب، حاول مرة أخرى.' });
      return;
    }

    sendJson(res, 200, { ok: true });
  } catch (e) {
    console.error('Telegram fetch error:', e.message);
    sendJson(res, 502, { ok: false, error: 'تعذر إرسال الطلب، حاول مرة أخرى.' });
  }
}

/* ---------- HTTP server ---------- */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(u.pathname);

  if (req.method === 'POST' && pathname === '/api/contact') {
    handleContact(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────┐');
  console.log('  │   STVX Portfolio                             │');
  console.log(`  │   http://localhost:${PORT}                      │`);
  console.log('  └──────────────────────────────────────────────┘');
  console.log('');
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('  ⚠  Telegram not configured — create .env with:');
    console.log('     TELEGRAM_BOT_TOKEN=your_bot_token');
    console.log('     TELEGRAM_CHAT_ID=your_chat_id');
  } else {
    console.log('  ✓  Telegram bot configured');
  }
  console.log('');
});
