// Cópia dos reportes para o repositório privado de perguntas (GitHub), para o Claude revisar quando o dono pedir.
//   1. aplica revisao/decisoes.json: o que o dono aprovou fica marcado como resolvido no Firebase (e a lista esvazia);
//   2. copia para revisao/reportes.json os bugs e as perguntas reportadas ainda abertos e as perguntas com mais 👎,
//      sem IP, aparelho, conta ou nome de quem mandou.
// Precisa da variável GITHUB_REVISAO_TOKEN na Vercel: token do GitHub com acesso só ao repositório de perguntas
// (Contents: leitura e escrita). Nos testes locais, ARRISCA_REVISAO_PASTA troca o GitHub por uma pasta.
const fs = require('fs'), path = require('path');
const { DEV, ler, grava } = require('./_store');

const REPO = 'GustavoGovetri/arrisca-ai-perguntas', RAMO = 'main';
const ARQ = 'revisao/reportes.json', DEC = 'revisao/decisoes.json';
const LIMITE = 300;
const idOk = id => typeof id === 'string' && /^[-A-Za-z0-9_]{1,128}$/.test(id);
const lista = v => Array.isArray(v) ? v : [];
const falha = (status, m) => Object.assign(new Error(m), { status });

async function gh(metodo, caminho, corpo) {
  const tk = process.env.GITHUB_REVISAO_TOKEN;
  if (!tk) throw falha(503, 'Falta o token do GitHub na Vercel (GITHUB_REVISAO_TOKEN).');
  const r = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + caminho + (metodo === 'GET' ? '?ref=' + RAMO : ''), {
    method: metodo,
    headers: Object.assign({ authorization: 'Bearer ' + tk, accept: 'application/vnd.github+json', 'user-agent': 'arrisca-ai-revisao', 'x-github-api-version': '2022-11-28' },
      corpo ? { 'content-type': 'application/json' } : {}),
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  if (metodo === 'GET' && r.status === 404) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw falha(502, 'GitHub respondeu: ' + (j.message || r.status));
  return j;
}
async function lerArq(caminho) {
  const pasta = process.env.ARRISCA_REVISAO_PASTA;
  if (pasta) { try { return { sha: 'x', dados: JSON.parse(fs.readFileSync(path.join(pasta, caminho), 'utf8')) } } catch (e) { return { sha: null, dados: null } } }
  const j = await gh('GET', caminho);
  if (!j) return { sha: null, dados: null };
  let dados = null;
  try { dados = JSON.parse(Buffer.from(j.content || '', 'base64').toString('utf8')) } catch (e) {}
  return { sha: j.sha, dados };
}
async function gravaArq(caminho, dados, sha, msg) {
  const texto = JSON.stringify(dados, null, 1) + '\n', pasta = process.env.ARRISCA_REVISAO_PASTA;
  if (pasta) { fs.mkdirSync(path.dirname(path.join(pasta, caminho)), { recursive: true }); fs.writeFileSync(path.join(pasta, caminho), texto); return }
  await gh('PUT', caminho, Object.assign({ message: msg, content: Buffer.from(texto).toString('base64'), branch: RAMO }, sha ? { sha } : {}));
}

const corta = (x, n) => String(x == null ? '' : x).slice(0, n);
function limpaBug(id, b) {
  let info = b.info && typeof b.info === 'object' ? Object.assign({}, b.info) : null;
  if (info) ['dev', 'uid', 'email', 'nome', 'ip', 'aparelho'].forEach(k => delete info[k]);
  const s = info ? JSON.stringify(info) : '';
  return { id, quando: b.quando || '', tipo: b.tipo || 'outro', texto: corta(b.texto, 1500), versao: b.versao || '', info: s.length > 2500 ? s.slice(0, 2500) + '…' : info };
}
async function limpaRep(id, r) {
  const out = { id, quando: r.quando || '', tema: r.t || '', qid: r.id || '', pergunta: corta(r.q, 400), resposta: corta(r.a, 200), motivo: corta(r.motivo, 80), nota: corta(r.nota, 400) };
  if (r.nivelAtual) out.nivelAtual = corta(r.nivelAtual, 20);
  if (r.nivelCerto) out.nivelCerto = corta(r.nivelCerto, 20);
  try { // como a pergunta está hoje no banco (pode já ter sido corrigida)
    const p = r.t && r.id ? await require('./perguntas.js')._pergId(String(r.t), String(r.id)) : null;
    out.noBanco = p ? { pergunta: p.q, resposta: p.a, nivel: p.nivel } : 'não está mais no banco';
  } catch (e) {}
  return out;
}
const abertos = obj => Object.entries(obj || {}).filter(([id, v]) => idOk(id) && v && typeof v === 'object' && !v.resolvido)
  .sort((a, b) => String(b[1].quando || '').localeCompare(String(a[1].quando || ''))).slice(0, LIMITE);

async function revisa() {
  // 1. decisões aprovadas pelo dono
  const dec = await lerArq(DEC), pend = (dec.dados && dec.dados.pendentes) || {};
  const feito = { quando: new Date().toISOString(), bugs: [], perguntas: [], notas: [] };
  for (const id of lista(pend.bugs)) if (idOk(id) && !DEV && await ler('bugs/' + id)) { await grava('PATCH', 'bugs/' + id, { resolvido: true }); feito.bugs.push(id) }
  for (const id of lista(pend.perguntas)) if (idOk(id) && await ler('reportes/' + id)) { await grava('PATCH', 'reportes/' + id, { resolvido: true }); feito.perguntas.push(id) }
  for (const k of lista(pend.notas)) {
    const [t, id] = String(k).split('|');
    if (/^[A-Z]{1,3}$/.test(t || '') && /^[a-z0-9]{1,20}$/.test(id || '')) { await grava('PUT', 'notas/' + t + '/' + id, null); feito.notas.push(k) }
  }
  const aplicadas = feito.bugs.length + feito.perguntas.length + feito.notas.length;
  if (lista(pend.bugs).length || lista(pend.perguntas).length || lista(pend.notas).length) {
    const feitas = lista(dec.dados && dec.dados.feitas).slice(-100).concat(aplicadas ? [feito] : []);
    await gravaArq(DEC, { leia: 'Coloque em "pendentes" os ids aprovados pelo dono; o site marca como resolvido e esvazia a lista.', pendentes: { bugs: [], perguntas: [], notas: [] }, feitas }, dec.sha, 'Revisão: aplica o que o dono aprovou');
  }
  // 2. o que está aberto
  const q = 'orderBy=' + encodeURIComponent('"$key"') + '&limitToLast=' + LIMITE;
  const [bugs, reps, notas] = await Promise.all([
    DEV ? Object.fromEntries(require('./bugs.js').MEM.map((b, i) => ['b' + i, b])) : ler('bugs', q),
    ler('reportes', DEV ? '' : q), ler('notas')]);
  const novo = {
    bugs: abertos(bugs).map(([id, b]) => limpaBug(id, b)),
    perguntas: await Promise.all(abertos(reps).map(([id, r]) => limpaRep(id, r))),
    notas: await require('./conta.js').notasPiores(notas)
  };
  const ant = await lerArq(ARQ), igual = ant.dados && JSON.stringify(Object.assign({}, ant.dados, { atualizado: 0 })) === JSON.stringify(Object.assign({ atualizado: 0 }, novo));
  if (!igual) await gravaArq(ARQ, Object.assign({ atualizado: new Date().toISOString() }, novo), ant.sha, 'Revisão: reportes abertos (' + novo.bugs.length + ' bugs, ' + novo.perguntas.length + ' perguntas)');
  return { bugs: novo.bugs.length, perguntas: novo.perguntas.length, notas: novo.notas.lista.length, aplicadas, mudou: !igual };
}

module.exports = { revisa };
