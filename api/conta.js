// Contas do Arrisca Aí (função da Vercel). Toda chamada precisa do login: "Authorization: Bearer <ID token>".
//   POST {acao:'entrar', nome, cor}      → devolve o perfil (cria na primeira vez) e se a conta é do dono
//   GET  ?acao=eu                        → perfil, estatísticas, conquistas e histórico
//   POST {acao:'perfil', nome, cor}      → muda nome e cor (no ranking também)
//   POST {acao:'resposta', sala, jogo, dev, tk, ok, fim, modo, nj} → registra uma resposta de partida online
//   POST {acao:'vitoria', sala, jogo, dev, tk, modo, nj} → modo equipes: a vitória do time para quem não respondeu a final
//   POST {acao:'sobrevivencia', sala, jogo, dev, qid | fim:true} → uma rodada (ou a vitória) da Sobrevivência relâmpago
//   GET  ?acao=baralho / POST {acao:'baralho', op:'salva'|'apaga', ...} → perguntas da turma (tema "Turma", sem ranking)
//   POST {acao:'apagar'}                 → apaga os dados da conta guardados no banco
//   GET  ?acao=desafio / POST {acao:'desafio', dia, resp, fim, hist} → desafio do dia guardado na conta
//   GET  ?acao=painel                    → (só o dono) bugs, perguntas reportadas e perguntas com mais 👎
//   POST {acao:'resolver', lista, id, resolvido} → (só o dono) marca um aviso como resolvido
const { quemE, ehAdmin } = require('./_auth');
const { limpa: semPalavrao, tem: temPalavrao } = require('./_palavrao');
const { DEV, ler, grava, gravaVarios, lerEtag, gravaSe } = require('./_store');
const ST = require('./_stats');
const { freia } = require('./_limite');
const temaOk = t => typeof t === 'string' && (Object.prototype.hasOwnProperty.call(ST.TEMAS, t) || t === 'N'); // N: Natal

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
  return { nome: p.nome || '', cor: p.cor || null, titulo: p.titulo || '', foto: p.foto || null, criado: p.criado || '', id: /^\d{8}$/.test(p.id || '') ? p.id : null, email: u.email, verificado: u.verificado, provedor: u.provedor };
}

async function entrar(u, body) {
  const caminho = 'usuarios/' + u.uid + '/perfil';
  let p = await ler(caminho);
  if (!p || typeof p !== 'object') {
    const nome = semPalavrao(txt(body.nome, 16) || txt(u.nome, 16) || txt((u.email || '').split('@')[0], 16) || 'Jogador');
    p = { nome, cor: corOk(body.cor), criado: new Date().toISOString(), provedor: txt(u.provedor, 20) };
    await grava('PUT', caminho, p);
  }
  // ID público de 8 números (para os amigos acharem a conta sem ver o e-mail)
  if (!/^\d{8}$/.test(p.id || '')) p.id = await require('./amigos.js').garanteId(u.uid, p);
  return { perfil: perfilPublico(p, u), admin: ehAdmin(u) };
}

