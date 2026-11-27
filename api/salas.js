// Lista de salas públicas do Arrisca Aí (função da Vercel).
//   GET  /api/salas?acao=lista       salas abertas esperando jogadores
//   POST /api/salas?acao=anunciar    {sala} confere a sala no Firebase e põe (ou tira) da lista
//
// Quem decide se a sala aparece é o servidor, lendo a própria sala: ela precisa estar marcada como
// aberta pelo dono, ainda na sala de espera, com o dono presente e com vaga. O índice fica em /publicas,
// que só esta função lê e escreve (fechado para o público).
const { dbGet, dbReq } = require('./_fb');
const { limpa: semPalavrao } = require('./_palavrao');
const crypto = require('crypto');
const ST = require('./_store');
const juiz = require('./_juiz');
const STATS = require('./_stats');
const { freia } = require('./_limite');
const FREIO = { criar: 40, entrar: 200, jogada: 3000, votar: 1000, palpite: 1000, titulo: 200, lista: 400, anunciar: 400 };

const MAX = 10;              // jogadores por partida
const VIVA = 3 * 60 * 1000;  // sem notícia do dono por 3 minutos, a sala sai da lista
const CODIGO = /^[A-Z0-9]{4,6}$/;
const COR = /^#[0-9a-fA-F]{6}$/;
const CLASSICO = ['M', 'AL', 'S', 'CT', 'ES', 'V'];

// testes locais (simulador de sala no navegador): guarda em memória e confia no que o aparelho manda
const DEV = !!process.env.ARRISCA_DEV_SALAS;
const MEM = {};

function resumo(meta, g, jog) {
  if (!meta || !g || !g.publica || g.phase !== 'setup') return null;
  const lista = Object.entries(jog || {}).filter(([, p]) => p && p.on !== false);
  const dono = (jog || {})[meta.host];
  if (!dono || dono.on === false) return null;
  const n = lista.length;
  if (n < 1 || n >= MAX) return null;
  const temas = Array.isArray(g.selThemes) ? g.selThemes.filter(t => typeof t === 'string').slice(0, 20) : [];
  return {
    dono: semPalavrao(String(dono.nome || '').trim().slice(0, 16)) || 'Sem nome',
    cor: COR.test(dono.cor || '') ? dono.cor : '#ffd23f',
    n, max: MAX,
    modo: String(g.modo || 'classico').slice(0, 12),
    temas: temas.length,
    classico: temas.length === CLASSICO.length && CLASSICO.every(t => temas.includes(t)),
    nivel: String(g.level || 'misto').slice(0, 6),
    ts: Date.now()
  };
}

async function leSala(code) {
  const [meta, estado, jog] = await Promise.all([dbGet('salas/' + code + '/meta'), dbGet('salas/' + code + '/estado'), dbGet('salas/' + code + '/jogadores')]);
  let g = null;
  try { g = estado && estado.g ? JSON.parse(estado.g) : null } catch (e) { g = null }
  return resumo(meta, g, jog);
}

// ---------------------------------------------------------------- estado da partida: quem grava é o servidor
//   POST criar   {sala, dev, chave, g}        cria a sala (meta e estado inicial); quem cria vira o dono
//   POST entrar  {sala, dev, chave}           registra o aparelho na sala (a chave fica guardada só como hash)
//   POST jogada  {sala, dev, chave, base, g}  confere a jogada com o juiz e grava a versão base+1
//   POST votar   {sala, dev, chave, id, voto} voto na resposta (id = dev) ou no desfazer (id = dev_u)
// O aparelho prova quem é com uma chave aleatória que só ele tem. Ninguém grava "meta", "estado" ou "votos" direto.
const ID = /^[A-Za-z0-9_-]{1,60}$/;
// tamanho máximo do estado da sala: uma partida longa fica em ~20 KB; a sala de espera, em ~2 KB
const MAX_G = 120000, MAX_G_ESPERA = 20000;
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const erro = (status, msg, extra) => Object.assign(new Error(msg), { status }, extra || {});
function codigo(x) { const c = String(x || '').toUpperCase(); if (!CODIGO.test(c)) throw erro(400, 'Sala inválida'); return c }
function quem(body) {
  const dev = String(body.dev || ''), chave = String(body.chave || '');
  if (!ID.test(dev) || chave.length < 20 || chave.length > 100) throw erro(400, 'Aparelho inválido');
  const h = hash(chave);
  // id novo ("k" + começo do hash da chave): só quem tem a chave usa esse id, ninguém consegue tomar o lugar de outro aparelho.
  // Ids antigos continuam valendo do jeito de antes (a primeira chave que aparece na sala fica guardada).
  if (/^k[0-9a-f]{16}$/.test(dev) && dev !== 'k' + h.slice(0, 16)) throw erro(400, 'Aparelho inválido');
  return { dev, h };
}
async function confereChave(code, q, guardada) {
  if (guardada == null) { await ST.grava('PUT', 'srv/chaves/' + code + '/' + q.dev, q.h); return }
  if (guardada !== q.h) throw erro(403, 'Este aparelho não confere com o que entrou na sala. Saia e entre de novo.');
}
function estadoG(e) { try { return e && e.g ? JSON.parse(e.g) : null } catch (x) { return null } }

