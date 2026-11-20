// Juiz da sala online.
// Cada mudança no estado da sala passa por aqui antes de ser gravada: o servidor compara o estado anterior com o
// novo e só aceita se for uma jogada possível, feita por quem pode fazê-la. Assim ninguém vence pelo console,
// anda casas que não ganhou, troca o nível da pergunta ou finge que a turma aceitou a resposta.
// Arquivo com "_" no começo: a Vercel não publica como rota.

const TEMAS = ['M', 'H', 'AL', 'MU', 'CS', 'S', 'CT', 'TI', 'ES', 'GG', 'V'];
const TAMANHOS = { curto: 30, normal: 40, longo: 50 };
const MODOS = ['classico', 'bonus', 'arriscado'];
const MAXJ = 10;

const nao = motivo => ({ ok: false, motivo });
const sim = extra => Object.assign({ ok: true }, extra || {});
const J = x => JSON.stringify(x === undefined ? null : x);
const igual = (a, b) => J(a) === J(b);
const num = x => (x === null || x === undefined || x === '') ? null : Number(x);

function nf(g) { const f = +g.fichas; return [5, 6, 7].includes(f) ? f : 5 }
function modo(g) { return g.modo === 'semdo' ? 'arriscado' : MODOS.includes(g.modo) ? g.modo : 'classico' }
const bonusOn = g => modo(g) !== 'classico';
const dobroOn = g => modo(g) === 'arriscado';
const final = g => (Array.isArray(g.board) ? g.board.length : 1) - 1;
const pls = g => (g && Array.isArray(g.players) && g.players.length ? g.players : null);
const ativos = g => (Array.isArray(g.themes) && g.themes.length ? g.themes : TEMAS);

function aj(p) { const a = (p && p.aj) || {}; return { pular: a.pular ? 1 : 0, dica: a.dica ? 1 : 0 } }
function usadas(p) { return Array.isArray(p && p.used) ? p.used.map(Number) : [] }
// o que importa de cada jogador para o placar
function nucleoJ(p) { return { dev: p.dev || null, pos: +p.pos || 0, used: usadas(p), forced: p.forced || null, estrelas: +p.estrelas || 0, aj: aj(p) } }
function identidade(p) { return { dev: p.dev || null, name: String(p.name || ''), color: String(p.color || '') } }
// resumo do estado usado para reconhecer um "desfazer" (volta a um estado que o servidor já aceitou)
function nucleo(g) {
  const P = pls(g);
  return J({ p: P ? P.map(nucleoJ) : null, cur: +g.cur || 0, round: +g.round || 1, phase: g.phase || null, qid: g.qid || null, token: num(g.token) });
}

// campos que não mudam no meio da partida
const FIXOS = ['board', 'themes', 'fichas', 'modo', 'size', 'level'];
function fixosIguais(a, b) {
  for (const k of FIXOS) {
    const x = k === 'fichas' ? nf(a) : k === 'modo' ? modo(a) : a[k], y = k === 'fichas' ? nf(b) : k === 'modo' ? modo(b) : b[k];
    if (!igual(x, y)) return k;
  }
  return null;
}

// resposta digitada igual à oficial vale na hora (mesma comparação do jogo)
function normResp(x) { return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/^(o|a|os|as|um|uma)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim() }
function igualOficial(txt, a) {
  const t = normResp(txt); if (!t) return false;
  const ops = [a, ...String(a || '').split(/\s*[;\/]\s*|\s+ou\s+/)].map(normResp).filter(Boolean);
  return ops.includes(t);
}

