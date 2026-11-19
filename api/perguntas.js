// Servidor de perguntas do Arrisca Aí (função da Vercel).
// As perguntas ficam no Firebase Realtime Database, em /banco (fechado para o público).
// Só esta função consegue ler, usando a conta de serviço em FIREBASE_SERVICE_ACCOUNT.
//
//   GET  /api/perguntas?acao=meta       quantas perguntas há por tema e nível
//   POST /api/perguntas?acao=sortear    sorteia uma pergunta (sem a resposta)
//   POST /api/perguntas?acao=resposta   devolve a resposta, só depois que a pessoa respondeu
//   POST /api/perguntas?acao=dica       dica (primeira letra e tamanho, ou uma alternativa errada)
const crypto = require('crypto');

const DB = process.env.FIREBASE_DB_URL || 'https://arrisca-ai-default-rtdb.firebaseio.com';
const ORDER = ['M', 'H', 'AL', 'MU', 'CS', 'S', 'CT', 'TI', 'ES', 'GG', 'V'];
const LEVELS = { 1: 'fácil', 2: 'médio', 3: 'difícil', 4: 'impossível' };
const TEMA_N = { M: 'Mundo', H: 'História', AL: 'Artes e Literatura', MU: 'Música', CS: 'Cinema e Séries', S: 'Sociedade', CT: 'Ciência', TI: 'Tecnologia e Internet', ES: 'Esporte', GG: 'Games e Geek', V: 'Variedades' };

// ---------------------------------------------------------------- credencial e token do Google
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
function chaveTk() { // chave para assinar os tokens de pergunta (derivada da credencial)
  if (process.env.ARRISCA_DEV_KEY) return process.env.ARRISCA_DEV_KEY;
  return crypto.createHash('sha256').update(cred().private_key + '|arrisca-tk').digest('hex');
}

// ---------------------------------------------------------------- banco em memória
function cyrb53(str, seed = 0) { let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed; for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677) } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return 4294967296 * (2097151 & h2) + (h1 >>> 0) }
const qid = (t, q) => cyrb53(t === 'V' ? t + '|' + q[0] + '|' + q[1][q[2]] : t + '|' + q[0]).toString(36);
const bucketOf = (t, q) => (t === 'V' ? q[3] : q[2]) || 'geral';
const qDiff = (t, q) => (t === 'V' ? q[4] : q[3]) || 2;
const resposta = (t, q) => t === 'V' ? q[1][q[2]] : q[1];

let BANCO = null, BANCO_V = null, CHECADO = 0, CARREGANDO = null;
function arr(x) { return Array.isArray(x) ? x : x && typeof x === 'object' ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]) : [] }
function monta(raw, versao) {
  const B = { v: versao || 'x', temas: {} };
  ORDER.forEach(t => {
    const items = arr(raw && raw[t]).map(q => { q = arr(q); if (t === 'V') q[1] = arr(q[1]); return q });
    const ids = items.map(q => qid(t, q)), idx = new Map(ids.map((id, i) => [id, i]));
    const lv = [0, 0, 0, 0, 0]; items.forEach(q => lv[qDiff(t, q)]++);
    B.temas[t] = { items, ids, idx, lv, info: new Map() };
  });
  return B;
}
async function banco() {
  if (process.env.BANCO_ARQUIVO) { // testes locais
    if (!BANCO) BANCO = monta(JSON.parse(require('fs').readFileSync(process.env.BANCO_ARQUIVO, 'utf8')), 'local');
    return BANCO;
  }
  if (BANCO && Date.now() - CHECADO < 5 * 60 * 1000) return BANCO;
  if (CARREGANDO) return CARREGANDO;
  CARREGANDO = (async () => {
    try {
      const v = await dbGet('banco/versao');
      if (!v) throw Object.assign(new Error('O banco de perguntas ainda está vazio.'), { status: 503 });
      CHECADO = Date.now();
      if (!BANCO || v !== BANCO_V) { BANCO = monta(await dbGet('banco/perguntas'), v); BANCO_V = v }
      return BANCO;
    } finally { CARREGANDO = null }
  })();
  return CARREGANDO;
}

