// Amigos do Arrisca Aí (função da Vercel). Toda chamada precisa do login: "Authorization: Bearer <ID token>".
// Cada conta tem um ID público de 8 números; o e-mail nunca aparece para os outros.
//   GET  ?acao=lista[&sala=XXXX]   amigos (com quem está online), pedidos, enviados e convites; também marca "estou online"
//   POST {acao:'quem', id}          nome e foto de um ID (para confirmar antes de mandar o pedido)
//   POST {acao:'pedir', id}         manda pedido de amizade (se a pessoa já tinha pedido, viram amigos na hora)
//   POST {acao:'aceitar'|'recusar'|'cancelar'|'remover', id}
//   POST {acao:'convidar', id, sala} chama um amigo para a sala
//   POST {acao:'dispensar', id}     tira o aviso de convite
//   GET  ?acao=perfil&id=           perfil de um amigo (estatísticas e conquistas)
//   GET  ?acao=ranking&periodo=semana|mes   ranking só com você e seus amigos
// Tudo fica em /usuarios e /ids, que só o servidor lê e grava.
const crypto = require('crypto');
const { quemE } = require('./_auth');
const { ler, gravaVarios } = require('./_store');
const ST = require('./_stats');
const { freia } = require('./_limite');

const MAX_AMIGOS = 200, MAX_ENVIADOS = 30, MAX_PEDIDOS = 100;
const ONLINE = 90 * 1000, CONVITE = 15 * 60 * 1000;
const ID_RE = /^\d{8}$/, SALA_RE = /^[A-Z0-9]{4,6}$/, UID_RE = /^[-A-Za-z0-9_]{1,128}$/;
const falha = (status, m) => Object.assign(new Error(m), { status });
const emailOk = u => !!u && (u.verificado || u.provedor === 'google.com');
const fotoMini = f => typeof f === 'string' && f.length <= 12000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(f) ? f : null;
const fotoGrande = f => typeof f === 'string' && f.length <= 60000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(f) ? f : null;
const corOk = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
const chaves = o => Object.keys(o && typeof o === 'object' ? o : {}).filter(k => UID_RE.test(k));
const limpaId = x => String(x == null ? '' : x).replace(/\D/g, '');

// ID de 8 números da conta (criado na primeira vez e fixo para sempre)
async function garanteId(uid, perfil) {
  if (perfil && ID_RE.test(perfil.id || '')) return perfil.id;
  for (let i = 0; i < 12; i++) {
    const id = String(crypto.randomInt(10000000, 100000000));
    if (await ler('ids/' + id)) continue;
    await gravaVarios({ ['ids/' + id]: uid, ['usuarios/' + uid + '/perfil/id']: id });
    return id;
  }
  throw falha(503, 'Não consegui criar seu ID agora. Tente de novo.');
}
async function uidDoId(id) {
  id = limpaId(id);
  if (!ID_RE.test(id)) throw falha(400, 'O ID tem 8 números. Confira e tente de novo.');
  const uid = await ler('ids/' + id);
  if (!uid || typeof uid !== 'string') throw falha(404, 'Não achei ninguém com esse ID. Confira os números.');
  return uid;
}
// o que os amigos veem de uma conta (nunca o e-mail)
async function publico(uid, comVisto) {
  const [p, st, visto] = await Promise.all([ler('usuarios/' + uid + '/perfil'), ler('usuarios/' + uid + '/stats'), comVisto ? ler('usuarios/' + uid + '/visto') : null]);
  if (!p) return null;
  const t = p.titulo ? ST.titulo(p.titulo, st, uid) : null;
  const o = { id: ID_RE.test(p.id || '') ? p.id : null, nome: String(p.nome || 'Jogador').slice(0, 16), cor: corOk(p.cor), f: fotoMini(p.mini), t: t ? { x: t.x, n: t.n } : null };
  if (comVisto) {
    const ts = visto && +visto.ts || 0, on = Date.now() - ts < ONLINE;
    o.on = on; o.visto = ts || null;
    o.sala = on && visto && SALA_RE.test(visto.sala || '') ? visto.sala : null;
  }
  return o;
}

