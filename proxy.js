#!/usr/bin/env node
// DeepSeek POW 本地代理
// 运行: node proxy.js
// 默认监听 http://localhost:8899
// 设置: DEEPSEEK_BASE_URL 环境变量指向你的 Cloudflare Worker

const http = require('http');
const https = require('https');

// ====== DeepSeekHashV1 POW Solver (Uint32Array optimized) ======
const RC = new Uint32Array([0,1,0,0x8082,0x80000000,0x808a,0x80000000,0x80008000,0,0x808b,0,0x80000001,0x80000000,0x80008081,0x80000000,0x8009,0,0x8a,0,0x88,0,0x80008009,0,0x8000000a,0,0x8000808b,0x80000000,0x8b,0x80000000,0x8089,0x80000000,0x8003,0x80000000,0x8002,0x80000000,0x80,0,0x800a,0x80000000,0x8000000a,0x80000000,0x80008081,0x80000000,0x8080,0,0x80000001,0x80000000,0x80008008]);
const RH = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const PIL = [10,7,11,17,18,3,5,16,8,21,24,4,15,23,19,13,12,2,20,14,22,9,6,1];
const ROT_STEPS = (() => { const r = new Uint8Array(24); let x = 1, y = 0; for (let t = 0; t < 24; t++) { r[t] = RH[x + 5 * y]; const ny = (2 * x + 3 * y) % 5; x = y; y = ny; } return r; })();
const _C = new Uint32Array(10), _D = new Uint32Array(10), _B = new Uint32Array(50);

function ROTL64(hi, lo, n) {
  if (n === 0) return [hi, lo];
  if (n < 32) { const c = lo >>> (32 - n), w = hi >>> (32 - n); return [((hi << n) | c) >>> 0, ((lo << n) | w) >>> 0]; }
  n -= 32; if (n === 0) return [lo, hi];
  const c = hi >>> (32 - n), w = lo >>> (32 - n);
  return [((lo << n) | c) >>> 0, ((hi << n) | w) >>> 0];
}

function keccakF_ds(s) {
  for (let r = 1; r < 24; r++) {
    for (let x = 0; x < 5; x++) {
      let chi = 0, clo = 0;
      for (let y = 0; y < 5; y++) { const i = (x + 5 * y) * 2; chi ^= s[i]; clo ^= s[i + 1]; }
      _C[x * 2] = chi; _C[x * 2 + 1] = clo;
    }
    for (let x = 0; x < 5; x++) {
      const prevI = ((x + 4) % 5) * 2, nextI = ((x + 1) % 5) * 2;
      const [rh, rl] = ROTL64(_C[nextI], _C[nextI + 1], 1);
      _D[x * 2] = _C[prevI] ^ rh; _D[x * 2 + 1] = _C[prevI + 1] ^ rl;
    }
    for (let x = 0; x < 5; x++) { const dh = _D[x * 2], dl = _D[x * 2 + 1]; for (let y = 0; y < 5; y++) { const i = (x + 5 * y) * 2; s[i] ^= dh; s[i + 1] ^= dl; } }
    let curHi = s[2], curLo = s[3];
    for (let t = 0; t < 24; t++) {
      const ti = PIL[t] * 2;
      const [rh, rl] = ROTL64(curHi, curLo, ROT_STEPS[t]);
      const oHi = s[ti], oLo = s[ti + 1]; s[ti] = rh; s[ti + 1] = rl; curHi = oHi; curLo = oLo;
    }
    for (let y = 0; y < 5; y++) {
      const y5 = y * 5;
      for (let x = 0; x < 5; x++) {
        const i = (x + y5) * 2, nx = ((x + 1) % 5 + y5) * 2, n2x = ((x + 2) % 5 + y5) * 2;
        _B[i] = s[i] ^ ((~s[nx]) & s[n2x]); _B[i + 1] = s[i + 1] ^ ((~s[nx + 1]) & s[n2x + 1]);
      }
    }
    s.set(_B); s[0] ^= RC[r * 2]; s[1] ^= RC[r * 2 + 1];
  }
}

function ab(s, bytes, off, len, bs) {
  bs = bs || 0;
  for (let j = 0; j < len; j++) {
    const b = bytes[off + j], pos = bs + j, wi = (pos >> 3) << 1, bi = pos & 7;
    if (bi < 4) s[wi + 1] ^= b << (bi * 8);
    else s[wi] ^= b << ((bi - 4) * 8);
  }
}

const _targetBuf = new Uint8Array(32);
function setTarget(hex) { for (let i = 0; i < 32; i++) _targetBuf[i] = (hex.charCodeAt(i * 2) - 48 - (hex.charCodeAt(i * 2) > 57 ? 39 : 0)) * 16 + (hex.charCodeAt(i * 2 + 1) - 48 - (hex.charCodeAt(i * 2 + 1) > 57 ? 39 : 0)); }
function matchHash(s) { for (let j = 0; j < 32; j++) { const wi = (j >> 3) << 1, bi = j & 7, byte = bi < 4 ? (s[wi + 1] >>> (bi * 8)) & 0xFF : (s[wi] >>> ((bi - 4) * 8)) & 0xFF; if (byte !== _targetBuf[j]) return false; } return true; }

