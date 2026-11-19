// Contas do Arrisca Aí (função da Vercel). Toda chamada precisa do login: "Authorization: Bearer <ID token>".
//   POST {acao:'entrar', nome, cor}      → devolve o perfil (cria na primeira vez) e se a conta é do dono
//   POST {acao:'perfil', nome, cor}      → muda nome e cor
//   POST {acao:'apagar'}                 → apaga os dados da conta guardados no banco
//   GET  ?acao=painel                    → (só o dono) bugs e perguntas reportadas
//   POST {acao:'resolver', lista, id, resolvido} → (só o dono) marca um aviso como resolvido
const { DB, token, dbReq } = require('./_fb');
const { quemE, ehAdmin } = require('./_auth');

const DEV = !!process.env.ARRISCA_DEV_SALAS; // testes locais: guarda em memória
const MEM = { usuarios: {}, reportes: {
  r1: { t: 'H', id: 'h12', q: 'Em que ano foi a Proclamação da República no Brasil?', a: '1889', motivo: 'Resposta errada', nota: 'acho que está certo, só testando', quando: '2026-11-18T22:10:00.000Z' },
  r2: { t: 'GG', id: 'g7', q: 'Qual é o nome do encanador mais famoso dos games?', a: 'Mario', motivo: 'Nível de dificuldade errado', nivelAtual: 'Difícil', nivelCerto: 'Fácil', quando: '2026-11-19T10:00:00.000Z' }
} };
const LIMITE_LISTA = 300;

const txt = (x, n) => String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const corOk = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null;
const idOk = id => typeof id === 'string' && /^[-A-Za-z0-9_]{1,128}$/.test(id);
const falha = (status, m) => Object.assign(new Error(m), { status });

async function ler(caminho, consulta) {
  if (DEV) return caminho.split('/').reduce((o, k) => (o == null ? undefined : o[k]), MEM) ?? null;
  const url = DB + '/' + caminho + '.json?access_token=' + encodeURIComponent(await token()) + (consulta ? '&' + consulta : '');
  const r = await fetch(url);
  if (!r.ok) throw falha(502, 'O banco respondeu ' + r.status);
  return r.json();
}
async function grava(metodo, caminho, valor) {
  if (DEV) {
    const ks = caminho.split('/'), ult = ks.pop();
    let o = MEM; for (const k of ks) o = o[k] = o[k] || {};
    if (metodo === 'DELETE') delete o[ult];
    else if (metodo === 'PATCH') o[ult] = Object.assign(o[ult] || {}, valor);
    else o[ult] = valor;
    return;
  }
  await dbReq(metodo, caminho, valor);
}
function bugsDev() { try { return Object.fromEntries(require('./bugs.js').MEM.map((b, i) => ['b' + i, b])) } catch (e) { return {} } }

function perfilPublico(p, u) {
  return { nome: p.nome || '', cor: p.cor || null, criado: p.criado || '', email: u.email, verificado: u.verificado, provedor: u.provedor };
}

async function entrar(u, body) {
  const caminho = 'usuarios/' + u.uid + '/perfil';
  let p = await ler(caminho);
  if (!p || typeof p !== 'object') {
    const nome = txt(body.nome, 16) || txt(u.nome, 16) || txt((u.email || '').split('@')[0], 16) || 'Jogador';
    p = { nome, cor: corOk(body.cor), criado: new Date().toISOString(), provedor: txt(u.provedor, 20) };
    await grava('PUT', caminho, p);
  }
  return { perfil: perfilPublico(p, u), admin: ehAdmin(u) };
}

async function mudaPerfil(u, body) {
  const caminho = 'usuarios/' + u.uid + '/perfil';
  const muda = {};
  if (body.nome !== undefined) { const n = txt(body.nome, 16); if (!n) throw falha(400, 'Escolha um nome.'); muda.nome = n }
  if (body.cor !== undefined) { const c = corOk(body.cor); if (c) muda.cor = c }
  if (!Object.keys(muda).length) throw falha(400, 'Nada para mudar.');
  const atual = await ler(caminho);
  if (!atual) throw falha(404, 'Conta não encontrada. Entre de novo.');
  await grava('PATCH', caminho, muda);
  return { perfil: perfilPublico(Object.assign({}, atual, muda), u) };
}

function lista(obj) {
  return Object.entries(obj || {}).filter(([, v]) => v && typeof v === 'object').map(([id, v]) => Object.assign({}, v, { _id: id }))
    .sort((a, b) => String(b.quando || '').localeCompare(String(a.quando || ''))).slice(0, LIMITE_LISTA);
}

async function painel() {
  const q = 'orderBy=' + encodeURIComponent('"$key"') + '&limitToLast=' + LIMITE_LISTA;
  const [bugs, reportes] = await Promise.all([DEV ? bugsDev() : ler('bugs', q), ler('reportes', DEV ? '' : q)]);
  return { bugs: lista(bugs), reportes: lista(reportes) };
}

async function resolver(body) {
  const qual = body.lista === 'bugs' ? 'bugs' : body.lista === 'reportes' ? 'reportes' : null;
  if (!qual || !idOk(body.id)) throw falha(400, 'Aviso inválido.');
  if (DEV && qual === 'bugs') {
    const i = +String(body.id).slice(1), arr = require('./bugs.js').MEM;
    if (arr[i]) arr[i].resolvido = !!body.resolvido;
    return { ok: true };
  }
  const atual = await ler(qual + '/' + body.id);
  if (!atual) throw falha(404, 'Esse aviso não existe mais.');
  await grava('PATCH', qual + '/' + body.id, { resolvido: !!body.resolvido });
  return { ok: true };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const u = await quemE(req);
    if (!idOk(u.uid)) throw falha(400, 'Conta inválida.');
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch (e) { body = {} } }
    body = body && typeof body === 'object' ? body : {};
    const acao = req.method === 'GET' ? (req.query && req.query.acao) : body.acao;
    let r;
    if (req.method === 'GET' && acao === 'painel') {
      if (!ehAdmin(u)) throw falha(403, 'Só o dono do jogo vê o painel.');
      r = await painel();
    } else if (req.method === 'POST' && acao === 'entrar') r = await entrar(u, body);
    else if (req.method === 'POST' && acao === 'perfil') r = await mudaPerfil(u, body);
    else if (req.method === 'POST' && acao === 'apagar') { await grava('DELETE', 'usuarios/' + u.uid); r = { ok: true } }
    else if (req.method === 'POST' && acao === 'resolver') {
      if (!ehAdmin(u)) throw falha(403, 'Só o dono do jogo pode fazer isso.');
      r = await resolver(body);
    } else throw falha(400, 'Ação desconhecida.');
    res.status(200).json(r);
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message || 'Erro' });
  }
};