// votação da resposta digitada, contada pelo servidor (mesma regra do jogo)
function decisaoVoto(g, votos, lobby) {
  const k = g.resp && g.resp.k;
  const P = pls(g);
  if (!k || !P) return null;
  const cur = +g.cur || 0, leitor = P[(cur + 1) % P.length];
  const el = P.filter((p, i) => i !== cur && p.dev && ((lobby[p.dev] && lobby[p.dev].on !== false) || (votos[p.dev] && votos[p.dev].k === k)));
  if (!el.length) return null;
  let s = 0, n = 0;
  el.forEach(p => { const v = votos[p.dev]; if (v && v.k === k) { if (v.v) s++; else n++ } });
  if (s > el.length / 2) return true;
  if (n > el.length / 2) return false;
  if (s + n >= el.length) { const v = leitor && votos[leitor.dev]; if (v && v.k === k) return !!v.v; return s >= n && s > 0 }
  return null;
}
// pedido de desfazer aprovado pela turma (precisa de pelo menos um voto a favor)
function desfazerAprovado(g, votos, lobby) {
  const dz = g.desfazer, P = pls(g);
  if (!dz || !P) return false;
  const k = 'u:' + dz.id;
  const el = P.filter(p => p.dev && p.dev !== dz.dev && ((lobby[p.dev] && lobby[p.dev].on !== false) || (votos[p.dev + '_u'] && votos[p.dev + '_u'].k === k)));
  let s = 0;
  el.forEach(p => { const v = votos[p.dev + '_u']; if (v && v.k === k && v.v) s++ });
  return s >= 1 && s > el.length / 2;
}

// a pergunta que o aparelho diz ter sorteado é mesmo a do token assinado pelo servidor, nesta sala?
async function perguntaOk(c, g) {
  if (!g.qid || !g.tk) return [null, 'Pergunta sem token'];
  const info = await c.perg(g.tk);
  if (!info || info.qid !== g.qid) return [null, 'Pergunta não confere'];
  if (info.m !== 'o' || info.s !== c.sala) return [null, 'A pergunta é de outra sala'];
  if (g.qt && g.qt !== info.t) return [null, 'Tema da pergunta não confere'];
  if (num(g.qd) !== info.nivel) return [null, 'Nível da pergunta não confere'];
  const q = Array.isArray(g.q) ? g.q : [];
  if (String(q[0] || '') !== info.q) return [null, 'Texto da pergunta não confere'];
  if (info.t === 'V') {
    const o = Array.isArray(q[1]) ? q[1].map(String) : [];
    if (o.length !== info.opts.length || J(o.slice().sort()) !== J(info.opts.map(String).sort())) return [null, 'Alternativas não conferem'];
  }
  return [info, null];
}

// o tema escolhido para a vez é permitido pela casa onde o jogador está?
function temaPermitido(base, g, tema, pulou) {
  const P = pls(base), p = P[+base.cur || 0];
  if (!TEMAS.includes(tema) || !ativos(base).includes(tema)) return false;
  if (pulou) return tema === base.theme;
  if (base.phase === 'exhausted') return true;
  if (base.phase === 'sorteio' && base.sortTema && tema === base.sortTema) return true; // o sorteio desse tema já foi conferido // acabaram as perguntas: pode liberar de novo ou escolher outro tema
  if (p.forced) return tema === p.forced;
  const casa = (base.board || [])[+p.pos || 0];
  if (casa && casa.type === 'normal') return Array.isArray(casa.themes) && casa.themes.includes(tema);
  return true; // INÍCIO e última casa: qualquer tema da partida
}
function temaAutomatico(base) { // a vez começa direto na pergunta (tema obrigatório ou casa de um tema só)
  const P = pls(base), p = P[+base.cur || 0];
  if (p.forced) return true;
  const casa = (base.board || [])[+p.pos || 0];
  return !!(casa && casa.type === 'normal' && Array.isArray(casa.themes) && casa.themes.length === 1);
}