function solvePow(ch) {
  const enc = new TextEncoder();
  const pfx = enc.encode(ch.salt + '_' + ch.expire_at + '_');
  setTarget(ch.challenge.toLowerCase());
  const base = new Uint32Array(50);
  let pos = 0;
  while (pos + 136 <= pfx.length) { ab(base, pfx, pos, 136); keccakF_ds(base); pos += 136; }
  const rem = pfx.length - pos;
  const nc = []; for (let i = 0; i < 10; i++) nc[i] = enc.encode(String(i));
  const s = new Uint32Array(50), bc = new Uint32Array(50); bc.set(base);
  const RLH = ((135 >> 3) << 1), RLB = 135 & 7;
  for (let n = 0; n <= ch.difficulty; n++) {
    s.set(bc); if (rem > 0) ab(s, pfx, pos, rem);
    const ns = n < 10 ? nc[n] : enc.encode(String(n));
    ab(s, ns, 0, ns.length, rem);
    let p = rem + ns.length, phi = (p >> 3) << 1, plo = phi + 1, pbi = p & 7;
    if (pbi < 4) s[plo] ^= 0x06 << (pbi * 8); else s[phi] ^= 0x06 << ((pbi - 4) * 8);
    if (RLB < 4) s[RLH + 1] ^= 0x80 << (RLB * 8); else s[RLH] ^= 0x80 << ((RLB - 4) * 8);
    keccakF_ds(s);
    if (matchHash(s)) return n;
  }
  return -1;
}

// ====== 代理核心 ======
const UPSTREAM = (process.env.DEEPSEEK_BASE_URL || 'https://deepseek-cf-worker.pages.dev').trim().replace(/\/+$/, '');
const PORT = parseInt(process.env.PORT || '8899', 10);

// POW 答案缓存（5 分钟内有效）
const powCache = new Map();

async function fetchWithRetry(url, options, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function getPowHeader() {
  // Try cached first
  const now = Date.now();
  for (const [key, val] of powCache) {
    if (val.expireAt > now) return val.header;
    powCache.delete(key);
  }

  // Get challenge
  const resp = await fetchWithRetry(UPSTREAM + '/v1/pow-challenge');
  if (!resp.ok) throw new Error('Failed to get POW challenge: ' + resp.status);
  const ch = await resp.json();
  if (ch.error) throw new Error('POW challenge error: ' + ch.error);

  const start = Date.now();
  const answer = solvePow(ch);
  const elapsed = Date.now() - start;
  console.log(`[POW] Solved in ${elapsed}ms, nonce=${answer}`);

  if (answer < 0) throw new Error('POW solver failed');

  const powAnswer = {
    algorithm: ch.algorithm,
    challenge: ch.challenge,
    salt: ch.salt,
    answer: answer,
    signature: ch.signature,
    target_path: '/api/v0/chat/completion'
  };
  const powB64 = Buffer.from(JSON.stringify(powAnswer)).toString('base64');

  // Cache for 4 minutes
  powCache.set(powB64, { header: powB64, expireAt: now + 240000 });

  return powB64;
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // /v1/chat/completions — inject POW
  if (req.url.startsWith('/v1/chat/completions')) {
    try {
      // Read body
      const bodyChunks = [];
      for await (const chunk of req) bodyChunks.push(chunk);
      const body = JSON.parse(Buffer.concat(bodyChunks).toString());

      // Get POW header
      const powB64 = await getPowHeader();

      // Forward to upstream
      const upstreamHeaders = {
        'Content-Type': 'application/json',
        'x-ds-pow-response': powB64
      };
      // Copy auth if present
      if (req.headers.authorization) upstreamHeaders['Authorization'] = req.headers.authorization;

      const upstreamResp = await fetchWithRetry(UPSTREAM + '/v1/chat/completions', {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(body)
      });

      // Stream response
      res.writeHead(upstreamResp.status, {
        'Content-Type': upstreamResp.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-cache'
      });

      if (upstreamResp.body) {
        const reader = upstreamResp.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      res.end();
      console.log(`[${new Date().toISOString()}] POST /v1/chat/completions → ${upstreamResp.status}`);
    } catch (e) {
      console.error('Error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: e.message, type: 'proxy_error' } }));
    }
    return;
  }

  // All other requests — transparent proxy
  try {
    const targetUrl = UPSTREAM + req.url;
    const upstreamHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k !== 'host' && k !== 'connection') upstreamHeaders[k] = v;
    }

    let body = null;
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }

    const upstreamResp = await fetchWithRetry(targetUrl, {
      method: req.method,
      headers: upstreamHeaders,
      body: body
    });

    const ct = upstreamResp.headers.get('Content-Type') || 'text/plain';
    res.writeHead(upstreamResp.status, { 'Content-Type': ct });
    const respBody = await upstreamResp.arrayBuffer();
    res.end(Buffer.from(respBody));

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} → ${upstreamResp.status}`);
  } catch (e) {
    console.error('Error:', e.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: e.message, type: 'proxy_error' } }));
  }
});

server.listen(PORT, () => {
  console.log(`DeepSeek POW Proxy running on http://localhost:${PORT}`);
  console.log(`Upstream: ${UPSTREAM}`);
  console.log('');
  console.log('Trae 配置:');
  console.log(`  API 地址: http://localhost:${PORT}/v1`);
  console.log('  API Key:  sk-any');
  console.log('  模型:    deepseek-v4-flash');
});
