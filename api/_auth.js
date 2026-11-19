// Confere o token de login do Firebase (ID token) que o site manda em "Authorization: Bearer ...".
// O token é assinado pelo Google; aqui a assinatura é verificada com as chaves públicas dele,
// então ninguém consegue se passar por outra conta.
const crypto = require('crypto');

const PROJETO = process.env.FIREBASE_PROJECT_ID || 'arrisca-ai';
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const DEV = !!process.env.ARRISCA_DEV_SALAS; // testes locais: aceita os tokens do simulador

// Contas que podem abrir o painel (bugs e perguntas reportadas).
const ADMINS = new Set([]);

let CERTS = null, CERTS_EXP = 0;
async function certs() {
  if (CERTS && Date.now() < CERTS_EXP) return CERTS;
  const r = await fetch(CERTS_URL);
  if (!r.ok) throw Object.assign(new Error('Não consegui conferir o login agora.'), { status: 503 });
  const idade = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  CERTS = await r.json();
  CERTS_EXP = Date.now() + (idade ? +idade[1] * 1000 : 3600000);
  return CERTS;
}

const b64json = s => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
const erro = m => Object.assign(new Error(m), { status: 401 });

async function verifica(token) {
  if (DEV && /^local\./.test(token)) {
    const u = b64json(token.slice(6));
    if (!u || !u.uid) throw erro('Login inválido.');
    return { uid: String(u.uid), email: u.email || '', verificado: true, nome: u.nome || '', provedor: u.provedor || 'password' };
  }
  const partes = String(token || '').split('.');
  if (partes.length !== 3) throw erro('Login inválido.');
  let cab, dados;
  try { cab = b64json(partes[0]); dados = b64json(partes[1]) } catch (e) { throw erro('Login inválido.') }
  if (cab.alg !== 'RS256' || !cab.kid) throw erro('Login inválido.');
  const pem = (await certs())[cab.kid];
  if (!pem) throw erro('Login vencido. Entre de novo.');
  const ok = crypto.createVerify('RSA-SHA256').update(partes[0] + '.' + partes[1])
    .verify(new crypto.X509Certificate(pem).publicKey, Buffer.from(partes[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  if (!ok) throw erro('Login inválido.');
  const agora = Math.floor(Date.now() / 1000);
  if (dados.aud !== PROJETO || dados.iss !== 'https://securetoken.google.com/' + PROJETO) throw erro('Login inválido.');
  if (!dados.sub || typeof dados.sub !== 'string' || dados.sub.length > 128) throw erro('Login inválido.');
  if (!(dados.exp > agora - 30) || !(dados.iat < agora + 300)) throw erro('Login vencido. Entre de novo.');
  const fb = dados.firebase || {};
  return {
    uid: dados.sub,
    email: dados.email || '',
    verificado: !!dados.email_verified,
    nome: dados.name || '',
    provedor: fb.sign_in_provider || ''
  };
}

async function quemE(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw erro('Entre na sua conta.');
  const u = await verifica(m[1].trim());
  if (u.provedor === 'anonymous') throw erro('Entre na sua conta.');
  return u;
}

const ehAdmin = u => !!u && (ADMINS.has(u.uid) || (DEV && u.uid === 'loc-admin'));

module.exports = { verifica, quemE, ehAdmin };