// jogadas dentro da mesma vez, sem fechar a pergunta: tema, sorteio, aposta, dobro, dica, pular, resposta, alternativa
async function progresso(c, base, g, quem) {
  const P = pls(base), Q = pls(g), cur = +base.cur || 0, fin = (+P[cur].pos || 0) === final(base);
  const { ehHost, idx } = quem, ehCur = idx === cur;
  if (!['theme', 'sorteio', 'question', 'exhausted', 'result', 'won'].includes(g.phase)) return nao('Fase inválida');
  if (g.phase === 'result' || g.phase === 'won') {
    if (base.phase !== g.phase) return nao('Resultado sem resposta');
  }
  // jogadores: só o da vez muda, e só as ajudas (de não usada para usada)
  for (let i = 0; i < P.length; i++) {
    const a = nucleoJ(P[i]), b = nucleoJ(Q[i]);
    if (i !== cur) { if (!igual(a, b)) return nao('Só o jogador da vez pode mudar'); continue }
    const aa = a.aj, bb = b.aj; a.aj = b.aj = null;
    if (!igual(a, b)) return nao('Posição ou fichas mudaram sem resposta');
    if (aa.pular > bb.pular || aa.dica > bb.dica) return nao('Ajuda devolvida');
  }
  const ajA = aj(P[cur]), ajB = aj(Q[cur]);
  const pulou = !ajA.pular && ajB.pular, deuDica = !ajA.dica && ajB.dica;
  const podeTema = fin ? !ehCur && idx >= 0 : ehCur; // na pergunta final, quem escolhe o tema são os outros jogadores
  const podeCur = ehCur; // ninguém joga pelo outro (quem some pode ser tirado da partida por votação)
  const novaQ = g.phase === 'question' && !!g.qid && (g.qid !== base.qid || base.phase !== 'question');

  if (g.phase === 'won' || g.phase === 'result') { // nada importante muda depois do resultado
    for (const k of ['qid', 'tk', 'qd', 'theme', 'token', 'resp', 'chosen', 'hint', 'dobro', 'seen', 'ult']) if (!igual(base[k], g[k])) return nao('O resultado não pode mudar');
    return sim();
  }
  if (novaQ) {
    if (pulou) { if (!podeCur) return nao('Só quem está na vez pode pular'); if (!base.qid) return nao('Pular sem pergunta') }
    else if (!podeTema && !quem.inicioVez && !(base.phase === 'sorteio' && c.porAnterior === c.dev)) return nao('Não é você quem escolhe o tema agora');
    if (!temaPermitido(base, g, g.theme, pulou)) return nao('Tema não permitido nessa casa');
    const [info, erro] = await perguntaOk(c, g);
    if (erro) return nao(erro);
    const sa = Array.isArray(base.seen) ? base.seen : [], sb = Array.isArray(g.seen) ? g.seen : [];
    const extra = sb.length - sa.length;
    if (extra < 1 || extra > 2 || !igual(sb.slice(0, sa.length), sa) || !igual(sb[sb.length - 1], [info.t, g.qid])) return nao('Histórico de perguntas não confere');
    if (pulou ? num(g.token) !== num(base.token) : (num(g.token) !== null && !fichaValida(base, g))) return nao('Ficha inválida');
    if (g.resp || (g.chosen !== null && g.chosen !== undefined) || g.hint || g.dobro) return nao('Pergunta nova já respondida');
    if (deuDica) return nao('Dica sem pergunta');
    if (!tempoOk(c, g)) return nao('Tempo inválido');
    return sim();
  }
  if (!igual(base.seen, g.seen)) return nao('Histórico de perguntas mudou');
  if (g.phase !== 'question') {
    // escolhendo tema, sorteando ou sem perguntas no tema: nada da pergunta fica valendo
    if (num(g.token) !== num(base.token) && num(g.token) !== null) return nao('Ficha fora da hora');
    if (deuDica) return nao('Dica fora da hora');
    const pulando = pulou && base.phase === 'question' && g.phase === 'sorteio';
    if (pulou && !pulando) return nao('Pular sem trocar a pergunta');
    if (pulando) {
      if (!podeCur) return nao('Só quem está na vez pode pular');
      if ((g.sortTema || base.theme) !== base.theme) return nao('Pular troca só a pergunta, não o tema');
      return sim();
    }
    if (g.phase === 'sorteio' && g.sortTema && !temaPermitido(base, g, g.sortTema, false)) return nao('Tema não permitido nessa casa');
    if (g.phase === 'sorteio' && base.phase !== 'sorteio' && !(podeTema || quem.inicioVez)) return nao('Não é você quem escolhe o tema agora');
    if (g.phase !== base.phase && !(podeTema || podeCur || quem.inicioVez)) return nao('Não é a sua vez');
    return sim();
  }
  if (pulou) return nao('Pular sem trocar a pergunta');
  // a mesma pergunta continua na tela
  if (base.phase !== 'question') return nao('Pergunta sem sorteio');
  for (const k of ['tk', 'qd', 'q', 'theme', 'qt']) if (!igual(base[k], g[k])) return nao('A pergunta não pode mudar');
  const mud = k => !igual(base[k], g[k]);
  if ((mud('token') || mud('dobro') || mud('resp') || mud('chosen') || mud('hint') || deuDica) && !podeCur) return nao('Só quem está na vez responde');
  if (mud('token')) {
    if (num(base.token) !== null) return nao('A ficha já foi escolhida');
    if (fin) return nao('Na pergunta final não tem ficha');
    if (!fichaValida(base, g)) return nao('Ficha inválida');
  }
  if (g.dobro) {
    const lv = num(base.qd) || 0;
    if (!dobroOn(base) || lv < 3 || fin || num(g.token) === null) return nao('Não dá para arriscar o dobro aqui');
    if (mud('dobro') && (base.resp || (base.chosen !== null && base.chosen !== undefined))) return nao('Dobro depois de responder');
  }
  if (mud('hint')) { if (base.hint || !deuDica) return nao('Dica inválida') } else if (deuDica) return nao('Dica inválida');
  if (mud('resp')) { if (base.resp || !g.resp || typeof g.resp.t !== 'string' || !g.resp.k) return nao('Resposta inválida'); if (base.theme === 'V') return nao('Resposta inválida') }
  if (mud('chosen')) {
    if (base.chosen !== null && base.chosen !== undefined) return nao('A alternativa já foi escolhida');
    const i = num(g.chosen);
    if (base.theme !== 'V' || !Number.isInteger(i) || i < 0 || i > 5) return nao('Alternativa inválida');
  }
  if (mud('tEnd') && (Number.isFinite(+base.tEnd) && base.tEnd !== null || !tempoOk(c, g))) return nao('Tempo inválido');
  return sim();
}
function fichaValida(base, g) {
  const P = pls(base), p = P[+base.cur || 0], t = num(g.token);
  return Number.isInteger(t) && t >= 1 && t <= nf(base) && !usadas(p).includes(t) && (+p.pos || 0) !== final(base);
}
function tempoOk(c, g) { return g.tEnd === null || g.tEnd === undefined || (Number.isFinite(+g.tEnd) && +g.tEnd <= c.agora + 40000) }