async function mudaPerfil(u, body) {
  const base = 'usuarios/' + u.uid;
  const muda = {};
  if (body.nome !== undefined) { const n = txt(body.nome, 16); if (!n) throw falha(400, 'Escolha um nome.'); if (temPalavrao(n)) throw falha(400, 'Esse nome não pode. Escolha outro.'); muda.nome = n }
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
    eventos: ST.eventosLista(s),
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
  if (info.t === 'F') return { ja: true, turma: true }; // perguntas da turma não valem ranking
  if (info.e < Date.now() - 6 * 3600e3) throw falha(400, 'Essa pergunta já é antiga.');
  const sala = info.s;
  if (body.sala && body.sala !== sala) throw falha(400, 'A pergunta é de outra sala.');
  const jogo = String(body.jogo || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'x';
  const ok = !!body.ok, dev = String(body.dev || '').slice(0, 40);
  const base = 'usuarios/' + u.uid, regC = 'srv/reg/' + sala + '/' + info.qid, chave = sala + '_' + jogo;
  const [dono, reg, st, conq, part0, perfil, estado, jogadores, rr] = await Promise.all([
    ler('srv/contas/' + sala + '/' + dev),
    lerEtag(regC), ler(base + '/stats'), ler(base + '/conquistas'), ler(base + '/partidas/' + chave), ler(base + '/perfil'),
    DEV ? null : ler('salas/' + sala + '/estado'), DEV ? null : ler('salas/' + sala + '/jogadores'), ler('srv/resp/' + sala + '/' + info.qid)
  ]);
  // a resposta tem que ser do aparelho em que esta conta está (gravado pelo servidor quando ela entrou na sala)
  if (dono !== u.uid) throw falha(403, 'Essa resposta é de outro jogador.');
  if (reg.v) return { ja: true };
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
  if (!part) { ST.novaPartida(s, agora); part = { sala, inicio: quando, a: 0, e: 0, p: 0, venceu: false, modo: txt(body.modo, 12), nj: Math.max(2, Math.min(10, +body.nj || 2)) } }
  const pts = ST.aplica(s, { ok, nivel, tema: info.t, fim, agora });
  if (ok) part.a++; else part.e++;
  part.p += pts; part.fim = quando; if (fim) part.venceu = true;
  const ganhou = ST.novas(s, conq || {});
  // marca a pergunta como contada só se ninguém marcou no meio (duas chamadas ao mesmo tempo não contam duas vezes)
  if (!(await gravaSe(regC, { u: u.uid, ok, n: nivel, w: agora }, reg.etag))) return { ja: true };
  await gravaVarios(mapaPontos(u, s, part, chave, perfil, ganhou, agora));
  return { pts, nivel, fim, total: s.p, semana: s.sem.p, novas: ganhou.map(c => ({ id: c.id, e: c.e, n: c.n, nivel: c.nivel })) };
}
// estatísticas, partida, ranking da semana e do mês e conquistas novas, gravados juntos
function mapaPontos(u, s, part, chave, perfil, ganhou, agora) {
  const base = 'usuarios/' + u.uid, quando = new Date(agora).toISOString();
  const per = ST.periodo(agora), t = perfil.titulo ? ST.titulo(perfil.titulo, s, u.uid) : null;
  const mapa = {
    [base + '/stats']: s,
    [base + '/partidas/' + chave]: part
  };
  if (s.sem.p > 0) { mapa['ranking/semana/' + per.semana + '/' + u.uid] = linhaRanking(s.sem.p, perfil, t); mapa[base + '/rk/semana_' + per.semana] = true }
  if (s.mes.p > 0) { mapa['ranking/mes/' + per.mes + '/' + u.uid] = linhaRanking(s.mes.p, perfil, t); mapa[base + '/rk/mes_' + per.mes] = true }
  ganhou.forEach(c => { mapa[base + '/conquistas/' + c.id] = quando });
  return mapa;
}

// modo equipes: quem não respondeu a pergunta final também leva a vitória do time (+10 e a vitória na conta).
// Vale só se o juiz da sala registrou o aparelho no time que venceu (srv/resp/…/eq).
async function vitoriaTime(u, body) {
  if (!emailOk(u)) throw falha(403, 'Confirme seu e-mail para suas partidas contarem no ranking.');
  const info = await require('./perguntas.js')._infoTk(body.tk);
  if (!info || info.m !== 'o' || !info.s) throw falha(400, 'Só partidas online contam.');
  if (info.e < Date.now() - 6 * 3600e3) throw falha(400, 'Essa pergunta já é antiga.');
  const sala = info.s;
  if (body.sala && body.sala !== sala) throw falha(400, 'A pergunta é de outra sala.');
  const jogo = String(body.jogo || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'x';
  const dev = String(body.dev || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!dev) throw falha(400, 'Aparelho inválido.');
  const base = 'usuarios/' + u.uid, regV = 'srv/regv/' + sala + '/' + info.qid + '/' + dev, chave = sala + '_' + jogo;
  const [dono, reg, st, conq, part0, perfil, rr] = await Promise.all([
    ler('srv/contas/' + sala + '/' + dev), lerEtag(regV), ler(base + '/stats'), ler(base + '/conquistas'), ler(base + '/partidas/' + chave), ler(base + '/perfil'),
    ler('srv/resp/' + sala + '/' + info.qid)
  ]);
  if (dono !== u.uid) throw falha(403, 'Essa vitória é de outro jogador.');
  if (reg.v || info.t === 'F' || (rr && rr.t === 'F')) return { ja: true }; // vitória numa pergunta da turma não vale ranking
  if (!perfil) throw falha(404, 'Conta não encontrada. Entre de novo.');
  if (!rr || !rr.ok || !rr.fim || !Array.isArray(rr.eq) || !rr.eq.includes(dev) || (rr.jogo || 'x') !== jogo) throw falha(400, 'Essa vitória não confere com a sala.');
  const s = ST.normaliza(st), agora = Date.now();
  let part = part0 && typeof part0 === 'object' ? part0 : null;
  if (!part) { ST.novaPartida(s, agora); part = { sala, inicio: new Date(agora).toISOString(), a: 0, e: 0, p: 0, venceu: false, modo: txt(body.modo, 12), nj: Math.max(2, Math.min(10, +body.nj || 2)) } }
  const pts = ST.vitoria(s, agora);
  part.p += pts; part.fim = new Date(agora).toISOString(); part.venceu = true;
  const ganhou = ST.novas(s, conq || {});
  if (!(await gravaSe(regV, { u: u.uid, w: agora }, reg.etag))) return { ja: true };
  await gravaVarios(mapaPontos(u, s, part, chave, perfil, ganhou, agora));
  return { pts, fim: true, total: s.p, semana: s.sem.p, novas: ganhou.map(c => ({ id: c.id, e: c.e, n: c.n, nivel: c.nivel })) };
}

// Sobrevivência relâmpago: cada rodada conta como uma resposta (acertou ou não, no nível da pergunta) e quem vence leva a vitória.
// Vale só o que o servidor da sala registrou ao fechar a rodada (srv/svreg/<sala>/<qid>) e no fim (srv/svfim/<sala>/<jogo>);
// cada aparelho conta uma vez por pergunta (srv/regs/<sala>/<qid>/<aparelho>).
async function sobrevivencia(u, body) {
  if (!emailOk(u)) throw falha(403, 'Confirme seu e-mail para suas partidas contarem no ranking.');
  const id = s => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  const sala = String(body.sala || '').toUpperCase(), jogo = id(body.jogo).slice(0, 24), dev = id(body.dev), fim = body.fim === true;
  const qid = fim ? 'fim_' + jogo : String(body.qid || '');
  if (!/^[A-Z0-9]{4,6}$/.test(sala) || !jogo || !dev || !/^[a-z0-9_]{1,40}$/.test(qid)) throw falha(400, 'Rodada inválida.');
  const base = 'usuarios/' + u.uid, regC = 'srv/regs/' + sala + '/' + qid + '/' + dev, chave = sala + '_' + jogo;
  const [dono, reg, st, conq, part0, perfil, rr] = await Promise.all([
    ler('srv/contas/' + sala + '/' + dev), lerEtag(regC), ler(base + '/stats'), ler(base + '/conquistas'), ler(base + '/partidas/' + chave), ler(base + '/perfil'),
    ler(fim ? 'srv/svfim/' + sala + '/' + jogo : 'srv/svreg/' + sala + '/' + qid)
  ]);
  if (dono !== u.uid) throw falha(403, 'Essa rodada é de outro jogador.');
  if (reg.v) return { ja: true };
  if (!perfil) throw falha(404, 'Conta não encontrada. Entre de novo.');
  if (!rr || typeof rr !== 'object' || (!fim && rr.jogo !== jogo) || !(+rr.w > Date.now() - 6 * 3600e3)) throw falha(400, 'Essa rodada não foi registrada pela sala.');
  if ((+rr.nj || 0) < 2) throw falha(400, 'Só contam salas com 2 jogadores ou mais.');
  const venceu = fim && Array.isArray(rr.v) && rr.v.includes(dev);
  if (fim && !venceu) throw falha(400, 'Essa vitória não confere com a sala.');
  if (!fim && !(rr.r && (rr.r[dev] === 0 || rr.r[dev] === 1))) throw falha(400, 'Você não estava nessa rodada.');
  const s = ST.normaliza(st), agora = Date.now();
  if (!fim && s.dia.id === ST.periodo().dia && s.dia.n >= LIMITE_DIA) throw falha(429, 'Limite de respostas de hoje.');
  let part = part0 && typeof part0 === 'object' ? part0 : null;
  if (!part) { ST.novaPartida(s, agora); part = { sala, inicio: new Date(agora).toISOString(), a: 0, e: 0, p: 0, venceu: false, modo: 'sobrevivencia', nj: Math.max(2, Math.min(10, +rr.nj || 2)) } }
  let pts, ok = null;
  if (fim) { pts = ST.vitoria(s, agora); part.venceu = true }
  else {
    ok = rr.r[dev] === 1;
    const nivel = Math.min(4, Math.max(1, +rr.nv || 2));
    pts = ST.aplica(s, { ok, nivel, tema: temaOk(rr.t) ? rr.t : 'V', fim: false, agora });
    if (ok) part.a++; else part.e++;
  }
  part.p += pts; part.fim = new Date(agora).toISOString();
  const ganhou = ST.novas(s, conq || {});
  if (!(await gravaSe(regC, { u: u.uid, w: agora }, reg.etag))) return { ja: true };
  await gravaVarios(mapaPontos(u, s, part, chave, perfil, ganhou, agora));
  return { pts, ok, fim, total: s.p, semana: s.sem.p, novas: ganhou.map(c => ({ id: c.id, e: c.e, n: c.n, nivel: c.nivel })) };
}

// Perguntas da turma: o baralho da conta (só o dono vê as respostas aqui). Vira o tema "Turma" nas salas de quem escreveu.
// Cada pergunta: q (texto), a (resposta), e (3 alternativas erradas, opcional: com elas vira múltipla escolha), nv (nível 1 a 4).
const BARALHO_MAX = 300, ID_B = /^f[0-9a-f]{10}$/;
const normB = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
async function baralho(u, body, get) {
  const base = 'usuarios/' + u.uid + '/baralho';
  const atual = (await ler(base)) || {};
  const lista = () => Object.entries(atual).filter(([id, x]) => ID_B.test(id) && x && typeof x === 'object')
    .map(([id, x]) => ({ id, q: x.q, a: x.a, e: Array.isArray(x.e) ? x.e : null, nv: x.nv || 2, ts: +x.ts || 0 })).sort((a, b) => a.ts - b.ts);
  if (get) return { lista: lista(), max: BARALHO_MAX };
  if (body.op === 'apaga') {
    const id = String(body.id || '');
    if (!ID_B.test(id) || !atual[id]) throw falha(404, 'Essa pergunta não existe mais.');
    await grava('PUT', base + '/' + id, null); delete atual[id];
    return { lista: lista(), max: BARALHO_MAX };
  }
  if (body.op !== 'salva') throw falha(400, 'Ação desconhecida.');
  const q = txt(body.q, 200), a = txt(body.a, 80), nv = [1, 2, 3, 4].includes(+body.nv) ? +body.nv : 2;
  if (q.length < 5) throw falha(400, 'Escreva a pergunta.');
  if (!a) throw falha(400, 'Escreva a resposta.');
  const e = (Array.isArray(body.e) ? body.e : []).slice(0, 3).map(x => txt(x, 80)).filter(Boolean);
  if (e.length && e.length !== 3) throw falha(400, 'Para virar múltipla escolha, escreva as 3 alternativas erradas (ou deixe as 3 em branco).');
  if (e.length && new Set([a, ...e].map(normB)).size !== 4) throw falha(400, 'As alternativas precisam ser diferentes da resposta e entre si.');
  let id = body.id ? String(body.id) : null;
  if (id && (!ID_B.test(id) || !atual[id])) throw falha(404, 'Essa pergunta não existe mais.');
  if (!id) {
    if (Object.keys(atual).length >= BARALHO_MAX) throw falha(400, 'Seu baralho já tem ' + BARALHO_MAX + ' perguntas.');
    id = 'f' + require('crypto').randomBytes(5).toString('hex');
  }
  const x = { q, a, nv, ts: atual[id] ? +atual[id].ts || Date.now() : Date.now() };
  if (e.length) x.e = e;
  await grava('PUT', base + '/' + id, x); atual[id] = x;
  return { lista: lista(), max: BARALHO_MAX, id };
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
    if (!temaOk(t) || !Array.isArray(ids)) return;
    const st = new Set(String(atual[t] || '').split(' ').filter(Boolean));
    const antes = st.size;
    ids.slice(0, MAX_T).forEach(id => { if (typeof id === 'string' && ID_Q.test(id)) st.add(id) });
    if (st.size !== antes) mapa[base + '/' + t] = [...st].slice(-MAX_T).join(' ');
  });
  // liberar um tema (quando as perguntas dele acabaram e a pessoa aprovou começar de novo)
  (Array.isArray(body.limpa) ? body.limpa : []).forEach(t => {
    if (!temaOk(t)) return;
    const tira = Array.isArray(body.tira && body.tira[t]) ? new Set(body.tira[t]) : null;
    if (!tira) { mapa[base + '/' + t] = null; return }
    mapa[base + '/' + t] = String(atual[t] || '').split(' ').filter(id => id && !tira.has(id)).join(' ') || null;
  });
  await gravaVarios(mapa);
  return { ok: true, mudou: Object.keys(mapa).length };
}