// identidade anônima do Firebase deste aparelho (a do app da sala): o servidor guarda em srv/donos, e as regras do banco
// só deixam criar a entrada do aparelho na lista de jogadores para essa identidade. Assim ninguém "guarda o lugar" de outro.
async function donoAnon(body) {
  if (!body.anon) return null;
  try { return (await require('./_auth').verifica(String(body.anon).slice(0, 4000))).uid } catch (e) { return null }
}
async function criar(body) {
  const code = codigo(body.sala), q = quem(body);
  const g = typeof body.g === 'string' && body.g.length < MAX_G_ESPERA ? estadoG({ g: body.g }) : null;
  if (!g) throw erro(400, 'Estado inválido');
  if (await ST.ler('salas/' + code + '/meta')) throw erro(409, 'Esse código já está em uso');
  const r = await juiz.confere({ prev: null, next: g, dev: q.dev, host: q.dev, lobby: {}, votos: {}, hist: [], sala: code, agora: Date.now(), perg: perg() });
  if (!r.ok) throw erro(403, r.motivo);
  const agora = Date.now();
  await ST.gravaVarios({
    ['salas/' + code + '/meta']: { host: q.dev, criada: agora },
    ['salas/' + code + '/estado']: { v: 1, g: body.g, por: q.dev, ts: agora },
    ['srv/chaves/' + code + '/' + q.dev]: q.h
  });
  const uid = await donoAnon(body);
  if (uid) await ST.grava('PUT', 'srv/donos/' + code + '/' + q.dev, uid);
  return { v: 1 };
}
async function entrar(body) {
  const code = codigo(body.sala), q = quem(body);
  const [meta, guardada] = await Promise.all([ST.ler('salas/' + code + '/meta'), ST.ler('srv/chaves/' + code + '/' + q.dev)]);
  if (!meta) throw erro(404, 'Sala não encontrada');
  await confereChave(code, q, guardada);
  const uid = await donoAnon(body);
  if (uid) await ST.grava('PUT', 'srv/donos/' + code + '/' + q.dev, uid);
  return { host: meta.host || null };
}
// título da conta ao lado do nome na sala: o servidor confere a conta (token do login) e grava; ninguém grava "titulos" direto
async function titulo(body) {
  const code = codigo(body.sala), q = quem(body);
  const [meta, guardada] = await Promise.all([ST.ler('salas/' + code + '/meta'), ST.ler('srv/chaves/' + code + '/' + q.dev)]);
  if (!meta) throw erro(404, 'Sala não encontrada');
  await confereChave(code, q, guardada);
  let t = null, foto = null, uid = null;
  if (body.token) {
    const u = await require('./_auth').verifica(String(body.token).slice(0, 4000));
    if (u.provedor !== 'anonymous' && ID.test(u.uid) && (u.verificado || u.provedor === 'google.com')) {
      uid = u.uid;
      const [p, st] = await Promise.all([ST.ler('usuarios/' + u.uid + '/perfil'), ST.ler('usuarios/' + u.uid + '/stats')]);
      t = p && p.titulo ? STATS.titulo(p.titulo, st, u.uid) : null;
      foto = p && typeof p.mini === 'string' && p.mini.length <= 12000 && /^data:image\/jpeg;base64,/.test(p.mini) ? p.mini : null;
    }
  }
  // junto vai a foto pequena da conta (aparece ao lado do nome na sala)
  const v = (t || foto) ? Object.assign({}, t ? { x: t.x, n: t.n } : {}, foto ? { f: foto } : {}) : null;
  // qual conta está neste aparelho (fechado para o público): só ela pode somar os pontos das respostas dele
  await ST.gravaVarios({ ['salas/' + code + '/titulos/' + q.dev]: v, ['srv/contas/' + code + '/' + q.dev]: uid });
  return { titulo: v };
}
const liberou = g => !!(g && g.qid && g.tk && (g.resp || (g.chosen !== null && g.chosen !== undefined) || g.phase === 'result' || g.phase === 'won'));
let PERG = null;
function perg() { if (!PERG) PERG = require('./perguntas.js')._pergTk; return PERG }
async function jogada(body) {
  const code = codigo(body.sala), q = quem(body);
  if (typeof body.g !== 'string' || body.g.length > MAX_G) throw erro(400, 'Estado inválido');
  if (body.g.length > MAX_G_ESPERA && (estadoG({ g: body.g }) || {}).phase === 'setup') throw erro(400, 'Estado inválido');
  const base = Number(body.base);
  const [meta, est, guardada, jog, votos, hist] = await Promise.all([
    ST.ler('salas/' + code + '/meta'), ST.lerEtag('salas/' + code + '/estado'), ST.ler('srv/chaves/' + code + '/' + q.dev),
    DEV ? Promise.resolve(body.lobby && typeof body.lobby === 'object' ? body.lobby : {}) : ST.ler('salas/' + code + '/jogadores'),
    ST.ler('salas/' + code + '/votos'), ST.ler('srv/hist/' + code)
  ]);
  if (!meta) throw erro(404, 'Sala não encontrada');
  await confereChave(code, q, guardada);
  const atual = est.v || null;
  const devolve = atual && typeof atual.v === 'number' ? { v: atual.v, g: atual.g, por: atual.por || null, ts: atual.ts || 0 } : null;
  if (!atual || atual.v !== base) throw erro(409, 'Alguém mexeu ao mesmo tempo', { estado: devolve });
  const next = estadoG({ g: body.g });
  const h = Array.isArray(hist) ? hist : [];
  const r = await juiz.confere({ prev: estadoG(atual), next, dev: q.dev, host: meta.host, lobby: jog || {}, votos: votos || {}, hist: h,
    sala: code, agora: Date.now(), perg: perg(), semLobby: DEV && !body.lobby, porAnterior: atual.por || null });
  if (!r.ok) {
    if (DEV) { const a = estadoG(atual) || {}; console.log('[juiz] recusou', q.dev, r.motivo, '|', a.phase, a.cur, a.qid, a.resp && a.resp.k, '→', next.phase, next.cur, next.qid, '| votos', JSON.stringify(votos)) }
    throw erro(403, r.motivo, { estado: devolve });
  }
  const agora = Date.now(), v = base + 1;
  const gravou = await ST.gravaSe('salas/' + code + '/estado', { v, g: body.g, por: q.dev, ts: agora }, est.etag);
  if (!gravou) { const e2 = await ST.ler('salas/' + code + '/estado'); throw erro(409, 'Alguém mexeu ao mesmo tempo', { estado: e2 }) }
  const prevN = juiz.nucleo(estadoG(atual) || {});
  const nh = (h.length ? h : [{ v: base, c: prevN }]).concat([{ v, c: juiz.nucleo(next) }]).slice(-25);
  const mapa = { ['srv/hist/' + code]: nh };
  // quem criou a sala foi tirado da partida: o comando da sala passa para o primeiro da roda
  if (r.expulso && (r.saiu || [r.expulso]).includes(meta.host) && Array.isArray(next.players) && next.players[0]) mapa['salas/' + code + '/meta/host'] = juiz.devsDe(next.players[0])[0] || next.players[0].dev;
  if (r.resp) mapa['srv/resp/' + code + '/' + r.resp.qid] = Object.assign({}, r.resp, { jogo: next.jogo || null, w: agora });
  // a jogada que mostra a resposta (respondeu, escolheu, "não sei", tempo esgotado) já leva a resposta oficial:
  // quem jogou recebe aqui e os outros pela sala, sem precisar pedir de novo
  let resposta = null;
  if (liberou(next)) {
    const info = await perg()(next.tk).catch(() => null);
    if (info && info.qid === next.qid && info.s === code) {
      resposta = { a: info.a, m: info.mapa || null };
      // palpites de quem estava esperando: guardados fechados até agora, saem junto com a resposta oficial
      const pp = await ST.ler('srv/palp/' + code + '/' + next.qid).catch(() => null);
      const p = palpitesAbertos(pp, next, info.a);
      if (p) { resposta.p = p; resposta.j = String(next.jogo || '').slice(0, 40) }
      mapa['salas/' + code + '/respostas/' + next.qid] = Object.assign({ w: agora }, resposta);
    }
  }
  await ST.gravaVarios(mapa);
  return resposta ? { v, qid: next.qid, resposta } : { v };
}
// ---------------------------------------------------------------- palpite de quem está esperando
//   POST palpite {sala, dev, chave, qid, t | o}  t = texto (resposta digitada), o = alternativa escolhida
// Fica em srv/ (fechado) enquanto quem está na vez responde: ninguém, nem quem está na vez, vê antes da hora.
function palpitesAbertos(pp, g, oficial) {
  if (!pp || typeof pp !== 'object') return null;
  const devs = new Set((g.players || []).flatMap(x => juiz.devsDe(x))); // no modo equipes, os membros dos times
  const ops = g.q && Array.isArray(g.q[1]) ? g.q[1] : null, out = {};
  for (const [d, v] of Object.entries(pp)) {
    if (!ID.test(d) || !devs.has(d) || !v || typeof v !== 'object') continue;
    if (typeof v.t === 'string' && v.t) out[d] = { t: v.t.slice(0, 80) };
    else if (Number.isInteger(v.o) && ops && v.o >= 0 && v.o < ops.length) out[d] = { o: v.o, ok: ops[v.o] === oficial ? 1 : 0 };
  }
  return Object.keys(out).length ? out : null;
}
async function palpite(body) {
  const code = codigo(body.sala), q = quem(body);
  const qid = String(body.qid || '');
  if (!/^[a-z0-9]{1,16}$/.test(qid)) throw erro(400, 'Pergunta inválida');
  const [est, guardada] = await Promise.all([ST.ler('salas/' + code + '/estado'), ST.ler('srv/chaves/' + code + '/' + q.dev)]);
  if (!est) throw erro(404, 'Sala não encontrada');
  await confereChave(code, q, guardada);
  const g = estadoG(est);
  if (!g || g.phase !== 'question' || g.qid !== qid || liberou(g)) throw erro(409, 'Essa pergunta já foi respondida');
  const eu = juiz.pecaDe((g.players || []).filter(Boolean), q.dev);
  if (eu < 0) throw erro(403, 'Só quem está na partida palpita');
  if (eu === +g.cur) throw erro(403, 'Quem está na vez responde, não palpita');
  let v;
  if (body.o !== undefined) {
    const o = Number(body.o), n = g.q && Array.isArray(g.q[1]) ? g.q[1].length : 0;
    if (!Number.isInteger(o) || o < 0 || o >= n) throw erro(400, 'Palpite inválido');
    v = { o };
  } else {
    const t = semPalavrao(String(body.t || '').replace(/\s+/g, ' ').trim().slice(0, 80));
    if (!t) throw erro(400, 'Palpite vazio');
    v = { t };
  }
  await ST.grava('PUT', 'srv/palp/' + code + '/' + qid + '/' + q.dev, Object.assign(v, { ts: Date.now() }));
  return { ok: true, palpite: v };
}
const TEMAS_VOTO = ['M', 'H', 'AL', 'MU', 'CS', 'S', 'CT', 'TI', 'ES', 'GG', 'V', 'N'];
async function votar(body) {
  const code = codigo(body.sala), q = quem(body);
  const id = String(body.id || '');
  if (id !== q.dev && id !== q.dev + '_u' && id !== q.dev + '_x' && id !== q.dev + '_t') throw erro(403, 'Voto de outro aparelho');
  const voto = body.voto && typeof body.voto === 'object' ? body.voto : null;
  if (!voto || typeof voto.k !== 'string' || voto.k.length > 60) throw erro(400, 'Voto inválido');
  const [guardada, est] = await Promise.all([ST.ler('srv/chaves/' + code + '/' + q.dev), ST.ler('salas/' + code + '/estado')]);
  if (!est) throw erro(404, 'Sala não encontrada');
  await confereChave(code, q, guardada);
  // o voto só vale para a votação que está aberta agora (votos antigos não podem aprovar outra coisa)
  const g = estadoG(est) || {};
  const aberta = id === q.dev ? (g.resp && g.resp.k) : id.endsWith('_u') ? (g.desfazer && 'u:' + g.desfazer.id)
    : id.endsWith('_x') ? (g.expulsar && 'x:' + g.expulsar.id) : (g.vt && 'f:' + g.vt.id);
  if (!aberta || voto.k !== aberta) throw erro(409, 'Essa votação já fechou');
  if (juiz.pecaDe((g.players || []).filter(Boolean), q.dev) < 0) throw erro(403, 'Só quem está na partida vota');
  const tema = id.endsWith('_t') ? String(voto.t || '') : null; // voto no tema da pergunta final
  if (tema !== null && !TEMAS_VOTO.includes(tema)) throw erro(400, 'Voto inválido');
  const v = { k: voto.k, v: !!voto.v, ts: Date.now() };
  if (tema !== null) v.t = tema;
  await ST.grava('PUT', 'salas/' + code + '/votos/' + id, v);
  return { ok: true, voto: v };
}