// fechar a pergunta: acertou ou errou, e o que isso faz com o jogador da vez
function depois(base, ok, nivel) {
  const P = pls(base), cur = +base.cur || 0, p = nucleoJ(P[cur]), FIN = final(base), fin = p.pos === FIN;
  const tok = num(base.token), dobro = !!base.dobro && !fin, imp = nivel >= 4, dif = nivel === 3;
  if (!fin && tok) p.used.push(tok);
  let fase = 'result';
  if (ok) {
    p.forced = null;
    if (imp && bonusOn(base)) p.estrelas++;
    if (fin) return { p, fase: 'won' };
    const bonus = bonusOn(base) ? (imp ? 2 : dif ? 1 : 0) : 0;
    p.pos = Math.min(FIN, p.pos + (tok || 0) * (dobro ? 2 : 1) + bonus);
  } else {
    p.forced = base.theme || null;
    if (dobro && tok) p.pos = Math.max(0, p.pos - tok);
  }
  if (p.used.length >= nf(base)) p.used = [];
  return { p, fase };
}
async function fechamento(c, base, g, quem) {
  const P = pls(base), Q = pls(g), cur = +base.cur || 0, dono = P[cur], fin = (+dono.pos || 0) === final(base);
  if (!base.qid) return nao('Resposta sem pergunta');
  const [info, erro] = await perguntaOk(c, base);
  if (erro) return nao(erro);
  if (!fin && num(base.token) === null && g.phase !== 'result') return nao('Resposta sem ficha');
  for (let i = 0; i < P.length; i++) if (i !== cur && !igual(nucleoJ(P[i]), nucleoJ(Q[i]))) return nao('Só o jogador da vez pode mudar');
  const fimJ = nucleoJ(Q[cur]);
  let ok = null;
  for (const tent of [true, false]) {
    const d = depois(base, tent, info.nivel);
    const esperado = Object.assign({}, d.p, { aj: aj(P[cur]) });
    if (igual(esperado, fimJ) && g.phase === d.fase) { ok = tent; break }
  }
  if (ok === null) return nao('Movimento que o jogo não permite');
  if (ok && num(base.token) === null && !fin) return nao('Acerto sem ficha');
  const ehCur = quem.idx === cur;
  const escolha = base.chosen !== null && base.chosen !== undefined ? num(base.chosen) : num(g.chosen);
  if (ok) {
    if (base.theme === 'V' || info.t === 'V') {
      const o = Array.isArray(base.q) && Array.isArray(base.q[1]) ? base.q[1] : [];
      if (!Number.isInteger(escolha) || String(o[escolha]) !== String(info.a)) return nao('Essa alternativa não é a certa');
    } else {
      const dec = decisaoVoto(base, c.votos, c.lobby);
      const exata = !!(base.resp && igualOficial(base.resp.t, info.a));
      if (dec !== true && !exata) return nao('A turma ainda não aceitou a resposta');
    }
  } else {
    const dec = base.theme === 'V' ? null : decisaoVoto(base, c.votos, c.lobby);
    const acabou = Number.isFinite(+base.tEnd) && c.agora > +base.tEnd + 1500;
    if (!(ehCur || dec === false || acabou)) return nao('Só quem está na vez pode desistir');
  }
  const u = g.ult || {};
  if (u.q !== base.qid || !!u.ok !== ok || (u.d || null) !== (dono.dev || null) || !!u.fim !== !!(ok && fin)) return nao('Registro da resposta não confere');
  if (num(g.token) !== null) return nao('A ficha continua na mesa');
  for (const k of ['qid', 'tk', 'qd', 'theme']) if (!igual(base[k], g[k])) return nao('A pergunta mudou ao responder');
  return sim({ resp: { qid: base.qid, ok, d: dono.dev || null, fim: !!(ok && fin), nivel: info.nivel, t: info.t } });
}

