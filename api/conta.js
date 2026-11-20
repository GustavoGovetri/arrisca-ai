// Contas do Arrisca Aí (função da Vercel). Toda chamada precisa do login: "Authorization: Bearer <ID token>".
//   POST {acao:'entrar', nome, cor}      → devolve o perfil (cria na primeira vez) e se a conta é do dono
//   GET  ?acao=eu                        → perfil, estatísticas, conquistas e histórico
//   POST {acao:'perfil', nome, cor}      → muda nome e cor (no ranking também)
//   POST {acao:'resposta', sala, jogo, dev, tk, ok, fim, modo, nj} → registra uma resposta de partida online
//   POST {acao:'apagar'}                 → apaga os dados da conta guardados no banco
//   GET  ?acao=painel                    → (só o dono) bugs e perguntas reportadas
//   POST {acao:'resolver', lista, id, resolvido} → (só o dono) marca um aviso como resolvido
const { quemE, ehAdmin } = require('./_auth');
const { DEV, ler, grava, gravaVarios } = require('./_store');
const ST = require('./_stats');

const LIMITE_LISTA = 300, LIMITE_DIA = 400, HIST = 40;
const txt = (x, n) => String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const corOk = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null;
const idOk = id => typeof id === 'string' && /^[-A-Za-z0-9_]{1,128}$/.test(id);
const falha = (status, m) => Object.assign(new Error(m), { status });
function bugsDev() { try { return Object.fromEntries(require('./bugs.js').MEM.map((b, i) => ['b' + i, b])) } catch (e) { return {} } }

const emailOk = u => !!u && (u.verificado || u.provedor === 'google.com');
// foto de perfil: JPEG pequeno (o aparelho já manda reduzido); confere o formato antes de guardar
const FOTO_RE = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/;
function fotoOk(x, max) {
  if (typeof x !== 'string' || x.length > max) return null;
  const m = FOTO_RE.exec(x); if (!m) return null;
  const b = Buffer.from(m[1], 'base64');
  if (b.length < 100 || b[0] !== 0xFF || b[1] !== 0xD8 || b[2] !== 0xFF || b[b.length - 2] !== 0xFF || b[b.length - 1] !== 0xD9) return null;
  return x;
}
// linha da conta no ranking: pontos, nome, cor, título e foto pequena
const linhaRanking = (pts, p, t) => ({ p: pts, n: p.nome || 'Jogador', c: p.cor || null, t: t || null, f: p.mini || null });
function perfilPublico(p, u) {
  return { nome: p.nome || '', cor: p.cor || null, titulo: p.titulo || '', foto: p.foto || null, criado: p.criado || '', email: u.email, verificado: u.verificado, provedor: u.provedor };
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
  const base = 'usuarios/' + u.uid;
  const muda = {};
  if (body.nome !== undefined) { const n = txt(body.nome, 16); if (!n) throw falha(400, 'Escolha um nome.'); muda.nome = n }
  if (body.cor !== undefined) { const c = corOk(body.cor); if (c) muda.cor = c }
  if (body.titulo !== undefined) muda.titulo = body.titulo ? String(body.titulo).slice(0, 30) : null;
  if (!Object.keys(muda).length) throw falha(400, 'Nada para mudar.');
  const [atual, st] = await Promise.all([ler(base + '/perfil'), ler(base + '/stats')]);
  if (!atual) throw falha(404, 'Conta não encontrada. Entre de novo.');
  if (muda.titulo && !ST.titulo(muda.titulo, st, u.uid)) throw falha(400, 'Você ainda não liberou esse título.');
  const p = Object.assign({}, atual, muda), per = ST.periodo(), s = ST.normaliza(st);
  if (!p.titulo) delete p.titulo;
  const t = p.titulo ? ST.titulo(p.titulo, s, u.uid) : null;
  const mapa = { [base + '/perfil']: p };
  // o nome, a cor e o título aparecem no ranking da semana e do mês atuais
  if (s.sem.id === per.semana && s.sem.p > 0) mapa['ranking/semana/' + per.semana + '/' + u.uid] = linhaRanking(s.sem.p, p, t);
  if (s.mes.id === per.mes && s.mes.p > 0) mapa['ranking/mes/' + per.mes + '/' + u.uid] = linhaRanking(s.mes.p, p, t);
  await gravaVarios(mapa);
  return { perfil: perfilPublico(p, u) };
}