// ---------------------------------------------------------------- sorteio (igual ao que o jogo fazia no aparelho)
const nrm = x => ' ' + String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
const STOPK = new Set(['sim', 'nao', 'verdadeiro', 'falso', 'nenhum', 'nenhuma', 'todos', 'todas', 'ambos', 'zero', 'agua', 'terra', 'fogo', 'ar']);
function qInfo(B, t, i) {
  const T = B.temas[t]; let o = T.info.get(i); if (o) return o;
  const q = T.items[i], a = String(resposta(t, q));
  const keys = new Set(), add = x => { x = nrm(x).trim().replace(/^(o|a|os|as|um|uma) /, ''); if (x.length >= 4 && !STOPK.has(x) || /^\d{3,}$/.test(x)) keys.add(' ' + x + ' ') };
  add(a.replace(/\(.*?\)/g, ' ')); (a.match(/\((.*?)\)/g) || []).forEach(x => add(x.slice(1, -1)));
  a.replace(/\(.*?\)/g, ' ').split(/[;,\/]| e | ou | and /).forEach(add);
  o = { txt: nrm(q[0]), keys: [...keys] }; T.info.set(i, o); return o;
}
function leaks(B, t, i, vistas) {
  const me = qInfo(B, t, i);
  for (const [st, sid] of vistas) {
    const T = B.temas[st]; const j = T && T.idx.get(sid); if (j === undefined) continue;
    const o = qInfo(B, st, j);
    if (me.keys.some(k => o.txt.includes(k) || o.keys.includes(k)) || o.keys.some(k => me.txt.includes(k))) return true;
  }
  return false;
}
const rnd = n => crypto.randomInt(n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]] } return a }
function sortear(B, t, nivel, usadas, vistas) {
  const T = B.temas[t], all = T.items, ids = T.ids, used = new Set(usadas), byLv = { 1: [], 2: [], 3: [], 4: [] };
  for (let i = 0; i < all.length; i++) if (!used.has(ids[i])) byLv[qDiff(t, all[i])].push(i);
  const lv = String(nivel || 'misto');
  let order;
  if (lv === 'misto') order = shuffle([1, 2, 3, 4]);
  else { const w = +lv; order = [w, w + 1, w - 1, w + 2, w - 2, w + 3, w - 3].filter(l => l >= 1 && l <= 4) }
  order = order.filter(l => byLv[l].length);
  if (!order.length) return null; // acabou o tema
  const tryPool = pool => {
    const groups = new Map();
    pool.forEach(i => { const b = bucketOf(t, all[i]); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(i) });
    const gs = [...groups.values()];
    while (gs.length) {
      const w = gs.map(a => Math.sqrt(a.length)), tot = w.reduce((x, y) => x + y, 0);
      let r = rnd(1e9) / 1e9 * tot, k = 0;
      while (k < gs.length - 1 && r >= w[k]) { r -= w[k]; k++ }
      const list = gs[k].slice();
      while (list.length) { const j = rnd(list.length), i = list[j]; if (!leaks(B, t, i, vistas)) return i; list.splice(j, 1) }
      gs.splice(k, 1);
    }
    return -1;
  };
  let pick = -1, usedLv = 0;
  for (const l of order) { pick = tryPool(byLv[l]); if (pick >= 0) { usedLv = l; break } }
  if (pick < 0) { const pool = byLv[order[0]]; pick = pool[rnd(pool.length)]; usedLv = order[0] }
  const lvNote = lv !== 'misto' && usedLv !== +lv ? `Acabaram as perguntas de nível ${LEVELS[+lv]} de ${TEMA_N[t]} que podiam cair agora; esta é de nível ${LEVELS[usedLv]}.` : '';
  return { i: pick, lvNote };
}