// desafio do dia na conta, para valer em qualquer aparelho: o progresso de hoje (e de ontem, para quem
// começou antes da meia-noite) e quantas acertou em cada dia, para a sequência. Sem ranking: o que vem do
// aparelho só é conferido no formato. Resposta já dada não muda: fica a que chegou primeiro.
const DIA_OK = /^\d{4}-\d{2}-\d{2}$/;
const parDe = s => String(s || '').match(/[0-3]{2}/g) || [];
async function desafio(u, body, get) {
  const base = 'usuarios/' + u.uid + '/desafio';
  const atual = (await ler(base)) || {};
  const hist = atual.hist && typeof atual.hist === 'object' ? atual.hist : {};
  const dias = atual.dias && typeof atual.dias === 'object' ? atual.dias : {};
  const hoje = ST.periodo().dia, ontem = ST.periodo(Date.now() - 864e5).dia;
  if (get) return { hist, dias, hoje };
  const mapa = {};
  const d = body.dia;
  if ((d === hoje || d === ontem) && Array.isArray(body.resp) && body.resp.length <= 12) {
    const novas = body.resp.map(r => Array.isArray(r) && r.length === 2 && [0, 1, 2, 3].includes(r[0]) && [0, 1, 2, 3].includes(r[1]) ? '' + r[0] + r[1] : null);
    if (novas.every(Boolean)) {
      const ant = parDe(dias[d] && dias[d].r), r = ant.concat(novas.slice(ant.length)), fim = !!(dias[d] && dias[d].fim) || body.fim === true;
      if (r.length !== ant.length || fim !== !!(dias[d] && dias[d].fim)) {
        dias[d] = { r: r.join(''), fim };
        mapa[base + '/dias/' + d] = dias[d];
      }
      if (fim) { const ac = r.filter(x => x[0] === x[1]).length; if (hist[d] !== ac) { hist[d] = ac; mapa[base + '/hist/' + d] = ac } }
    }
  }
  // dias jogados em outro aparelho, antes de entrar na conta
  if (body.hist && typeof body.hist === 'object') Object.entries(body.hist).slice(-400).forEach(([k, v]) => {
    const n = Math.floor(+v);
    if (!DIA_OK.test(k) || k > hoje || !(n >= 0 && n <= 12) || k in hist) return;
    hist[k] = n; mapa[base + '/hist/' + k] = n;
  });
  Object.keys(dias).forEach(k => { if (k < ontem) { delete dias[k]; mapa[base + '/dias/' + k] = null } }); // só hoje e ontem
  if (Object.keys(mapa).length) await gravaVarios(mapa);
  return { hist, dias, hoje };
}

