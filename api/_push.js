// Notificações no celular/computador (Web Push), mesmo com o jogo fechado.
// Usa as chaves VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY (na Vercel). Sem elas, nada é enviado e o jogo segue normal.
// Os aparelhos de cada conta ficam em usuarios/<uid>/push/<id>, que só o servidor lê e grava.
const crypto = require('crypto');
const { ler, gravaVarios } = require('./_store');

const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const deB64u = s => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const MAX_APARELHOS = 6;
// só manda para os serviços de notificação conhecidos (Chrome/Android, Firefox, Edge, Safari/iPhone)
const HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

function chaves() {
  const pub = process.env.VAPID_PUBLIC_KEY, pri = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !pri) return null;
  const p = deB64u(pub), d = deB64u(pri);
  if (p.length !== 65 || p[0] !== 4 || d.length !== 32) return null;
  return { pub, p, d };
}
const ligado = () => !!chaves();
const chavePublica = () => { const k = chaves(); return k ? k.pub : null; };

// confere o que o navegador mandou ao ligar as notificações
function inscricaoOk(s) {
  if (!s || typeof s !== 'object' || typeof s.endpoint !== 'string' || s.endpoint.length > 1000) return null;
  let u; try { u = new URL(s.endpoint) } catch (e) { return null }
  if (u.protocol !== 'https:' || !HOSTS.some(h => h.test(u.hostname))) return null;
  const k = s.keys || {}, p256dh = deB64u(k.p256dh), auth = deB64u(k.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  return { endpoint: s.endpoint, p256dh: b64u(p256dh), auth: b64u(auth) };
}
const idDe = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 16);

async function guarda(uid, s) {
  const ok = inscricaoOk(s);
  if (!ok) throw Object.assign(new Error('Esse navegador não aceitou as notificações.'), { status: 400 });
  const atuais = (await ler('usuarios/' + uid + '/push')) || {}, id = idDe(ok.endpoint), mudas = {};
  const outros = Object.entries(atuais).filter(([k]) => k !== id).sort((a, b) => (b[1].quando || 0) - (a[1].quando || 0));
  outros.slice(MAX_APARELHOS - 1).forEach(([k]) => { mudas['usuarios/' + uid + '/push/' + k] = null }); // aparelhos mais antigos saem
  mudas['usuarios/' + uid + '/push/' + id] = Object.assign(ok, { quando: Date.now() });
  await gravaVarios(mudas);
  return id;
}
async function tira(uid, endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return;
  await gravaVarios({ ['usuarios/' + uid + '/push/' + idDe(endpoint)]: null });
}

// assinatura do servidor (VAPID, RFC 8292)
function vapid(endpoint, k) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const corpo = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' +
    b64u(JSON.stringify({ aud, exp: now + 12 * 3600, sub: 'https://arrisca-ai.vercel.app' }));
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64u(k.d), x: b64u(k.p.subarray(1, 33)), y: b64u(k.p.subarray(33, 65)) } });
  const sig = crypto.sign('sha256', Buffer.from(corpo), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + corpo + '.' + b64u(sig) + ', k=' + k.pub;
}
// criptografia da mensagem (aes128gcm, RFC 8291): só o aparelho de destino consegue ler
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
function cifra(texto, s) {
  const ua = deB64u(s.p256dh), auth = deB64u(s.auth);
  const eu = crypto.createECDH('prime256v1'); eu.generateKeys();
  const as = eu.getPublicKey(), seg = eu.computeSecret(ua), salt = crypto.randomBytes(16);
  const ikm = hmac(hmac(auth, seg), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([as.length]), as, ct]);
}

async function mandaUm(s, msg, k, ttl) {
  const r = await fetch(s.endpoint, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { authorization: vapid(s.endpoint, k), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(ttl), urgency: 'high' },
    body: cifra(JSON.stringify(msg), s)
  });
  return r.status;
}

// manda para todos os aparelhos da conta. msg: {titulo, corpo, url, tag}. Nunca derruba quem chamou.
async function avisa(uid, msg, ttl = 900) {
  const k = chaves(); if (!k) return 0;
  try {
    const lista = (await ler('usuarios/' + uid + '/push')) || {};
    let n = 0; const sai = {};
    await Promise.all(Object.entries(lista).map(async ([id, s]) => {
      try {
        const st = await mandaUm(s, msg, k, ttl);
        if (st === 404 || st === 410) sai['usuarios/' + uid + '/push/' + id] = null; // aparelho desinstalou ou desligou
        else if (st < 300) n++;
      } catch (e) { }
    }));
    if (Object.keys(sai).length) await gravaVarios(sai);
    return n;
  } catch (e) { return 0 }
}

module.exports = { ligado, chavePublica, guarda, tira, avisa, inscricaoOk, cifra, vapid, _b64u: b64u };
