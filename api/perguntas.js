// Servidor de perguntas do Arrisca Aí (função da Vercel).
// As perguntas ficam no Firebase Realtime Database, em /banco (fechado para o público).
// Só esta função consegue ler, usando a conta de serviço em FIREBASE_SERVICE_ACCOUNT.
//
//   GET  /api/perguntas?acao=meta       quantas perguntas há por tema e nível
//   POST /api/perguntas?acao=sortear    sorteia uma pergunta (sem a resposta)
//   POST /api/perguntas?acao=resposta   devolve a resposta, só depois que a pessoa respondeu
//   POST /api/perguntas?acao=dica       dica (primeira letra e tamanho, ou uma alternativa errada)
//   POST /api/perguntas?acao=forma      desenho da pergunta de silhueta (contorno do país)
//   POST /api/perguntas?acao=nota       👍/👎 de quem jogou a pergunta (vai para o painel do dono)
const crypto = require('crypto');

const ORDER = ['M', 'H', 'AL', 'MU', 'CS', 'S', 'CT', 'TI', 'ES', 'GG', 'V', 'N']; // N: Natal (o site só oferece em dezembro)
const LEVELS = { 1: 'fácil', 2: 'médio', 3: 'difícil', 4: 'impossível' };
// Partida com os 6 temas clássicos: as perguntas dos outros 5 temas entram neles, por assunto.
// (Variedades é só de múltipla escolha, então não recebe perguntas abertas.)
const CLASSICO = ['M', 'AL', 'S', 'CT', 'ES', 'V'];
const ROTA_PADRAO = { H: 'M', MU: 'AL', CS: 'S', TI: 'CT', GG: 'ES' };
const ROTA = {
  H: { mitologia: 'AL', folclore: 'S', papas: 'S', 'invencoes-e-descobertas': 'CT' },
  TI: Object.fromEntries(['empresas-e-pessoas', 'fundadores', 'empresas-donas', 'empresas', 'tecnologia', 'produtos-e-empresas', 'startups-e-apps-brasileiros', 'apps-pelo-mundo', 'mascotes-e-logos', 'criadores-de-conteudo', 'internet-no-brasil', 'dinheiro-digital', 'golpes-e-seguranca'].map(b => [b, 'S'])),
  GG: Object.fromEntries(['quadrinhos-herois', 'anime-populares', 'anime-2', 'anime-3', 'anime-e-manga', 'anime-variantes', 'cultura-geek', 'geek-britanico', 'tokusatsu', 'desenhos-dos-anos-80', 'personagens'].map(b => [b, 'AL']))
};
const destino = (t, b) => (ROTA[t] && ROTA[t][b]) || ROTA_PADRAO[t];
const TEMA_N = { M: 'Mundo', H: 'História', AL: 'Artes e Literatura', MU: 'Música', CS: 'Cinema e Séries', S: 'Sociedade', CT: 'Ciência', TI: 'Tecnologia e Internet', ES: 'Esporte', GG: 'Games e Geek', V: 'Variedades', N: 'Natal' };