async function lista(u, q) {
  const base = 'usuarios/' + u.uid;
  const [perfil, amigos, pedidos, enviados, convites] = await Promise.all([
    ler(base + '/perfil'), ler(base + '/amigos'), ler(base + '/pedidos'), ler(base + '/enviados'), ler(base + '/convites')]);
  if (!perfil) throw falha(404, 'Conta não encontrada. Entre de novo.');
  const id = await garanteId(u.uid, perfil);
  // "estou online" (e em qual sala, para os amigos poderem entrar)
  const sala = SALA_RE.test(String(q.sala || '')) ? q.sala : null;
  const agora = Date.now(), mapa = { [base + '/visto']: { ts: agora, sala } };
  const conv = Object.entries(convites || {}).filter(([k, v]) => UID_RE.test(k) && v && agora - (+v.quando || 0) < CONVITE && SALA_RE.test(v.sala || ''));
  Object.keys(convites || {}).forEach(k => { if (!conv.some(([c]) => c === k)) mapa[base + '/convites/' + k] = null }); // convites vencidos
  await gravaVarios(mapa);
  const [la, lp, le, lc] = await Promise.all([
    Promise.all(chaves(amigos).map(x => publico(x, true))),
    Promise.all(chaves(pedidos).map(x => publico(x).then(o => o && Object.assign(o, { quando: (pedidos[x] || {}).quando || null })))),
    Promise.all(chaves(enviados).map(x => publico(x))),
    Promise.all(conv.map(([x, v]) => publico(x).then(o => o && Object.assign(o, { sala: v.sala, quando: +v.quando || 0 }))))
  ]);
  const ok = a => a.filter(o => o && o.id);
  return {
    id,
    amigos: ok(la).sort((a, b) => (b.on - a.on) || (!!b.sala - !!a.sala) || a.nome.localeCompare(b.nome)),
    pedidos: ok(lp), enviados: ok(le), convites: ok(lc).sort((a, b) => b.quando - a.quando)
  };
}

async function quem(u, body) {
  const alvo = await uidDoId(body.id);
  const o = await publico(alvo);
  if (!o) throw falha(404, 'Não achei ninguém com esse ID. Confira os números.');
  const base = 'usuarios/' + u.uid;
  const [am, env, rec] = await Promise.all([ler(base + '/amigos/' + alvo), ler(base + '/enviados/' + alvo), ler(base + '/pedidos/' + alvo)]);
  return Object.assign(o, { eu: alvo === u.uid, amigo: !!am, pedido: env ? 'enviado' : rec ? 'recebido' : null });
}

async function viramAmigos(a, b) {
  const quando = new Date().toISOString();
  await gravaVarios({
    ['usuarios/' + a + '/amigos/' + b]: { desde: quando }, ['usuarios/' + b + '/amigos/' + a]: { desde: quando },
    ['usuarios/' + a + '/pedidos/' + b]: null, ['usuarios/' + b + '/pedidos/' + a]: null,
    ['usuarios/' + a + '/enviados/' + b]: null, ['usuarios/' + b + '/enviados/' + a]: null
  });
}