// começo de uma vez: estado "limpo" do jogador que vai jogar, para conferir o que já veio junto (tema, sorteio)
function baseDaVez(g, cur, round, players, seen) {
  return Object.assign({}, g, { players, cur, round, phase: 'theme', theme: null, qt: null, qid: null, tk: null, qd: null, q: null,
    token: null, dobro: false, hint: null, resp: null, chosen: null, seen, sortTema: null });
}
function jogadoresNovos(Q) {
  return Q.every(p => { const n = nucleoJ(p); return n.pos === 0 && !n.used.length && !n.forced && !n.estrelas && !n.aj.pular && !n.aj.dica });
}
function tabuleiroOk(g) {
  const b = g.board, n = TAMANHOS[g.size] || 40, at = ativos(g);
  if (!Array.isArray(b) || b.length !== n + 2) return false;
  if (!b[0] || b[0].type !== 'start' || !b[b.length - 1] || b[b.length - 1].type !== 'final') return false;
  return b.slice(1, -1).every(s => s && s.type === 'normal' && Array.isArray(s.themes) && s.themes.length >= 1 && s.themes.length <= 2 && s.themes.every(t => at.includes(t)));
}

async function confere(c) {
  const prev = c.prev || {}, g = c.next;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return nao('Estado inválido');
  const ehHost = !!c.dev && c.dev === c.host;
  const P = pls(prev), Q = pls(g);
  // sala de espera (e "Mudar jogadores"): só quem criou a sala mexe
  if (g.phase === 'setup' || !Q) {
    if (!ehHost) return nao('Só quem criou a sala mexe na sala de espera');
    if (Q || g.phase !== 'setup') return nao('Sala de espera inválida');
    return sim();
  }
  const idx = Q.findIndex(p => p && p.dev === c.dev);
  const quem = { ehHost, idx, inicioVez: false };
  if (idx < 0 && !ehHost) return nao('Você não está nessa partida');
  if (Q.length < 2 || Q.length > MAXJ) return nao('Número de jogadores inválido');
  const devs = Q.map(p => p && p.dev);
  if (devs.some(d => typeof d !== 'string' || !d) || new Set(devs).size !== devs.length) return nao('Jogadores inválidos');
  if (!Number.isInteger(+g.cur) || +g.cur < 0 || +g.cur >= Q.length) return nao('Vez inválida');

  // começo da partida (ou jogar de novo com os mesmos jogadores)
  const revanche = P && prev.phase === 'won' && jogadoresNovos(Q) && +g.round === 1 && +g.cur === 0;
  if (!P || prev.phase === 'setup' || revanche) {
    if (!ehHost) return nao('Só quem criou a sala começa a partida');
    if (!jogadoresNovos(Q) || +g.cur !== 0 || +g.round !== 1) return nao('A partida precisa começar do zero');
    if (!g.jogo) return nao('Partida sem identificação');
    if (revanche) {
      if (!igual(P.map(identidade), Q.map(identidade))) return nao('Na revanche os jogadores são os mesmos');
      const f = fixosIguais(prev, g); if (f) return nao('Na revanche o jogo é o mesmo (' + f + ')');
    } else {
      if (!c.semLobby && !devs.every(d => c.lobby[d])) return nao('Tem jogador que não está na sala');
      if (!tabuleiroOk(g)) return nao('Tabuleiro inválido');
      if (!MODOS.includes(modo(g)) || ![5, 6, 7].includes(+g.fichas || 5)) return nao('Regras inválidas');
    }
    if (!Q.every(p => /^#[0-9a-fA-F]{6}$/.test(String(p.color || '')) && String(p.name || '').length <= 16)) return nao('Nome ou cor inválidos');
    const seen = Array.isArray(g.seen) ? g.seen : [];
    if (seen.length > 1) return nao('Partida nova com perguntas antigas');
    const base = baseDaVez(g, 0, 1, Q.map(p => Object.assign({}, p)), []);
    return progresso(c, base, g, quem);
  }

  // daqui para baixo: partida em andamento
  const f = fixosIguais(prev, g);
  if (f) return nao('Não dá para mudar ' + f + ' no meio da partida');
  if ((prev.jogo || null) !== (g.jogo || null)) return nao('Partida trocada');
  if (Q.length === P.length - 1) return expulsao(c, prev, g, quem);
  if (Q.length === P.length + 1) return entrada(c, prev, g, quem);
  if (P.length !== Q.length) return nao('Jogadores mudaram');

  const r = await andamento(c, prev, g, quem);
  if (r.ok) return r;
  // desfazer: volta a um estado que o servidor já aceitou, com o pedido aprovado pela turma
  const nq = nucleo(g);
  if (nq !== nucleo(prev) && Array.isArray(c.hist) && c.hist.some(h => h && h.c === nq)) {
    if (!igual(P.map(identidade), Q.map(identidade))) return nao('Desfazer não troca jogadores');
    if (!(prev.desfazer && prev.desfazer.dev === c.dev && desfazerAprovado(prev, c.votos, c.lobby))) return nao('Desfazer precisa do voto da turma');
    if (g.desfazer) return nao('Pedido de desfazer continua aberto');
    return sim({ desfez: true });
  }
  return r;
}

// ---------------------------------------------------------------- expulsar (votação) e entrar no meio (quem criou aceita)
const DUR_EXPULSAR = 30000;
// pedido aprovado: quem pediu conta como sim; votam os outros jogadores conectados (menos quem vai sair)
function expulsarAprovado(g, votos, lobby) {
  const ex = g.expulsar, P = pls(g);
  if (!ex || !P) return null;
  const k = 'x:' + ex.id;
  const el = P.filter(p => p.dev && p.dev !== ex.alvo && (p.dev === ex.dev || (lobby[p.dev] && lobby[p.dev].on !== false) || (votos[p.dev + '_x'] && votos[p.dev + '_x'].k === k)));
  let s = 0, n = 0;
  el.forEach(p => { if (p.dev === ex.dev) { s++; return } const v = votos[p.dev + '_x']; if (v && v.k === k) { if (v.v) s++; else n++ } });
  if (s > el.length / 2) return true;
  if (n >= el.length / 2) return false;
  return null;
}
// tudo da vez que não pode mudar quando alguém entra ou sai sem ser o jogador da vez
const DA_VEZ = ['phase', 'qid', 'tk', 'qd', 'q', 'qt', 'theme', 'token', 'resp', 'chosen', 'hint', 'dobro', 'seen', 'tEnd', 'sortTema', 'ult', 'round'];
function vezIgual(a, b) { for (const k of DA_VEZ) if (!igual(a[k], b[k])) return k; return null }
async function expulsao(c, prev, g, quem) {
  const P = pls(prev), Q = pls(g), ex = prev.expulsar;
  if (!ex) return nao('Ninguém pediu para tirar esse jogador');
  if (quem.idx < 0) return nao('Só quem está jogando aplica a votação');
  if (expulsarAprovado(prev, c.votos, c.lobby) !== true) return nao('A turma ainda não aprovou');
  if (c.agora > (+ex.ate || 0) + 15000) return nao('O tempo da votação acabou');
  const ia = P.findIndex(p => p.dev === ex.alvo);
  if (ia < 0) return nao('Esse jogador não está na partida');
  const resto = P.filter((_, i) => i !== ia);
  if (!igual(resto.map(identidade), Q.map(identidade)) || !igual(resto.map(nucleoJ), Q.map(nucleoJ))) return nao('Só sai quem a turma tirou');
  if (g.expulsar) return nao('O pedido continua aberto');
  if (!igual(prev.desfazer, g.desfazer) && !(prev.desfazer && prev.desfazer.dev === ex.alvo && !g.desfazer)) return nao('Desfazer mudou');
  const cur0 = +prev.cur || 0, r0 = +prev.round || 1;
  if (ia !== cur0) {
    if (+g.cur !== (ia < cur0 ? cur0 - 1 : cur0)) return nao('A vez continua com a mesma pessoa');
    const k = vezIgual(prev, g); if (k) return nao('Tirar um jogador não mexe na jogada (' + k + ')');
    return sim({ expulso: ex.alvo });
  }
  // saiu quem estava na vez: a vez passa para o próximo
  const cur1 = ia < Q.length ? ia : 0, r1 = ia < Q.length ? r0 : r0 + 1;
  if (+g.cur !== cur1 || +g.round !== r1) return nao('A vez passa para o próximo');
  const base = baseDaVez(prev, cur1, r1, Q, Array.isArray(prev.seen) ? prev.seen : []);
  base.expulsar = null; base.desfazer = g.desfazer || null;
  const r = await progresso(c, base, g, Object.assign({}, quem, { inicioVez: true }));
  return r.ok ? sim({ expulso: ex.alvo }) : r;
}
async function entrada(c, prev, g, quem) {
  const P = pls(prev), Q = pls(g);
  if (!quem.ehHost) return nao('Quem aceita jogador novo é quem criou a sala');
  if (Q.length > MAXJ) return nao('No máximo ' + MAXJ + ' jogadores');
  if (!igual(P.map(identidade), Q.slice(0, P.length).map(identidade)) || !igual(P.map(nucleoJ), Q.slice(0, P.length).map(nucleoJ))) return nao('Quem entra vai para o fim da roda');
  const novo = Q[Q.length - 1], n = nucleoJ(novo);
  if (P.some(p => p.dev === novo.dev)) return nao('Esse jogador já está na partida');
  if (!c.semLobby && !c.lobby[novo.dev]) return nao('Quem entra precisa estar na sala');
  if (n.pos !== 0 || n.used.length || n.forced || n.estrelas || n.aj.pular || n.aj.dica) return nao('Quem entra começa do zero');
  if (!/^#[0-9a-fA-F]{6}$/.test(String(novo.color || '')) || !String(novo.name || '').trim() || String(novo.name).length > 16) return nao('Nome ou cor inválidos');
  if (+g.cur !== +prev.cur) return nao('A vez continua com a mesma pessoa');
  const k = vezIgual(prev, g); if (k) return nao('Entrar não mexe na jogada (' + k + ')');
  if (!igual(prev.desfazer, g.desfazer) || !igual(prev.expulsar, g.expulsar)) return nao('Entrar não mexe nos pedidos');
  return sim({ entrou: novo.dev });
}

async function andamento(c, prev, g, quem) {
  const P = pls(prev), Q = pls(g), { ehHost, idx } = quem;
  // pedir, cancelar ou encerrar a votação para tirar alguém da partida
  if (!igual(prev.expulsar, g.expulsar)) {
    const ex = g.expulsar, ag = c.agora;
    if (ex && prev.expulsar) return nao('Já tem um pedido aberto');
    if (ex) {
      if (ex.dev !== c.dev || idx < 0) return nao('Pedido para tirar jogador inválido');
      if (typeof ex.id !== 'string' || !/^[A-Za-z0-9_-]{4,30}$/.test(ex.id) || !Number.isFinite(+ex.ate) || +ex.ate > ag + DUR_EXPULSAR + 10000) return nao('Pedido para tirar jogador inválido');
      if (ex.alvo === c.dev || !P.some(p => p.dev === ex.alvo)) return nao('Esse jogador não está na partida');
      if (P.length < 3) return nao('Com 2 jogadores não dá para tirar ninguém');
      if (prev.phase === 'won') return nao('A partida já acabou');
    } else {
      const px = prev.expulsar;
      const pode = px.dev === c.dev || (idx >= 0 && (ag > (+px.ate || 0) + 2000 || expulsarAprovado(prev, c.votos, c.lobby) === false)) || ehHost && !P.some(p => p.dev === px.dev);
      if (!pode) return nao('Só quem pediu cancela, até o tempo acabar');
    }
  }
  // pedir ou cancelar o desfazer
  if (!igual(prev.desfazer, g.desfazer)) {
    if (g.desfazer && !(g.desfazer.dev === c.dev && idx >= 0 && !prev.desfazer)) return nao('Pedido de desfazer inválido');
    if (!g.desfazer && !(prev.desfazer && (prev.desfazer.dev === c.dev || ehHost))) return nao('Só quem pediu cancela o desfazer');
  }

  // ordem e cores (quem criou a sala): os mesmos jogadores, cada um com o seu placar
  const idP = P.map(identidade), idQ = Q.map(identidade);
  if (!igual(idP, idQ)) {
    if (!ehHost) return nao('Só quem criou a sala muda ordem e cores');
    if (!igual(idP.map(x => x.dev).sort(), idQ.map(x => x.dev).sort())) return nao('Jogadores mudaram');
    if (idQ.some((x, i) => x.name !== idP.find(y => y.dev === x.dev).name)) return nao('Nome não muda no meio da partida');
    const porDev = d => P.find(p => p.dev === d);
    if (Q.some(p => !igual(nucleoJ(p), nucleoJ(porDev(p.dev))))) return nao('Mudar a ordem não mexe no placar');
    if (P[+prev.cur].dev !== Q[+g.cur].dev) return nao('A vez continua com a mesma pessoa');
    for (const k of ['phase', 'qid', 'token', 'round', 'resp', 'chosen', 'hint', 'dobro', 'seen']) if (!igual(prev[k], g[k])) return nao('Mudar a ordem não mexe na jogada');
    return sim();
  }

  const cur0 = +prev.cur || 0, cur1 = +g.cur || 0, r0 = +prev.round || 1, r1 = +g.round || 1;
  if (cur1 === cur0 && r1 === r0) {
    if (prev.phase === 'question' && (g.phase === 'result' || g.phase === 'won')) return fechamento(c, prev, g, quem);
    return progresso(c, prev, g, quem);
  }
  // próximo jogador
  const prox = (cur0 + 1) % P.length;
  if (cur1 !== prox || r1 !== r0 + (prox === 0 ? 1 : 0)) return nao('A vez pulou alguém');
  if (prev.phase !== 'result') return nao('A vez só passa depois do resultado');
  const leitor = P[prox];
  if (!(ehHost || idx === cur0 || (leitor && leitor.dev === c.dev))) return nao('Quem passa a vez é quem jogou, quem leu ou quem criou a sala');
  for (let i = 0; i < P.length; i++) if (!igual(nucleoJ(P[i]), nucleoJ(Q[i]))) return nao('Placar mudou ao passar a vez');
  const base = baseDaVez(prev, cur1, r1, P, Array.isArray(prev.seen) ? prev.seen : []);
  if (g.phase !== 'theme' && !temaAutomatico(base) && idx !== cur1) return nao('Quem escolhe o tema é o jogador da vez');
  return progresso(c, base, g, Object.assign({}, quem, { inicioVez: true }));
}

module.exports = { confere, nucleo, decisaoVoto, desfazerAprovado, expulsarAprovado, igualOficial };