const { cred, dbGet } = require('./_fb');
const { freia, ip } = require('./_limite');
// quantos pedidos cada endereço pode fazer a cada 10 minutos (folgado para uma família na mesma rede)
const FREIO = { sortear: 300, resposta: 300, dica: 80, forma: 300, meta: 200, aquece: 200, nota: 120, desafio: 100, desafioResp: 200 };
const ST = require('./_store');
const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

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
// perguntas de silhueta: o texto guarda a chave do desenho (⟦f:chave⟧), que não vai para o aparelho
// (bandeiras: ⟦b:chave⟧, com a imagem guardada em banco/bandeiras)
const MARCA = /\s*⟦([fb]):([a-z0-9]+)⟧/;
const textoQ = s => String(s).replace(MARCA, '');
const formaDe = q => { const m = MARCA.exec(q[0]); return m ? m[2] : null };
const tipoDe = q => { const m = MARCA.exec(q[0]); return m ? m[1] : null };

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
  // perguntas emprestadas para a partida clássica: extra[destino] = [[tema de origem, índice]]; rotas[origem][destino] = {n, lv}
  B.extra = {}; B.rotas = {};
  CLASSICO.forEach(d => B.extra[d] = []);
  Object.keys(ROTA_PADRAO).forEach(s => {
    B.rotas[s] = {};
    B.temas[s].items.forEach((q, i) => {
      const d = destino(s, String(bucketOf(s, q)));
      B.extra[d].push([s, i]);
      const r = B.rotas[s][d] || (B.rotas[s][d] = { n: 0, lv: [0, 0, 0, 0, 0] });
      r.n++; r.lv[qDiff(s, q)]++;
    });
  });
  return B;
}
async function banco() {
  if (process.env.BANCO_ARQUIVO) { // testes locais (aceita o questions.json ou o banco.json com as silhuetas)
    if (!BANCO) {
      const raw = JSON.parse(require('fs').readFileSync(process.env.BANCO_ARQUIVO, 'utf8'));
      const completo = raw.perguntas && !raw.M;
      BANCO = monta(completo ? raw.perguntas : raw, 'local');
      BANCO.formas = (completo && raw.formas) || {}; BANCO.mapa = (completo && raw.mapa) || {}; BANCO.bandeiras = (completo && raw.bandeiras) || {};
    }
    return BANCO;
  }
  if (BANCO && Date.now() - CHECADO < 5 * 60 * 1000) return BANCO;
  if (CARREGANDO) return CARREGANDO;
  CARREGANDO = (async () => {
    try {
      const v = await dbGet('banco/versao');
      if (!v) throw Object.assign(new Error('O banco de perguntas ainda está vazio.'), { status: 503 });
      CHECADO = Date.now();
      if (!BANCO || v !== BANCO_V) {
        const [p, f, m, bd] = await Promise.all([dbGet('banco/perguntas'), dbGet('banco/formas'), dbGet('banco/mapa'), dbGet('banco/bandeiras')]);
        const B = monta(p, v); B.formas = f || {}; B.mapa = m || {}; B.bandeiras = bd || {};
        BANCO = B; BANCO_V = v;
      }
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
function sortear(B, t, nivel, usadas, vistas, junta, minimo) {
  // cada pergunta possível é [tema de origem, índice]; na partida clássica entram também as dos outros temas
  const used = new Set(usadas), byLv = { 1: [], 2: [], 3: [], 4: [] };
  const refs = B.temas[t].items.map((_, i) => [t, i]);
  if (junta && B.extra[t]) refs.push(...B.extra[t]);
  for (const r of refs) { const [s, i] = r; if (!used.has(B.temas[s].ids[i])) byLv[qDiff(s, B.temas[s].items[i])].push(r) }
  // nível: 'misto' (todos), um só ('3') ou vários juntos ('12', '34'...)
  let lv = String(nivel || 'misto');
  const escolhidos = lv === 'misto' ? [1, 2, 3, 4] : [...new Set(lv.replace(/[^1-4]/g, '').split('').map(Number))].sort();
  if (!escolhidos.length || escolhidos.length === 4) lv = 'misto';
  const varios = lv !== 'misto' && escolhidos.length > 1;
  let order;
  if (lv === 'misto' || varios) { // sorteia o nível pesando pela raiz de quantas perguntas ainda faltam nele: os níveis pequenos (fácil e impossível) não se esgotam antes
    const pesos = escolhidos.map(l => [l, Math.sqrt(byLv[l].length)]);
    order = [];
    while (pesos.some(p => p[1] > 0)) {
      const tot = pesos.reduce((x, p) => x + p[1], 0);
      let x = rnd(1e9) / 1e9 * tot, k = 0;
      while (k < pesos.length - 1 && (pesos[k][1] === 0 || x >= pesos[k][1])) { x -= pesos[k][1]; k++ }
      order.push(pesos[k][0]); pesos[k][1] = 0;
    }
    // se os escolhidos acabarem, vale o nível de fora mais perto deles
    const dist = l => Math.min(...escolhidos.map(e => Math.abs(e - l)));
    [1, 2, 3, 4].filter(l => !order.includes(l)).sort((x, y) => dist(x) - dist(y)).forEach(l => order.push(l));
  }
  else { const w = +lv; order = [w, w + 1, w - 1, w + 2, w - 2, w + 3, w - 3].filter(l => l >= 1 && l <= 4) }
  // sala online: a lista de "já usadas" vem do aparelho; se ela deixar poucas perguntas de sobra, ela é ignorada,
  // para ninguém conseguir escolher a pergunta que vai cair (excluindo todas as outras)
  if (minimo && escolhidos.reduce((x, l) => x + byLv[l].length, 0) < minimo) {
    for (const l of [1, 2, 3, 4]) byLv[l] = [];
    for (const r of refs) { const [s, i] = r; byLv[qDiff(s, B.temas[s].items[i])].push(r) }
  }
  order = order.filter(l => byLv[l].length);
  if (!order.length) { // acabou o tema: diz quais perguntas usadas são deste baralho (para liberar só elas)
    const ids = {};
    for (const [s, i] of refs) { const id = B.temas[s].ids[i]; if (used.has(id)) (ids[s] = ids[s] || []).push(id) }
    return { esgotado: true, ids };
  }
  const tryPool = pool => {
    const groups = new Map();
    pool.forEach(r => { const b = r[0] + '|' + bucketOf(r[0], B.temas[r[0]].items[r[1]]); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(r) });
    const gs = [...groups.values()];
    // dentro de cada tema de origem, os assuntos pesam pela raiz do tamanho; entre temas, pesa quantas perguntas cada um tem
    const porTema = {}, raiz = {};
    gs.forEach(a => { const s = a[0][0]; porTema[s] = (porTema[s] || 0) + a.length; raiz[s] = (raiz[s] || 0) + Math.sqrt(a.length) });
    const peso = gs.map(a => Math.sqrt(a.length) * porTema[a[0][0]] / raiz[a[0][0]]);
    while (gs.length) {
      const w = peso, tot = w.reduce((x, y) => x + y, 0);
      let x = rnd(1e9) / 1e9 * tot, k = 0;
      while (k < gs.length - 1 && x >= w[k]) { x -= w[k]; k++ }
      const list = gs[k].slice();
      while (list.length) { const j = rnd(list.length), r = list[j]; if (!leaks(B, r[0], r[1], vistas)) return r; list.splice(j, 1) }
      gs.splice(k, 1); peso.splice(k, 1);
    }
    return null;
  };
  let pick = null, usedLv = 0;
  for (const l of order) { pick = tryPool(byLv[l]); if (pick) { usedLv = l; break } }
  if (!pick) { const pool = byLv[order[0]]; pick = pool[rnd(pool.length)]; usedLv = order[0] }
  const lvNote = lv !== 'misto' && !escolhidos.includes(usedLv) ? `Acabaram as perguntas de nível ${escolhidos.map(l => LEVELS[l]).join(' e ')} de ${TEMA_N[t]} que podiam cair agora; esta é de nível ${LEVELS[usedLv]}.` : '';
  return { s: pick[0], i: pick[1], lvNote };
}

// ---------------------------------------------------------------- token da pergunta (quem sorteou, em que sala)
// ---------------------------------------------------------------- desafio do dia
const DSF = require('./_desafio');
const FX = { qDiff, bucketOf, resposta, textoQ, tipoDe };
const DSF_MEM = new Map();
async function desafioDoDia(B, pedido) {
  const P = require('./_stats').periodo, hoje = P().dia, ontem = P(Date.now() - 864e5).dia;
  const dia = pedido === undefined || pedido === null || pedido === '' ? hoje : String(pedido);
  if (dia !== hoje && dia !== ontem) throw Object.assign(new Error('Esse desafio já acabou.'), { status: 400 });
  const k = B.v + '|' + dia;
  if (DSF_MEM.has(k)) return DSF_MEM.get(k);
  // o desafio de cada dia fica guardado: se o banco mudar no meio do dia, as perguntas continuam as mesmas
  let d = await ST.ler('desafio2/' + dia).catch(() => null); // desafio2: alternativas só de perguntas do mesmo molde
  if (!d || !Array.isArray(d.itens) || !d.itens.length) {
    const temas = ORDER.filter(t => t !== 'N').concat(dia.slice(5, 7) === '12' ? ['N'] : []);
    d = DSF.monta(B, FX, dia, temas);
    await ST.grava('PUT', 'desafio2/' + dia, d).catch(() => {});
  }
  if (DSF_MEM.size > 6) DSF_MEM.clear();
  DSF_MEM.set(k, d);
  return d;
}

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

// ---------------------------------------------------------------- perguntas da turma (tema "F", "Turma")
// O baralho é da conta de quem criou a sala (sala online) ou da conta deste aparelho (jogo num aparelho só).
// Na sala, a pergunta sorteada fica guardada em srv/fq/<sala>/<id> (fechado): se o dono mexer no baralho no meio da
// partida, a que já saiu continua igual para o juiz. Não vale ranking (api/conta.js recusa o tema F).
const ID_F = /^f[0-9a-f]{10}$/;
const falhaP = (status, m) => Object.assign(new Error(m), { status });
const opsF = x => Array.isArray(x.e) && x.e.length === 3 ? [x.a, ...x.e] : null;
const nivelF = x => [1, 2, 3, 4].includes(+x.nv) ? +x.nv : 2;
async function baralhoDe(uid) {
  const b = await ST.ler('usuarios/' + uid + '/baralho');
  return Object.entries(b || {}).filter(([id, x]) => ID_F.test(id) && x && typeof x === 'object' && typeof x.q === 'string' && typeof x.a === 'string');
}
async function perguntaF(tk) { // a pergunta por trás de um token do tema "Turma"
  if (tk.s) { const x = await ST.ler('srv/fq/' + tk.s + '/' + tk.i); return x && typeof x.q === 'string' ? x : null }
  if (!tk.u || !ID_F.test(tk.i)) return null;
  const x = await ST.ler('usuarios/' + tk.u + '/baralho/' + tk.i);
  return x && typeof x.q === 'string' && typeof x.a === 'string' ? x : null;
}
async function turma(acao, body) {
  if (acao === 'sortear') {
    const sala = body.sala && /^[A-Z0-9]{4,6}$/.test(body.sala) ? body.sala : null;
    let uid = null;
    if (sala) { // sala online: o baralho de quem criou a sala (a conta que está no aparelho dele)
      const meta = await ST.ler('salas/' + sala + '/meta');
      uid = meta && meta.host ? await ST.ler('srv/contas/' + sala + '/' + meta.host) : null;
      if (!uid) throw falhaP(409, 'Quem criou a sala precisa entrar na conta para usar as perguntas da turma.');
    } else { // num aparelho só: o baralho da conta deste aparelho
      if (!body.conta) throw falhaP(403, 'Entre na conta para jogar com as suas perguntas.');
      uid = (await require('./_auth').verifica(String(body.conta).slice(0, 4000))).uid;
    }
    const lista = await baralhoDe(uid);
    if (!lista.length) throw falhaP(404, 'O baralho da turma está vazio.');
    const usadas = new Set(Array.isArray(body.usadas) ? body.usadas.slice(0, 2000).map(String) : []);
    const livres = lista.filter(([id]) => !usadas.has(id));
    if (!livres.length) return { esgotado: true, ids: { F: lista.map(([id]) => id) } };
    const [id, x] = livres[rnd(livres.length)], nv = nivelF(x), ops = opsF(x);
    if (sala) await ST.grava('PUT', 'srv/fq/' + sala + '/' + id, { q: x.q, a: x.a, e: ops ? x.e : null, nv });
    const out = { id, t: 'F', q: x.q, b: 'turma', d: nv, lvNote: '', tk: assina({ i: id, t: 'F', m: sala ? 'o' : 'l', s: sala, u: sala ? null : uid, e: Date.now() + 864e5 }) };
    if (ops) out.opts = shuffle(ops.slice());
    return out;
  }
  const tk = confere(body.tk);
  if (!tk || tk.i !== body.id || tk.t !== 'F' || tk.e < Date.now()) throw falhaP(403, 'Pergunta inválida');
  if (acao === 'nota') return { ok: true }; // as perguntas da turma não vão para o painel do dono do jogo
  const x = await perguntaF(tk);
  if (!x) throw falhaP(410, 'Essa pergunta mudou. Sorteie outra.');
  if (acao === 'resposta') {
    if (tk.m === 'o' && !(await salaLiberou(tk.s, tk.i))) throw falhaP(403, 'A resposta só aparece depois que a pessoa responde.');
    return { a: x.a };
  }
  if (acao === 'dica') {
    const ops = opsF(x);
    if (ops) { const h = crypto.createHmac('sha256', chaveTk()).update('dica|' + body.tk).digest(); return { elim: x.e[h.readUInt32BE(0) % 3] } }
    return mascara(x.a);
  }
  if (acao === 'forma') throw falhaP(404, 'Essa pergunta não tem desenho.');
  throw falhaP(400, 'Ação inválida');
}

// ---------------------------------------------------------------- rotas
async function handle(acao, body, rede) {
  const B = await banco();
  if (acao === 'aquece') return { ok: true, v: B.v }; // só carrega o banco na memória
  if (acao === 'meta') {
    const n = {}, lv = {};
    ORDER.forEach(t => { n[t] = B.temas[t].items.length; lv[t] = B.temas[t].lv });
    return { v: B.v, n, lv, rotas: B.rotas };
  }
  if (acao === 'desafio') { // as 10 perguntas do dia, sem a resposta
    const d = await desafioDoDia(B, body.dia);
    return { dia: d.dia, n: d.n, itens: d.itens.map(x => ({ t: x.t, q: x.q, o: x.o, nv: x.nv })) };
  }
  if (acao === 'desafioResp') { // a certa de uma pergunta do desafio, depois que a pessoa escolheu
    const d = await desafioDoDia(B, body.dia), x = d.itens[+body.i];
    if (!x) throw Object.assign(new Error('Pergunta inválida'), { status: 400 });
    return { c: x.c };
  }
  if (body.t === 'F') return turma(acao, body);
  const t = body.t;
  if (!Object.prototype.hasOwnProperty.call(B.temas, t)) throw Object.assign(new Error('Tema inválido'), { status: 400 });
  if (acao === 'sortear') {
    const usadas = Array.isArray(body.usadas) ? body.usadas.slice(0, 30000).map(String) : [];
    const vistas = Array.isArray(body.vistas) ? body.vistas.slice(-200).filter(x => Array.isArray(x) && x.length === 2).map(x => [String(x[0]), String(x[1])]) : [];
    const sala = body.sala && /^[A-Z0-9]{4,6}$/.test(body.sala) ? body.sala : null;
    const r = sortear(B, t, body.nivel, usadas, vistas, !!body.junta && CLASSICO.includes(t), sala ? 40 : 0);
    if (r.esgotado) return r;
    const s = r.s, q = B.temas[s].items[r.i], id = B.temas[s].ids[r.i];
    const out = { id, t: s, q: textoQ(q[0]), b: bucketOf(s, q), d: qDiff(s, q), lvNote: r.lvNote, tk: assina({ i: id, t: s, m: sala ? 'o' : 'l', s: sala, e: Date.now() + 864e5 }) };
    if (s === 'V') out.opts = shuffle(q[1].slice());
    return out;
  }
  const tk = confere(body.tk);
  if (!tk || tk.i !== body.id || tk.t !== t || tk.e < Date.now()) throw Object.assign(new Error('Pergunta inválida'), { status: 403 });
  const i = B.temas[t].idx.get(tk.i);
  if (i === undefined) throw Object.assign(new Error('Essa pergunta mudou. Sorteie outra.'), { status: 410 });
  const q = B.temas[t].items[i];
  if (acao === 'resposta') {
    if (tk.m === 'o' && !(await salaLiberou(tk.s, tk.i))) throw Object.assign(new Error('A resposta só aparece depois que a pessoa responde.'), { status: 403 });
    const f = formaDe(q);
    return f ? { a: resposta(t, q), m: B.mapa[f] || null } : { a: resposta(t, q) };
  }
  if (acao === 'nota') { // uma nota por rede (endereço) e por pergunta; tocar de novo troca ou tira
    // antes a chave usava o id do aparelho, que quem chama escolhe: dava para votar quantas vezes quisesse
    const v = body.v === 1 ? 1 : body.v === -1 ? -1 : null;
    const h = b64u(crypto.createHmac('sha256', chaveTk()).update('nota|' + t + '|' + tk.i + '|' + String(rede || 'x')).digest()).slice(0, 16);
    await ST.grava('PUT', 'notas/' + t + '/' + tk.i + '/' + h, v);
    return { ok: true };
  }
  if (acao === 'forma') { // o desenho da silhueta ou a bandeira (é a própria pergunta, então sai junto com ela)
    const f = formaDe(q), tipo = tipoDe(q);
    if (tipo === 'b' && B.bandeiras && B.bandeiras[f]) return { img: B.bandeiras[f] };
    if (tipo === 'f' && B.formas[f]) return { d: B.formas[f] };
    throw Object.assign(new Error('Essa pergunta não tem desenho.'), { status: 404 });
  }
  if (acao === 'dica') {
    // a alternativa eliminada é sempre a mesma para a mesma pergunta: pedir de novo não vai tirando as erradas até sobrar a certa
    if (t === 'V') { const erradas = q[1].filter((_, j) => j !== q[2]); const h = crypto.createHmac('sha256', chaveTk()).update('dica|' + body.tk).digest(); return { elim: erradas[h.readUInt32BE(0) % erradas.length] } }
    return mascara(q[1]);
  }
  throw Object.assign(new Error('Ação inválida'), { status: 400 });
}

module.exports = async (req, res) => {
  const acao = (req.query && req.query.acao) || '';
  try {
    let body = req.body || {};
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch (e) { body = {} } }
    freia(req, 'p-' + (FREIO[acao] ? acao : 'outra'), FREIO[acao] || 60, 600e3);
    const out = await handle(acao, body, ip(req));
    res.setHeader('Cache-Control', acao === 'meta' ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400' : 'no-store');
    res.status(200).json(out);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(e.status || 500).json({ erro: e.message || 'Erro' });
  }
};
module.exports._handle = handle;
// para as contas: confere o token de uma pergunta sorteada e diz o nível dela no banco
module.exports._infoTk = async tk => {
  const x = confere(tk);
  if (!x || typeof x.i !== 'string' || typeof x.t !== 'string') return null;
  if (x.t === 'F') return { qid: x.i, t: 'F', m: x.m, s: x.s || null, e: +x.e || 0, nivel: 2 }; // perguntas da turma: não valem ranking
  const B = await banco(), T = B.temas[x.t];
  if (!T) return null;
  const i = T.idx.get(x.i);
  if (i === undefined) return null;
  return { qid: x.i, t: x.t, m: x.m, s: x.s || null, e: +x.e || 0, nivel: Math.min(4, Math.max(1, +qDiff(x.t, T.items[i]) || 2)) };
};
// para o juiz da sala: a pergunta por trás de um token, com nível, texto e resposta certa (nunca vai para o aparelho)
module.exports._pergTk = async tk => {
  const x = confere(tk);
  if (!x || typeof x.i !== 'string' || typeof x.t !== 'string') return null;
  if (x.t === 'F') {
    const f = await perguntaF(x);
    return f ? { qid: x.i, t: 'F', m: x.m, s: x.s || null, e: +x.e || 0, nivel: nivelF(f), q: f.q, a: f.a, opts: opsF(f), mapa: null } : null;
  }
  const B = await banco(), T = B.temas[x.t];
  if (!T) return null;
  const i = T.idx.get(x.i);
  if (i === undefined) return null;
  const q = T.items[i];
  return { qid: x.i, t: x.t, m: x.m, s: x.s || null, e: +x.e || 0, nivel: Math.min(4, Math.max(1, +qDiff(x.t, q) || 2)),
    q: textoQ(q[0]), a: resposta(x.t, q), opts: x.t === 'V' ? q[1].slice() : null, mapa: formaDe(q) ? B.mapa[formaDe(q)] || null : null };
};
// Sobrevivência relâmpago: uma pergunta de múltipla escolha do nível pedido (ou do mais perto), de um dos temas,
// sem repetir as da partida nem as do Desafio de hoje e de ontem (que têm a certa liberada). A certa (c) nunca vai para o aparelho:
// quem chama guarda em srv/ e só mostra quando a rodada fecha.
module.exports._svSorteia = async (temas, nv, evitar) => {
  const B = await banco(), ev = new Set((evitar || []).map(String));
  try { for (const d of [require('./_stats').periodo().dia, require('./_stats').periodo(Date.now() - 864e5).dia]) (await desafioDoDia(B, d)).itens.forEach(x => ev.add(x.id)) } catch (e) {}
  const lista = [...new Set(temas || [])].filter(t => B.temas[t] && B.temas[t].items.length);
  for (const alt of [nv, nv - 1, nv + 1, nv - 2, nv + 2, nv - 3, nv + 3]) {
    if (alt < 1 || alt > 4) continue;
    const cands = lista.map(t => [t, DSF.pool(B, FX, t, alt).filter(i => !ev.has(B.temas[t].ids[i]))]).filter(x => x[1].length);
    for (let tent = 0; tent < 6 && cands.length; tent++) {
      // o tema pesa pela raiz de quantas perguntas ele tem nesse nível (os pequenos também aparecem)
      const w = cands.map(x => Math.sqrt(x[1].length)), tot = w.reduce((a, b) => a + b, 0);
      let r = rnd(1e9) / 1e9 * tot, k = 0;
      while (k < cands.length - 1 && r >= w[k]) { r -= w[k]; k++ }
      const [t, l] = cands[k], i = l[rnd(l.length)], o = DSF.opcoes(B, FX, t, i);
      if (!o) { l.splice(l.indexOf(i), 1); if (!l.length) cands.splice(k, 1); continue }
      const q = B.temas[t].items[i], ops = shuffle(o.ops.slice());
      return { qid: B.temas[t].ids[i], t, q: textoQ(q[0]), o: ops, c: ops.indexOf(o.certa), nv: Math.min(4, Math.max(1, +qDiff(t, q) || 2)) };
    }
  }
  return null;
};
// para o painel do dono: texto, resposta e nível de uma pergunta pelo tema e id
module.exports._pergId = async (t, id) => {
  const B = await banco(), T = B.temas[t];
  if (!T) return null;
  const i = T.idx.get(id);
  if (i === undefined) return null;
  const q = T.items[i];
  return { q: textoQ(q[0]), a: resposta(t, q), nivel: Math.min(4, Math.max(1, +qDiff(t, q) || 2)), assunto: bucketOf(t, q), tema: TEMA_N[t] || t };
};
// para conferir o desafio nos testes
module.exports._desafioTeste = async (dia, temas) => { const B = await banco(); return DSF.monta(B, FX, dia, temas || ORDER.filter(t => t !== 'N')) };
module.exports._erradasTeste = async (n) => { const B = await banco(); const out = []; for (const t of ORDER) { if (t === 'V') continue; const T = B.temas[t]; for (let i = 0; i < T.items.length && out.length < n * 12; i += 37) { const e = DSF.erradas(B, FX, t, i); if (e) out.push([t, T.items[i][0], resposta(t, T.items[i]), e]) } } return out };
module.exports._bancoTeste = async () => ({ B: await banco(), FX });
module.exports._poolsTeste = async () => { const B = await banco(); const o = {}; ORDER.forEach(t => { o[t] = [1, 2, 3, 4].map(nv => DSF.pool(B, FX, t, nv).length + '/' + B.temas[t].lv[nv]) }); return o };