// ---------------------------------------------------------------- token da pergunta (quem sorteou, em que sala)
function assina(obj) { const p = b64u(JSON.stringify(obj)); return p + '.' + b64u(crypto.createHmac('sha256', chaveTk()).update(p).digest()) }
function confere(tk) {
  const [p, s] = String(tk || '').split('.');
  if (!p || !s) return null;
  const ok = b64u(crypto.createHmac('sha256', chaveTk()).update(p).digest());
  if (ok.length !== s.length || !crypto.timingSafeEqual(Buffer.from(ok), Buffer.from(s))) return null;
  try { return JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()) } catch (e) { return null }
}
// Na sala online, a resposta só sai depois que quem está na vez respondeu (isso fica gravado no estado da sala).
async function salaLiberou(sala, id) {
  if (process.env.ARRISCA_DEV_SALAS) return true; // testes locais (simulador de sala no navegador)
  if (!/^[A-Z0-9]{4,6}$/.test(sala || '')) return false;
  const e = await dbGet('salas/' + sala + '/estado', false).catch(() => dbGet('salas/' + sala + '/estado'));
  if (!e || !e.g) return false;
  let g; try { g = JSON.parse(e.g) } catch (x) { return false }
  if (g.qid !== id) return false;
  return !!(g.resp || (g.chosen !== null && g.chosen !== undefined) || g.phase === 'result' || g.phase === 'won');
}
function mascara(a) {
  let m = String(a).replace(/\(.*?\)/g, ' ').split(/[;\/]/)[0].replace(/\s+/g, ' ').trim();
  if (!m) m = String(a).trim();
  let first = true, n = 0, out = '';
  for (const ch of m) {
    if (/[0-9A-Za-zÀ-ÖØ-öø-ÿ]/.test(ch)) { n++; if (first) { out += ch.toUpperCase(); first = false } else out += '_' }
    else if (ch === ' ') out += '   ';
    else out += ch;
  }
  const words = m.split(' ').filter(w => /[0-9A-Za-zÀ-ÖØ-öø-ÿ]/.test(w)).length;
  return { mask: out, n, words };
}

// ---------------------------------------------------------------- rotas
async function handle(acao, body) {
  const B = await banco();
  if (acao === 'meta') {
    const n = {}, lv = {};
    ORDER.forEach(t => { n[t] = B.temas[t].items.length; lv[t] = B.temas[t].lv });
    return { v: B.v, n, lv };
  }
  const t = body.t;
  if (!B.temas[t]) throw Object.assign(new Error('Tema inválido'), { status: 400 });
  if (acao === 'sortear') {
    const usadas = Array.isArray(body.usadas) ? body.usadas.slice(0, 30000).map(String) : [];
    const vistas = Array.isArray(body.vistas) ? body.vistas.slice(-200).filter(x => Array.isArray(x) && x.length === 2).map(x => [String(x[0]), String(x[1])]) : [];
    const r = sortear(B, t, body.nivel, usadas, vistas);
    if (!r) return { esgotado: true };
    const q = B.temas[t].items[r.i], id = B.temas[t].ids[r.i];
    const sala = body.sala && /^[A-Z0-9]{4,6}$/.test(body.sala) ? body.sala : null;
    const out = { id, q: q[0], b: bucketOf(t, q), d: qDiff(t, q), lvNote: r.lvNote, tk: assina({ i: id, t, m: sala ? 'o' : 'l', s: sala, e: Date.now() + 864e5 }) };
    if (t === 'V') out.opts = shuffle(q[1].slice());
    return out;
  }
  const tk = confere(body.tk);
  if (!tk || tk.i !== body.id || tk.t !== t || tk.e < Date.now()) throw Object.assign(new Error('Pergunta inválida'), { status: 403 });
  const i = B.temas[t].idx.get(tk.i);
  if (i === undefined) throw Object.assign(new Error('Essa pergunta mudou. Sorteie outra.'), { status: 410 });
  const q = B.temas[t].items[i];
  if (acao === 'resposta') {
    if (tk.m === 'o' && !(await salaLiberou(tk.s, tk.i))) throw Object.assign(new Error('A resposta só aparece depois que a pessoa responde.'), { status: 403 });
    return { a: resposta(t, q) };
  }
  if (acao === 'dica') {
    if (t === 'V') { const erradas = q[1].filter((_, j) => j !== q[2]); return { elim: erradas[rnd(erradas.length)] } }
    return mascara(q[1]);
  }
  throw Object.assign(new Error('Ação inválida'), { status: 400 });
}

module.exports = async (req, res) => {
  const acao = (req.query && req.query.acao) || '';
  try {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch (e) { body = {} } }
    const out = await handle(acao, body);
    res.setHeader('Cache-Control', acao === 'meta' ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400' : 'no-store');
    res.status(200).json(out);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(e.status || 500).json({ erro: e.message || 'Erro' });
  }
};
module.exports._handle = handle;
