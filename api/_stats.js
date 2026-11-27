// Pontos, estatísticas, ranking e conquistas das contas (só partidas online).
const PONTOS = [0, 1, 2, 3, 5]; // por nível: fácil 1, médio 2, difícil 3, impossível 5
const VITORIA = 10;
const TEMAS = {
  M: ['Mundo', '🌍'], H: ['História', '📜'], AL: ['Artes e Literatura', '🎨'], MU: ['Música', '🎵'], CS: ['Cinema e Séries', '🎬'], S: ['Sociedade', '🏛️'],
  CT: ['Ciência', '🔬'], TI: ['Tecnologia e Internet', '💻'], ES: ['Esporte', '⚽'], GG: ['Games e Geek', '🎮'], V: ['Variedades', '🎲']
};

// semana (segunda a domingo) e mês no horário de Brasília
function periodo(ts = Date.now()) {
  const d = new Date(ts - 3 * 3600e3);
  const mes = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = t.getUTCDay() || 7;
  const seg = new Date(t); seg.setUTCDate(t.getUTCDate() - dia + 1);
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const ano = t.getUTCFullYear(), n = Math.ceil(((t - Date.UTC(ano, 0, 1)) / 864e5 + 1) / 7);
  const dom = new Date(seg); dom.setUTCDate(seg.getUTCDate() + 6);
  const dm = x => String(x.getUTCDate()).padStart(2, '0') + '/' + String(x.getUTCMonth() + 1).padStart(2, '0');
  return { semana: ano + '-S' + String(n).padStart(2, '0'), mes, dia: d.toISOString().slice(0, 10), semanaTxt: dm(seg) + ' a ' + dm(dom) };
}

// eventos com título exclusivo: a contagem só vale no mês do evento, e o título fica para sempre
const EVENTOS = [
  { id: 'natal2026', mes: '2026-12', e: '🎄', ti: 'Natal 2026', n: 'Evento de Natal 2026', d: 'Jogue 5 partidas online com conta em dezembro de 2026', alvo: 5 }
];
const n5 = a => Array.from({ length: 5 }, (_, i) => Math.max(0, Math.floor(+((a || [])[i]) || 0)));
function normaliza(s) {
  s = s && typeof s === 'object' ? s : {};
  const tema = {};
  Object.keys(TEMAS).forEach(k => { const x = s.tema && s.tema[k]; if (x) tema[k] = { a: Math.max(0, +x.a || 0), e: Math.max(0, +x.e || 0) } });
  const per = x => ({ id: String((x && x.id) || ''), p: Math.max(0, +(x && x.p) || 0) });
  return {
    p: Math.max(0, +s.p || 0), a: n5(s.a), e: n5(s.e), v: Math.max(0, +s.v || 0), np: Math.max(0, +s.np || 0),
    seq: Math.max(0, +s.seq || 0), maxSeq: Math.max(0, +s.maxSeq || 0), tema,
    sem: per(s.sem), mes: per(s.mes), dia: { id: String((s.dia && s.dia.id) || ''), n: Math.max(0, +(s.dia && s.dia.n) || 0) },
    ev: Object.fromEntries(EVENTOS.map(e => [e.id, Math.max(0, Math.floor(+(s.ev && s.ev[e.id]) || 0))]).filter(([, n]) => n > 0))
  };
}
const soma = a => a.reduce((x, y) => x + y, 0);
const temasCom = s => Object.values(s.tema).filter(x => x.a > 0).length;

// Conquistas em 6 níveis: bronze, prata, ouro, platina, diamante e grão-mestre
const NIVEIS_CONQ = ['Bronze', 'Prata', 'Ouro', 'Platina', 'Diamante', 'Grão-mestre'];
// cada conquista libera um título para usar ao lado do nome; a cor dele acompanha o nível da conquista
const TITULO_TEMA = { M: 'Viajante', H: 'Máquina do Tempo', AL: 'Alma de Artista', MU: 'Ouvido Absoluto', CS: 'Maratonista', S: 'Fonte Confiável',
  CT: 'Cientista', TI: 'Hacker', ES: 'Comentarista', GG: 'Gamer', V: 'Coringa' };
const minTemas = s => Math.min(...Object.keys(TEMAS).map(k => (s.tema[k] && s.tema[k].a) || 0));
const CONQ = [
  { id: 'acertos', e: '🎯', n: 'Acertador', ti: 'Mira Certeira', d: 'Acertos em partidas online', alvos: [1, 25, 100, 300, 750, 2000], v: s => soma(s.a) },
  { id: 'pontos', e: '⭐', n: 'Pontuador', ti: 'Máquina de Pontos', d: 'Pontos somados', alvos: [50, 250, 1000, 3000, 8000, 20000], v: s => s.p },
  { id: 'dificeis', e: '💪', n: 'Difícil é comigo', ti: 'Casca-grossa', d: 'Perguntas difíceis acertadas', alvos: [5, 25, 75, 200, 500, 1200], v: s => s.a[3] },
  { id: 'impossiveis', e: '😈', n: 'Rei do Impossível', ti: 'Lenda do Impossível', d: 'Perguntas impossíveis acertadas', alvos: [1, 10, 30, 80, 200, 500], v: s => s.a[4] },
  { id: 'sequencia', e: '🔥', n: 'Pegando fogo', ti: 'Pegando Fogo', d: 'Acertos seguidos (seu recorde)', alvos: [3, 5, 8, 12, 18, 25], v: s => s.maxSeq },
  { id: 'vitorias', e: '🏆', n: 'Campeão', ti: 'Imbatível', d: 'Partidas online vencidas', alvos: [1, 5, 15, 40, 100, 250], v: s => s.v },
  { id: 'partidas', e: '🎟️', n: 'Figurinha carimbada', ti: 'Figurinha Carimbada', d: 'Partidas online jogadas', alvos: [1, 10, 30, 75, 200, 500], v: s => s.np },
  { id: 'ecletico', e: '🌈', n: 'Eclético', ti: 'Sabe de Tudo', d: 'Acertos em cada um dos 11 temas (conta o tema com menos)', alvos: [1, 5, 15, 40, 100, 250], v: minTemas },
  ...Object.entries(TEMAS).map(([k, [nome, e]]) => ({ id: 'tema-' + k, e, n: 'Mestre em ' + nome, ti: TITULO_TEMA[k], d: 'Acertos em ' + nome, alvos: [5, 25, 75, 200, 500, 1000], v: s => (s.tema[k] && s.tema[k].a) || 0, tema: k }))
];

