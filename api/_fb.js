// Acesso ao Firebase Realtime Database com a conta de serviço (FIREBASE_SERVICE_ACCOUNT, na Vercel).
// Arquivo com "_" no começo: a Vercel não publica como rota, só serve para as outras funções usarem.
const crypto = require('crypto');
const DB = process.env.FIREBASE_DB_URL || 'https://arrisca-ai-default-rtdb.firebaseio.com';

const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
let CRED = null, TOKEN = null, TOKEN_EXP = 0;
function cred() {
  if (!CRED) {
    const s = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!s) throw Object.assign(new Error('Falta configurar FIREBASE_SERVICE_ACCOUNT na Vercel.'), { status: 503 });
    CRED = JSON.parse(s);
  }
  return CRED;
}
async function token() {
  if (TOKEN && Date.now() < TOKEN_EXP - 120000) return TOKEN;
  const c = cred(), now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({
    iss: c.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'
  }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(c.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + body + '.' + b64u(sig)
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Não consegui autenticar no Firebase.');
  TOKEN = j.access_token; TOKEN_EXP = Date.now() + (j.expires_in || 3600) * 1000;
  return TOKEN;
}
async function dbGet(path, admin = true) {
  const url = DB + '/' + path + '.json' + (admin ? '?access_token=' + encodeURIComponent(await token()) : '');
  const r = await fetch(url);
  if (!r.ok) throw new Error('Firebase respondeu ' + r.status);
  return r.json();
}
async function dbReq(method, path, body) {
  const url = DB + '/' + path + '.json?access_token=' + encodeURIComponent(await token());
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error('Firebase respondeu ' + r.status);
  return r.json();
}
module.exports = { DB, cred, token, dbGet, dbReq };