async function pedir(u, body) {
  const alvo = await uidDoId(body.id);
  if (alvo === u.uid) throw falha(400, 'Esse é o seu próprio ID. Peça o ID do seu amigo.');
  const eu = 'usuarios/' + u.uid, ele = 'usuarios/' + alvo;
  const [perfilAlvo, ja, recebi, meus, enviados, pedidosDele] = await Promise.all([
    ler(ele + '/perfil'), ler(eu + '/amigos/' + alvo), ler(eu + '/pedidos/' + alvo), ler(eu + '/amigos'), ler(eu + '/enviados'), ler(ele + '/pedidos')]);
  if (!perfilAlvo) throw falha(404, 'Não achei ninguém com esse ID. Confira os números.');
  if (ja) return { estado: 'amigos' };
  if (chaves(meus).length >= MAX_AMIGOS) throw falha(400, 'Você chegou ao limite de ' + MAX_AMIGOS + ' amigos.');
  if (recebi) { await viramAmigos(u.uid, alvo); return { estado: 'amigos' } } // a pessoa já tinha pedido: viram amigos
  if (chaves(enviados).length >= MAX_ENVIADOS && !(enviados || {})[alvo]) throw falha(400, 'Você tem muitos pedidos esperando resposta. Cancele alguns antes.');
  if (chaves(pedidosDele).length >= MAX_PEDIDOS) throw falha(400, 'Essa pessoa tem pedidos demais esperando. Tente mais tarde.');
  const quando = new Date().toISOString();
  await gravaVarios({ [ele + '/pedidos/' + u.uid]: { quando }, [eu + '/enviados/' + alvo]: { quando } });
  return { estado: 'enviado' };
}
async function aceitar(u, body) {
  const alvo = await uidDoId(body.id);
  if (!(await ler('usuarios/' + u.uid + '/pedidos/' + alvo))) throw falha(404, 'Esse pedido não existe mais.');
  if (chaves(await ler('usuarios/' + u.uid + '/amigos')).length >= MAX_AMIGOS) throw falha(400, 'Você chegou ao limite de ' + MAX_AMIGOS + ' amigos.');
  await viramAmigos(u.uid, alvo);
  return { estado: 'amigos' };
}
async function desfaz(u, body, tipo) { // recusar, cancelar ou remover
  const alvo = await uidDoId(body.id), eu = 'usuarios/' + u.uid + '/', ele = 'usuarios/' + alvo + '/';
  const mapa = tipo === 'recusar' ? { [eu + 'pedidos/' + alvo]: null, [ele + 'enviados/' + u.uid]: null }
    : tipo === 'cancelar' ? { [eu + 'enviados/' + alvo]: null, [ele + 'pedidos/' + u.uid]: null }
    : { [eu + 'amigos/' + alvo]: null, [ele + 'amigos/' + u.uid]: null, [eu + 'convites/' + alvo]: null, [ele + 'convites/' + u.uid]: null };
  await gravaVarios(mapa);
  return { ok: true };
}
async function convidar(u, body) {
  const alvo = await uidDoId(body.id), sala = String(body.sala || '').toUpperCase();
  if (!SALA_RE.test(sala)) throw falha(400, 'Sala inválida.');
  const [amigo, meta] = await Promise.all([ler('usuarios/' + u.uid + '/amigos/' + alvo), ler('salas/' + sala + '/meta')]);
  if (!amigo) throw falha(403, 'Só dá para chamar quem é seu amigo.');
  if (!meta && !process.env.ARRISCA_DEV_SALAS) throw falha(404, 'Essa sala não existe mais.');
  await gravaVarios({ ['usuarios/' + alvo + '/convites/' + u.uid]: { sala, quando: Date.now() } });
  return { ok: true };
}
async function dispensar(u, body) {
  const alvo = await uidDoId(body.id);
  await gravaVarios({ ['usuarios/' + u.uid + '/convites/' + alvo]: null });
  return { ok: true };
}

async function perfilAmigo(u, q) {
  const alvo = await uidDoId(q.id);
  if (alvo !== u.uid && !(await ler('usuarios/' + u.uid + '/amigos/' + alvo))) throw falha(403, 'Só dá para ver o perfil dos seus amigos.');
  const base = 'usuarios/' + alvo;
  const [p, st, conq, desde] = await Promise.all([ler(base + '/perfil'), ler(base + '/stats'), ler(base + '/conquistas'), ler('usuarios/' + u.uid + '/amigos/' + alvo)]);
  if (!p) throw falha(404, 'Essa conta não existe mais.');
  const s = ST.normaliza(st), per = ST.periodo(), pub = await publico(alvo, true);
  return Object.assign(pub, {
    foto: fotoGrande(p.foto), desde: desde && desde.desde || null,
    stats: { p: s.p, a: s.a, e: s.e, v: s.v, np: s.np, maxSeq: s.maxSeq, tema: s.tema, semana: s.sem.id === per.semana ? s.sem.p : 0, mes: s.mes.id === per.mes ? s.mes.p : 0 },
    conquistas: ST.conquistasLista(s, conq || {})
  });
}