function conquistasLista(s, tem) {
  s = normaliza(s); tem = tem || {};
  return CONQ.map(c => {
    const prog = c.v(s), nivel = c.alvos.filter(a => prog >= a).length;
    return { id: c.id, e: c.e, n: c.n, ti: c.ti, d: c.d, alvos: c.alvos, prog, nivel, quando: c.alvos.map((_, t) => tem[c.id + '-' + (t + 1)] || null), tema: c.tema || null };
  });
}
// níveis alcançados agora que ainda não estavam guardados
function novas(s, tem) {
  tem = tem || {};
  const out = [];
  EVENTOS.forEach(e => { if ((s.ev[e.id] || 0) >= e.alvo && !tem['ev-' + e.id]) out.push({ id: 'ev-' + e.id, e: e.e, n: e.e + ' ' + e.ti, nivel: 8 }) });
  CONQ.forEach(c => { const v = c.v(s); c.alvos.forEach((a, t) => { const id = c.id + '-' + (t + 1); if (v >= a && !tem[id]) out.push({ id, e: c.e, n: c.n + ' · ' + NIVEIS_CONQ[t], nivel: t + 1 }) }) });
  return out;
}

// primeira resposta de uma partida nova: conta a partida (e o evento do mês, se houver)
function novaPartida(s, agora = Date.now()) {
  s.np++;
  const mes = periodo(agora).mes;
  EVENTOS.forEach(e => { if (e.mes === mes) s.ev[e.id] = (s.ev[e.id] || 0) + 1 });
}
function eventosLista(s) {
  s = normaliza(s);
  return EVENTOS.map(e => ({ id: 'ev-' + e.id, e: e.e, ti: e.ti, n: e.n, d: e.d, mes: e.mes, alvo: e.alvo, prog: Math.min(e.alvo, s.ev[e.id] || 0), ok: (s.ev[e.id] || 0) >= e.alvo }));
}

// aplica uma resposta nas estatísticas; devolve os pontos ganhos
function aplica(s, { ok, nivel, tema, fim, agora = Date.now() }) {
  const per = periodo(agora);
  if (s.sem.id !== per.semana) s.sem = { id: per.semana, p: 0 };
  if (s.mes.id !== per.mes) s.mes = { id: per.mes, p: 0 };
  if (s.dia.id !== per.dia) s.dia = { id: per.dia, n: 0 };
  s.dia.n++;
  const t = s.tema[tema] || (s.tema[tema] = { a: 0, e: 0 });
  let pts = 0;
  if (ok) {
    s.a[nivel]++; t.a++; s.seq++; s.maxSeq = Math.max(s.maxSeq, s.seq);
    pts = PONTOS[nivel] || 0;
    if (fim) { s.v++; pts += VITORIA }
  } else { s.e[nivel]++; t.e++; s.seq = 0 }
  s.p += pts; s.sem.p += pts; s.mes.p += pts;
  return pts;
}

// modo equipes: a vitória do time para quem não respondeu a pergunta final (não conta como resposta)
function vitoria(s, agora = Date.now()) {
  const per = periodo(agora);
  if (s.sem.id !== per.semana) s.sem = { id: per.semana, p: 0 };
  if (s.mes.id !== per.mes) s.mes = { id: per.mes, p: 0 };
  s.v++;
  s.p += VITORIA; s.sem.p += VITORIA; s.mes.p += VITORIA;
  return VITORIA;
}

// título escolhido (id da conquista) → texto e nível atuais; null se ainda não liberou
const TITULO_DONO = { id: 'dono', x: '👑 Dono do Jogo', n: 7 }; // só a conta do dono (conferida pelo uid)
function titulo(id, s, uid) {
  if (id === 'dono') return uid && require('./_auth').ehAdmin({ uid }) ? Object.assign({}, TITULO_DONO) : null;
  const ev = EVENTOS.find(e => 'ev-' + e.id === id);
  if (ev) return (normaliza(s).ev[ev.id] || 0) >= ev.alvo ? { id, x: ev.e + ' ' + ev.ti, n: 8 } : null;
  const c = CONQ.find(x => x.id === id);
  if (!c) return null;
  const nivel = c.alvos.filter(a => c.v(normaliza(s)) >= a).length;
  return nivel ? { id: c.id, x: c.e + ' ' + c.ti, n: nivel } : null;
}

module.exports = { PONTOS, VITORIA, TEMAS, CONQ, NIVEIS_CONQ, EVENTOS, periodo, normaliza, conquistasLista, eventosLista, novas, novaPartida, aplica, vitoria, soma, titulo };