async function apagar(u) {
  const base = 'usuarios/' + u.uid;
  const rk = await ler(base + '/rk');
  const mapa = Object.assign(await require('./amigos.js').apagaDe(u.uid), { [base]: null }); // some da lista dos amigos e libera o ID
  Object.keys(rk || {}).forEach(k => { const m = /^(semana|mes)_([-A-Za-z0-9]+)$/.exec(k); if (m) mapa['ranking/' + m[1] + '/' + m[2] + '/' + u.uid] = null });
  await gravaVarios(mapa);
}

function lista(obj) {
  return Object.entries(obj || {}).filter(([, v]) => v && typeof v === 'object').map(([id, v]) => Object.assign({}, v, { _id: id }))
    .sort((a, b) => String(b.quando || '').localeCompare(String(a.quando || ''))).slice(0, LIMITE_LISTA);
}
async function painel() {
  const q = 'orderBy=' + encodeURIComponent('"$key"') + '&limitToLast=' + LIMITE_LISTA;
  const [bugs, reportes, notas] = await Promise.all([DEV ? bugsDev() : ler('bugs', q), ler('reportes', DEV ? '' : q), ler('notas')]);
  return { bugs: lista(bugs), reportes: lista(reportes), notas: await notasPiores(notas) };
}
// 👍/👎 das perguntas: as que mais levaram 👎 primeiro (só as que têm pelo menos um 👎)
async function notasPiores(notas) {
  const P = require('./perguntas.js'), out = [];
  let votos = 0, bons = 0;
  Object.entries(notas || {}).forEach(([t, porId]) => Object.entries(porId || {}).forEach(([id, vs]) => {
    let b = 0, r = 0;
    Object.values(vs || {}).forEach(v => { if (v === 1) b++; else if (v === -1) r++ });
    votos += b + r; bons += b;
    if (r) out.push({ t, id, b, r });
  }));
  out.sort((x, y) => (y.r - y.b) - (x.r - x.b) || y.r - x.r);
  const top = out.slice(0, 60);
  await Promise.all(top.map(async x => { try { Object.assign(x, await P._pergId(x.t, x.id) || { sumiu: true }) } catch (e) { x.sumiu = true } }));
  return { votos, bons, lista: top };
}
async function resolver(body) {
  if (body.lista === 'notas') { // pergunta arrumada: zera as notas dela
    const [t, id] = String(body.id || '').split('|');
    if (!/^[A-Z]{1,3}$/.test(t || '') || !/^[a-z0-9]{1,20}$/.test(id || '')) throw falha(400, 'Pergunta inválida.');
    await grava('PUT', 'notas/' + t + '/' + id, null);
    return { ok: true };
  }
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
    freia(req, 'conta', 600, 600e3);
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
    else if (!get && acao === 'vitoria') r = await vitoriaTime(u, body);
    else if (!get && acao === 'sobrevivencia') r = await sobrevivencia(u, body);
    else if (acao === 'baralho') r = await baralho(u, body, get);
    else if (acao === 'usadas') r = await usadas(u, body, get);
    else if (acao === 'desafio') r = await desafio(u, body, get);
    else if (!get && acao === 'apagar') { await apagar(u); r = { ok: true } }
    else if (!get && acao === 'revisao') { if (!ehAdmin(u)) throw falha(403, 'Só o dono do jogo pode fazer isso.'); r = await require('./_revisao').revisa() }
    else if (!get && acao === 'resolver') { if (!ehAdmin(u)) throw falha(403, 'Só o dono do jogo pode fazer isso.'); r = await resolver(body) }
    else throw falha(400, 'Ação desconhecida.');
    res.status(200).json(r);
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message || 'Erro' });
  }
};
module.exports.notasPiores = notasPiores; // a cópia para revisão (_revisao.js) usa a mesma lista do painel
