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

const n5 = a => Array.from({ length: 5 }, (_, i) => Math.max(0, Math.floor(+((a || [])[i]) || 0)));
function normaliza(s) {
  s = s && typeof s === 'object' ? s : {};
  const tema = {};
  Object.keys(TEMAS).forEach(k => { const x = s.tema && s.tema[k]; if (x) tema[k] = { a: Math.max(0, +x.a || 0), e: Math.max(0, +x.e || 0) } });
  const per = x => ({ id: String((x && x.id) || ''), p: Math.max(0, +(x && x.p) || 0) });
  return {
    p: Math.max(0, +s.p || 0), a: n5(s.a), e: n5(s.e), v: Math.max(0, +s.v || 0), np: Math.max(0, +s.np || 0),
    seq: Math.max(0, +s.seq || 0), maxSeq: Math.max(0, +s.maxSeq || 0), tema,
    sem: per(s.sem), mes: per(s.mes), dia: { id: String((s.dia && s.dia.id) || ''), n: Math.max(0, +(s.dia && s.dia.n) || 0) }
  };
}
const soma = a => a.reduce((x, y) => x + y, 0);
const temasCom = s => Object.values(s.tema).filter(x => x.a > 0).length;

const CONQ = [
  { id: 'primeiro', e: '🎯', n: 'Primeiro acerto', d: 'Acerte sua primeira pergunta numa partida online.', alvo: 1, v: s => soma(s.a) },
  { id: 'dez', e: '🔟', n: 'Dez na conta', d: 'Acerte 10 perguntas.', alvo: 10, v: s => soma(s.a) },
  { id: 'cem', e: '💯', n: 'Centenário', d: 'Acerte 100 perguntas.', alvo: 100, v: s => soma(s.a) },
  { id: 'quinhentos', e: '🧠', n: 'Enciclopédia ambulante', d: 'Acerte 500 perguntas.', alvo: 500, v: s => soma(s.a) },
  { id: 'dificil', e: '💪', n: 'Difícil é comigo', d: 'Acerte 25 perguntas difíceis.', alvo: 25, v: s => s.a[3] },
  { id: 'imp1', e: '😈', n: 'Impossível? Nada!', d: 'Acerte uma pergunta impossível.', alvo: 1, v: s => s.a[4] },
  { id: 'imp10', e: '👑', n: 'Rei do Impossível', d: 'Acerte 10 perguntas impossíveis.', alvo: 10, v: s => s.a[4] },
  { id: 'seq5', e: '🔥', n: 'Pegando fogo', d: 'Acerte 5 perguntas seguidas.', alvo: 5, v: s => s.maxSeq },
  { id: 'seq10', e: '⚡', n: 'Imparável', d: 'Acerte 10 perguntas seguidas.', alvo: 10, v: s => s.maxSeq },
  { id: 'vit1', e: '🏆', n: 'Primeira vitória', d: 'Vença uma partida online.', alvo: 1, v: s => s.v },
  { id: 'vit10', e: '🥇', n: 'Campeão', d: 'Vença 10 partidas online.', alvo: 10, v: s => s.v },
  { id: 'part10', e: '🎟️', n: 'Figurinha carimbada', d: 'Jogue 10 partidas online.', alvo: 10, v: s => s.np },
  { id: 'part50', e: '🎪', n: 'Dono do palco', d: 'Jogue 50 partidas online.', alvo: 50, v: s => s.np },
  { id: 'ecletico', e: '🌈', n: 'Eclético', d: 'Acerte pelo menos uma pergunta de cada um dos 11 temas.', alvo: 11, v: temasCom },
  ...Object.entries(TEMAS).map(([k, [nome, e]]) => ({ id: 'mestre-' + k, e, n: 'Mestre em ' + nome, d: 'Acerte 25 perguntas de ' + nome + '.', alvo: 25, v: s => (s.tema[k] && s.tema[k].a) || 0, tema: k }))
];

function conquistasLista(s, tem) {
  s = normaliza(s); tem = tem || {};
  return CONQ.map(c => ({ id: c.id, e: c.e, n: c.n, d: c.d, alvo: c.alvo, prog: Math.min(c.alvo, c.v(s)), quando: tem[c.id] || null, tema: c.tema || null }));
}
function novas(s, tem) { tem = tem || {}; return CONQ.filter(c => !tem[c.id] && c.v(s) >= c.alvo) }

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

module.exports = { PONTOS, VITORIA, TEMAS, CONQ, periodo, normaliza, conquistasLista, novas, aplica, soma };