async function handle(acao, body) {
  if (acao === 'criar') return criar(body);
  if (acao === 'entrar') return entrar(body);
  if (acao === 'jogada') return jogada(body);
  if (acao === 'votar') return votar(body);
  if (acao === 'palpite') return palpite(body);
  if (acao === 'titulo') return titulo(body);
  if (acao === 'lista') {
    const todas = DEV ? MEM : ((await dbGet('publicas')) || {});
    const agora = Date.now(), out = [], velhas = [];
    for (const [code, s] of Object.entries(todas)) {
      if (!s || !CODIGO.test(code) || agora - (s.ts || 0) > VIVA) { velhas.push(code); continue }
      out.push({ sala: code, dono: s.dono, cor: s.cor, n: s.n, max: s.max || MAX, modo: s.modo, temas: s.temas, classico: !!s.classico, nivel: s.nivel });
    }
    if (velhas.length) { // limpa as que ninguém atualizou
      if (DEV) velhas.forEach(c => delete MEM[c]);
      else dbReq('PATCH', 'publicas', Object.fromEntries(velhas.map(c => [c, null]))).catch(() => {});
    }
    out.sort((a, b) => b.n - a.n || a.sala.localeCompare(b.sala));
    return { salas: out.slice(0, 50) };
  }
  if (acao === 'anunciar') {
    const code = String(body.sala || '').toUpperCase();
    if (!CODIGO.test(code)) throw Object.assign(new Error('Sala inválida'), { status: 400 });
    let r;
    if (DEV) { const i = body.dev || {}; r = resumo(i.meta, i.g, i.jog) }
    else r = await leSala(code);
    if (DEV) { if (r) MEM[code] = r; else delete MEM[code] }
    else if (r) await dbReq('PUT', 'publicas/' + code, r);
    else await dbReq('DELETE', 'publicas/' + code);
    return { publica: !!r };
  }
  throw Object.assign(new Error('Ação inválida'), { status: 400 });
}

module.exports = async (req, res) => {
  const acao = (req.query && req.query.acao) || '';
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch (e) { body = {} } }
  try {
    freia(req, 's-' + (FREIO[acao] ? acao : 'outra'), FREIO[acao] || 60, 600e3);
    const out = await handle(acao, body || {});
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(out);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(e.status || 500).json(Object.assign({ erro: e.message || 'Erro' }, e.estado !== undefined ? { estado: e.estado } : {}));
  }
};
module.exports._handle = handle;