async function ranking(u, q) {
  const periodo = q.periodo === 'mes' ? 'mes' : 'semana', per = ST.periodo();
  const amigos = chaves(await ler('usuarios/' + u.uid + '/amigos'));
  const linhas = await Promise.all([u.uid].concat(amigos).map(async uid => {
    const [p, st] = await Promise.all([ler('usuarios/' + uid + '/perfil'), ler('usuarios/' + uid + '/stats')]);
    if (!p) return null;
    const s = ST.normaliza(st), pts = periodo === 'semana' ? (s.sem.id === per.semana ? s.sem.p : 0) : (s.mes.id === per.mes ? s.mes.p : 0);
    const t = p.titulo ? ST.titulo(p.titulo, s, uid) : null;
    return { id: ID_RE.test(p.id || '') ? p.id : null, n: String(p.nome || 'Jogador').slice(0, 16), c: corOk(p.cor), f: fotoMini(p.mini), t: t ? { x: t.x, n: t.n } : null, p: Math.floor(pts), eu: uid === u.uid };
  }));
  const l = linhas.filter(Boolean).sort((a, b) => b.p - a.p || a.n.localeCompare(b.n));
  let pos = 0;
  l.forEach((x, i) => { if (i > 0 && x.p < l[i - 1].p) pos = i; x.pos = pos + 1 });
  return { periodo, lista: l, amigos: amigos.length };
}

// ao apagar a conta: some das listas dos amigos e libera o ID
async function apagaDe(uid) {
  const base = 'usuarios/' + uid;
  const [p, am, pe, en, co] = await Promise.all([ler(base + '/perfil'), ler(base + '/amigos'), ler(base + '/pedidos'), ler(base + '/enviados'), ler(base + '/convites')]);
  const mapa = {};
  chaves(am).forEach(x => { mapa['usuarios/' + x + '/amigos/' + uid] = null; mapa['usuarios/' + x + '/convites/' + uid] = null });
  chaves(pe).forEach(x => { mapa['usuarios/' + x + '/enviados/' + uid] = null });
  chaves(en).forEach(x => { mapa['usuarios/' + x + '/pedidos/' + uid] = null });
  if (p && ID_RE.test(p.id || '')) mapa['ids/' + p.id] = null;
  return mapa;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch (e) { body = {} } }
    body = body && typeof body === 'object' ? body : {};
    const get = req.method === 'GET', q = req.query || {}, acao = get ? q.acao : body.acao;
    freia(req, acao === 'quem' ? 'amigos-quem' : 'amigos', acao === 'quem' ? 80 : 800, 600e3);
    const u = await quemE(req);
    if (!UID_RE.test(u.uid)) throw falha(400, 'Conta inválida.');
    if (!emailOk(u)) throw falha(403, 'Confirme seu e-mail para usar os amigos.');
    let r;
    if (get && acao === 'lista') r = await lista(u, q);
    else if (get && acao === 'perfil') r = await perfilAmigo(u, q);
    else if (get && acao === 'ranking') r = await ranking(u, q);
    else if (!get && acao === 'quem') r = await quem(u, body);
    else if (!get && acao === 'pedir') r = await pedir(u, body);
    else if (!get && acao === 'aceitar') r = await aceitar(u, body);
    else if (!get && ['recusar', 'cancelar', 'remover'].includes(acao)) r = await desfaz(u, body, acao);
    else if (!get && acao === 'convidar') r = await convidar(u, body);
    else if (!get && acao === 'dispensar') r = await dispensar(u, body);
    else throw falha(400, 'Ação desconhecida.');
    res.status(200).json(r);
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message || 'Erro' });
  }
};
module.exports.garanteId = garanteId;
module.exports.apagaDe = apagaDe;
