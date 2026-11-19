// Lista de salas públicas do Arrisca Aí (função da Vercel).
//   GET  /api/salas?acao=lista       salas abertas esperando jogadores
//   POST /api/salas?acao=anunciar    {sala} confere a sala no Firebase e põe (ou tira) da lista
//
// Quem decide se a sala aparece é o servidor, lendo a própria sala: ela precisa estar marcada como
// aberta pelo dono, ainda na sala de espera, com o dono presente e com vaga. O índice fica em /publicas,
// que só esta função lê e escreve (fechado para o público).
const { dbGet, dbReq } = require('./_fb');

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
    dono: String(dono.nome || '').trim().slice(0, 16) || 'Sem nome',
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

async function handle(acao, body) {
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
    const out = await handle(acao, body || {});
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(out);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(e.status || 500).json({ erro: e.message || 'Erro' });
  }
};