async function mudaFoto(u, body) {
  const base = 'usuarios/' + u.uid, tira = !body.foto;
  const foto = tira ? null : fotoOk(body.foto, 60000), mini = tira ? null : fotoOk(body.mini, 12000);
  if (!tira && (!foto || !mini)) throw falha(400, 'Não consegui usar essa imagem. Tente outra foto.');
  const [atual, st] = await Promise.all([ler(base + '/perfil'), ler(base + '/stats')]);
  if (!atual) throw falha(404, 'Conta não encontrada. Entre de novo.');
  const p = Object.assign({}, atual, { foto, mini }); if (tira) { delete p.foto; delete p.mini }
  const s = ST.normaliza(st), per = ST.periodo(), t = p.titulo ? ST.titulo(p.titulo, s, u.uid) : null;
  const mapa = { [base + '/perfil']: p };
  if (s.sem.id === per.semana && s.sem.p > 0) mapa['ranking/semana/' + per.semana + '/' + u.uid] = linhaRanking(s.sem.p, p, t);
  if (s.mes.id === per.mes && s.mes.p > 0) mapa['ranking/mes/' + per.mes + '/' + u.uid] = linhaRanking(s.mes.p, p, t);
  await gravaVarios(mapa);
  return { perfil: perfilPublico(p, u) };
}

async function eu(u) {
  const base = 'usuarios/' + u.uid;
  const [perfil, st, conq, partidas] = await Promise.all([ler(base + '/perfil'), ler(base + '/stats'), ler(base + '/conquistas'), ler(base + '/partidas')]);
  const s = ST.normaliza(st), per = ST.periodo();
  const hist = Object.entries(partidas || {}).filter(([, v]) => v && typeof v === 'object').map(([id, v]) => Object.assign({ id }, v))
    .sort((a, b) => String(b.fim || '').localeCompare(String(a.fim || ''))).slice(0, HIST);
  return {
    perfil: perfilPublico(perfil || {}, u), admin: ehAdmin(u),
    stats: { p: s.p, a: s.a, e: s.e, v: s.v, np: s.np, maxSeq: s.maxSeq, seq: s.seq, tema: s.tema,
      semana: s.sem.id === per.semana ? s.sem.p : 0, mes: s.mes.id === per.mes ? s.mes.p : 0 },
    conquistas: ST.conquistasLista(s, conq || {}),
    historico: hist
  };
}

