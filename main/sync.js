// 局域网同步服务端：PC 即同步中枢，words.db 就是服务端库。
// - 手机端（浏览器/Capacitor）通过 /api/sync 做「push 自己的变更 + pull 增量」一次往返
// - /app/ 托管 mobile/www 静态页：手机扫码即用，无需安装
// - 鉴权：配对 token（首次启用自动生成），仅局域网可达，不暴露公网
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const ecdict = require('./ecdict');
const translate = require('./translate');
const vocab = require('./vocabtest');
const { buildEnDefinition } = require('./en-def');

let server = null;
const devices = new Map(); // deviceId -> { name, lastSyncAt, lastIp }（内存态，重启清零，仅供状态展示）

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const MAX_BODY = 32 * 1024 * 1024; // 首次全量同步的富余上限
const STATIC_ROOT = path.join(__dirname, '..', 'mobile', 'www');

function ensureToken() {
  const cfg = config.load();
  if (!cfg.sync) cfg.sync = {};
  if (!cfg.sync.token) {
    config.update({ sync: { token: crypto.randomBytes(16).toString('hex') } });
  }
  return config.load().sync.token;
}

/** 局域网 IPv4：优先 192.168（家庭 Wi-Fi），其次 10.x，再次 172.16-31 */
function lanIP() {
  const cands = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      const score = i.address.startsWith('192.168.') ? 3 : i.address.startsWith('10.') ? 2
        : /^172\.(1[6-9]|2\d|3[01])\./.test(i.address) ? 1 : 0;
      cands.push({ addr: i.address, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands.length ? cands[0].addr : null;
}

function tokenOk(req) {
  const token = req.headers['x-sync-token'] || '';
  const expected = config.load().sync?.token || '';
  return expected.length > 0 && token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

/** 手机端查词（与 PC lookupWord 同源词典/释义逻辑，但不入库） */
async function lookupForMobile(rawWord) {
  const word = String(rawWord || '').trim().toLowerCase();
  const payload = {
    word, found: false,
    phonetic: '', defs: [], tags: [], collins: 0, oxford: 0,
    enDefinition: null, vocabLevel: null, wordLevel: null,
    simpleDef: null, translated: null,
  };
  if (!word) return payload;

  const dict = ecdict.lookup(word);
  if (dict) {
    payload.found = true;
    payload.phonetic = dict.phonetic;
    payload.defs = ecdict.parseTranslation(dict.translation);
    payload.tags = dict.tags;
    payload.collins = dict.collins;
    payload.oxford = dict.oxford;
    const en = buildEnDefinition(dict);
    if (en) {
      payload.enDefinition = { senses: en.senses, hard: en.hard, hints: en.hints };
      payload.vocabLevel = en.vocabLevel;
      payload.wordLevel = vocab.wordLevel(dict.bnc, en.vocabLevel.score);
    }
  }

  // LLM 简单英语释义（PC 已配置 LLM 且测过词汇量时；理念：用简单英语理解英语）
  if (!payload.simpleDef) {
    const cfg = config.load();
    if (cfg.vocabLevel && cfg.vocabLevel.score && cfg.provider === 'llm' && cfg.providers.llm?.apiKey) {
      try {
        const sd = await translate.simpleDefinition(word);
        if (sd) payload.simpleDef = sd.simpleDef;
      } catch { /* 简单释义失败不阻塞查词 */ }
    }
  }

  // 词典未收录 → 在线翻译兜底
  if (!dict) {
    try {
      const r = await translate.translateSentence(word);
      if (r.translation) {
        payload.found = true;
        payload.translated = r.translation;
        payload.defs = [{ pos: '', def: r.translation }];
      }
    } catch { /* 离线/网络失败如实返回未找到 */ }
  }
  return payload;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** 静态文件：路径规范化防目录穿越；未命中回退 index.html（移动端为单页应用） */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.replace(/^\/app\/?/, ''));
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(STATIC_ROOT, rel));
  if (!file.startsWith(STATIC_ROOT)) { json(res, 403, { error: 'forbidden' }); return; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.join(STATIC_ROOT, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('mobile app not found'); return; }
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // 与 renderer 同约定：样式/脚本全部外链，禁内联；connect-src 放行同源（同步 API）+ MyMemory（手机端离线词典未命中时的直连在线翻译兜底）
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; connect-src 'self' https://api.mymemory.translated.net",
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function handleApi(req, res, url) {
  if (!tokenOk(req)) return json(res, 401, { error: '未配对或 token 错误' });

  if (url.pathname === '/api/ping' && req.method === 'GET') {
    return json(res, 200, { ok: true, app: 'readpicks', total: db.stats(), due: db.dueCount() });
  }

  // 手机查词：复用 PC 的本地词典 + 按词汇水平的英英释义 + LLM 简单释义/在线翻译兜底。
  // 只读不出题：不在 PC 生词本入库（手机本地 recordLookup 后经同步回流）
  if (url.pathname === '/api/lookup' && req.method === 'POST') {
    const body = await readBody(req);
    return json(res, 200, await lookupForMobile(String(body.word || '')));
  }

  if (url.pathname === '/api/sync' && req.method === 'POST') {
    const body = await readBody(req);
    const dev = body.device || {};
    if (dev.id) devices.set(dev.id, { name: dev.name || '未命名设备', lastSyncAt: Date.now(), lastIp: req.socket.remoteAddress });
    // 1) push 落地（LWW / uuid 并集 / 计数推导，事务原子）
    const applied = db.applySyncBatch({ words: body.words || [], queries: body.queries || [] });
    // 2) 同一响应里带回 pull 增量：游标用「>=」+ 幂等合并，重复收发无副作用
    // serverTime 必须在读增量之前取：读之后再落库的行 srv_at > serverTime，下轮必被拉到（防漏）
    const serverTime = Date.now();
    const cw = Number(body.cursors?.words) || 0;
    const cq = Number(body.cursors?.queries) || 0;
    const words = db.getWordsSince(cw);
    const queries = db.getQueriesSince(cq);
    return json(res, 200, {
      ok: true,
      applied,
      words,
      queries,
      serverTime,
    });
  }

  return json(res, 404, { error: 'not found' });
}

function start() {
  if (server) return status();
  const token = ensureToken();
  const port = Number(config.load().sync?.port) || 9723;
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (url.pathname.startsWith('/api/')) {
        handleApi(req, res, url).catch((e) => {
          console.error('[sync] API 错误:', e.message);
          if (!res.headersSent) json(res, 500, { error: e.message });
        });
      } else if (url.pathname === '/' || url.pathname.startsWith('/app')) {
        if (url.pathname === '/') {
          res.writeHead(302, { Location: '/app/' });
          res.end();
        } else {
          serveStatic(req, res, url.pathname);
        }
      } else {
        json(res, 404, { error: 'not found' });
      }
    } catch (e) {
      console.error('[sync] 请求处理失败:', e);
      if (!res.headersDestroyed) json(res, 500, { error: e.message });
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      console.log('[sync] 局域网同步已启动:', status().url, 'token=' + token.slice(0, 6) + '…');
      resolve(status());
    });
    server.on('error', (e) => {
      console.error('[sync] 启动失败:', e.message);
      server = null;
      resolve({ running: false, error: e.message });
    });
  });
}

function stop() {
  if (!server) return;
  server.close();
  server = null;
  console.log('[sync] 局域网同步已停止');
}

function status() {
  const cfg = config.load().sync || {};
  const running = !!server;
  const port = running ? server.address().port : (Number(cfg.port) || 9723);
  const ip = lanIP();
  return {
    running,
    ip,
    port,
    enabled: !!cfg.enabled,
    token: cfg.token || '',
    url: running && ip ? `http://${ip}:${port}/app/` : null,
    pairUrl: ip && cfg.token ? `http://${ip}:${port}/app/?t=${cfg.token}` : null,
    devices: [...devices.entries()].map(([id, d]) => ({ id, ...d })),
  };
}

/** 配对二维码：SVG 字符串（qrcode-generator 纯属性输出，符合 CSP） */
function pairQR() {
  const st = status();
  if (!st.pairUrl) return { svg: null, url: null };
  const qr = require('qrcode-generator')(0, 'M');
  qr.addData(st.pairUrl);
  qr.make();
  return { svg: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }), url: st.pairUrl };
}

module.exports = { start, stop, status, pairQR, ensureToken, lanIP, lookupForMobile };