// uma resposta de partida online. O servidor confere a pergunta pelo token que ele mesmo assinou ao sortear,
// e confere no estado da sala que ela saiu mesmo ali; cada pergunta da sala vale uma vez só.
async function resposta(u, body) {
  // conta de e-mail e senha só pontua depois de confirmar o e-mail (evita conta com e-mail inventado ou de outra pessoa)
  if (!emailOk(u)) throw falha(403, 'Confirme seu e-mail para suas partidas contarem no ranking.');
  const info = await require('./perguntas.js')._infoTk(body.tk);
  if (!info || info.m !== 'o' || !info.s) throw falha(400, 'Só perguntas de partidas online contam.');
  if (info.e < Date.now() - 6 * 3600e3) throw falha(400, 'Essa pergunta já é antiga.');
  const sala = info.s;
  if (body.sala && body.sala !== sala) throw falha(400, 'A pergunta é de outra sala.');
  const jogo = String(body.jogo || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'x';
  const ok = !!body.ok, dev = String(body.dev || '').slice(0, 40);
  const base = 'usuarios/' + u.uid, regC = 'srv/reg/' + sala + '/' + info.qid, chave = sala + '_' + jogo;
  const [reg, st, conq, part0, perfil, estado, jogadores, rr] = await Promise.all([
    ler(regC), ler(base + '/stats'), ler(base + '/conquistas'), ler(base + '/partidas/' + chave), ler(base + '/perfil'),
    DEV ? null : ler('salas/' + sala + '/estado'), DEV ? null : ler('salas/' + sala + '/jogadores'), ler('srv/resp/' + sala + '/' + info.qid)
  ]);
  if (reg) return { ja: true };
  if (!perfil) throw falha(404, 'Conta não encontrada. Entre de novo.');
  let fim = !!body.fim && ok;
  // o que vale é o que o juiz da sala aceitou (gravado pelo servidor quando a pergunta foi fechada)
  if (rr || !DEV) {
    if (!rr) throw falha(400, 'Essa resposta não foi registrada pela sala.');
    if (!!rr.ok !== ok || (rr.d || '') !== dev || (rr.jogo || 'x') !== jogo) throw falha(400, 'A resposta não confere com a sala.');
    fim = fim && !!rr.fim;
  }
  if (!DEV) {
    if (!jogadores || Object.keys(jogadores).length < 2) throw falha(400, 'Só contam salas com 2 jogadores ou mais.');
    let g = null; try { g = JSON.parse(estado && estado.g) } catch (e) { g = null }
    if (!g || g.jogo !== jogo) throw falha(400, 'Partida não encontrada na sala.');
  }
  const s = ST.normaliza(st);
  if (s.dia.id === ST.periodo().dia && s.dia.n >= LIMITE_DIA) throw falha(429, 'Limite de respostas de hoje.');
  const agora = Date.now(), quando = new Date(agora).toISOString();
  const nivel = info.nivel;
  let part = part0 && typeof part0 === 'object' ? part0 : null;
  if (!part) { s.np++; part = { sala, inicio: quando, a: 0, e: 0, p: 0, venceu: false, modo: txt(body.modo, 12), nj: Math.max(2, Math.min(10, +body.nj || 2)) } }
  const pts = ST.aplica(s, { ok, nivel, tema: info.t, fim, agora });
  if (ok) part.a++; else part.e++;
  part.p += pts; part.fim = quando; if (fim) part.venceu = true;
  const tem = conq || {}, ganhou = ST.novas(s, tem);
  const per = ST.periodo(agora), nome = perfil.nome || 'Jogador', cor = perfil.cor || null, t = perfil.titulo ? ST.titulo(perfil.titulo, s, u.uid) : null;
  const mapa = {
    [regC]: { u: u.uid, ok, n: nivel, w: agora },
    [base + '/stats']: s,
    [base + '/partidas/' + chave]: part
  };
  if (s.sem.p > 0) { mapa['ranking/semana/' + per.semana + '/' + u.uid] = linhaRanking(s.sem.p, perfil, t); mapa[base + '/rk/semana_' + per.semana] = true }
  if (s.mes.p > 0) { mapa['ranking/mes/' + per.mes + '/' + u.uid] = linhaRanking(s.mes.p, perfil, t); mapa[base + '/rk/mes_' + per.mes] = true }
  ganhou.forEach(c => { mapa[base + '/conquistas/' + c.id] = quando });
  await gravaVarios(mapa);
  return { pts, nivel, fim, total: s.p, semana: s.sem.p, novas: ganhou.map(c => ({ id: c.id, e: c.e, n: c.n, nivel: c.nivel })) };
}

// histórico de perguntas da conta (vale em qualquer aparelho): por tema, ids separados por espaço
const ID_Q = /^[a-z0-9]{1,16}$/, MAX_T = 6000;
async function usadas(u, body, get) {
  const base = 'usuarios/' + u.uid + '/usadas';
  const atual = (await ler(base)) || {};
  if (get) return { usadas: atual };
  const mapa = {};
  const add = body.add && typeof body.add === 'object' ? body.add : {};
  Object.entries(add).forEach(([t, ids]) => {
    if (!ST.TEMAS[t] || !Array.isArray(ids)) return;
    const st = new Set(String(atual[t] || '').split(' ').filter(Boolean));
    const antes = st.size;
    ids.slice(0, MAX_T).forEach(id => { if (typeof id === 'string' && ID_Q.test(id)) st.add(id) });
    if (st.size !== antes) mapa[base + '/' + t] = [...st].slice(-MAX_T).join(' ');
  });
  // liberar um tema (quando as perguntas dele acabaram e a pessoa aprovou começar de novo)
  (Array.isArray(body.limpa) ? body.limpa : []).forEach(t => {
    if (!ST.TEMAS[t]) return;
    const tira = Array.isArray(body.tira && body.tira[t]) ? new Set(body.tira[t]) : null;
    if (!tira) { mapa[base + '/' + t] = null; return }
    mapa[base + '/' + t] = String(atual[t] || '').split(' ').filter(id => id && !tira.has(id)).join(' ') || null;
  });
  await gravaVarios(mapa);
  return { ok: true, mudou: Object.keys(mapa).length };
}

async function apagar(u) {
  const base = 'usuarios/' + u.uid;
  const rk = await ler(base + '/rk');
  const mapa = { [base]: null };
  Object.keys(rk || {}).forEach(k => { const m = /^(semana|mes)_([-A-Za-z0-9]+)$/.exec(k); if (m) mapa['ranking/' + m[1] + '/' + m[2] + '/' + u.uid] = null });
  await gravaVarios(mapa);
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
    if (!emailOk(u)) throw falha(403, 'Confirme seu e-mail para entrar na conta.');
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch (e) { body = {} } }
    body = body && typeof body === 'object' ? body : {};
    const get = req.method === 'GET', acao = get ? (req.query && req.query.acao) : body.acao;
    let r;
    if (get && acao === 'eu') r = await eu(u);
    else if (get && acao === 'painel') { if (!ehAdmin(u)) throw falha(403, 'Só o dono do jogo vê o painel.'); r = await painel() }
    else if (!get && acao === 'entrar') r = await entrar(u, body);
    else if (!get && acao === 'perfil') r = await mudaPerfil(u, body);
    else if (!get && acao === 'foto') r = await mudaFoto(u, body);
    else if (!get && acao === 'resposta') r = await resposta(u, body);
    else if (acao === 'usadas') r = await usadas(u, body, get);
    else if (!get && acao === 'apagar') { await apagar(u); r = { ok: true } }
    else if (!get && acao === 'resolver') { if (!ehAdmin(u)) throw falha(403, 'Só o dono do jogo pode fazer isso.'); r = await resolver(body) }
    else throw falha(400, 'Ação desconhecida.');
    res.status(200).json(r);
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message || 'Erro' });
  }
};
