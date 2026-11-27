// Sobrevivência relâmpago (sala online): todo mundo responde a mesma pergunta de múltipla escolha ao mesmo tempo.
// Errou ou não respondeu, perde uma vida (são 3). As perguntas ficam mais difíceis a cada rodada; quem sobrar ganha.
// Quem conduz a partida é o servidor (api/salas.js, ação "sv"): a alternativa certa e as respostas ficam em srv/
// (fechado) até a rodada fechar. Aqui ficam só as regras, sem banco, para dar para testar.
// Arquivo com "_" no começo: a Vercel não publica como rota.

const VIDAS = 3;
const DUR = 15000;          // tempo para responder
const CARGA = 1000;         // a pergunta leva um instante para chegar em todos os aparelhos
const FOLGA = 1500;         // resposta que saiu no último segundo ainda chega
const MOSTRA = 6000;        // quanto tempo o resultado da rodada fica na tela
const MAX_RODADAS = 30;     // se ainda sobrar mais de um, vence quem tem mais vidas (depois, mais acertos)
const FASES = ['svq', 'svr', 'svfim'];
const ID = /^[A-Za-z0-9_-]{1,60}$/;
const COR = /^#[0-9a-fA-F]{6}$/;
const PALETA = ['#ff4d6d', '#3da5ff', '#2fd07f', '#ffc93c', '#b06bff', '#ff8a3d', '#2ee6d6', '#ff6bd6', '#9be15d', '#f2f2f2'];

const nivelDa = n => n <= 3 ? 1 : n <= 7 ? 2 : n <= 11 ? 3 : 4; // rodada → nível da pergunta
const emJogo = p => (+p.vidas || 0) > 0;

// quem está na sala e conectado, na ordem da sala de espera
function jogadores(lobby, ordem, limpaNome) {
  lobby = lobby && typeof lobby === 'object' ? lobby : {};
  const devs = (Array.isArray(ordem) ? ordem : []).filter(d => lobby[d]);
  Object.keys(lobby).sort((a, b) => (+lobby[a].ts || 0) - (+lobby[b].ts || 0)).forEach(d => { if (!devs.includes(d)) devs.push(d) });
  const usadas = new Set(), out = [];
  for (const d of devs) {
    const l = lobby[d] || {};
    if (!ID.test(d) || l.on === false) continue;
    let c = COR.test(String(l.cor || '')) && !usadas.has(l.cor.toLowerCase()) ? l.cor.toLowerCase() : PALETA.find(x => !usadas.has(x)) || '#ffffff';
    usadas.add(c);
    const nome = (limpaNome || (x => x))(String(l.nome || '').trim().slice(0, 16));
    out.push({ dev: d, name: nome || 'Jogador ' + (out.length + 1), color: c, vidas: VIDAS, ac: 0 });
  }
  return out;
}

// estado de uma rodada nova: a pergunta sem a certa, com o prazo para responder
function rodada(g, x, agora, n) {
  const so = { n, nv: x.nv, t: x.t, qid: x.qid, q: x.q, o: x.o, ate: agora + CARGA + DUR, el: (g.so && Array.isArray(g.so.el)) ? g.so.el : [] };
  return Object.assign({}, g, { phase: 'svq', round: n, so, seen: (Array.isArray(g.seen) ? g.seen : []).concat([[x.t, x.qid]]).slice(-200) });
}

// a rodada já pode fechar? (todo mundo que está no jogo e conectado respondeu, ou o tempo acabou)
function podeFechar(g, resp, on, agora) {
  if (agora >= g.so.ate + FOLGA) return true;
  const vivosOn = g.players.filter(p => emJogo(p) && on(p.dev));
  return vivosOn.length > 0 && vivosOn.every(p => resp && resp[p.dev]);
}

// fecha a rodada: quem errou ou não respondeu perde uma vida. Se todo mundo que ainda estava no jogo cairia junto,
// ninguém cai (a rodada não tira a última vida de ninguém). Devolve o estado novo e quem acertou (para o ranking).
function fecha(g, resp, certa, agora) {
  const so = g.so, P = g.players.map(p => Object.assign({}, p)), esc = {}, reg = {};
  const antes = P.filter(emJogo);
  antes.forEach(p => {
    const r = resp && resp[p.dev], o = r && Number.isInteger(r.o) ? r.o : -1, ok = o === certa;
    esc[p.dev] = o; reg[p.dev] = ok ? 1 : 0;
    if (ok) p.ac = (+p.ac || 0) + 1; else p.vidas = (+p.vidas || 0) - 1;
  });
  if (!P.some(emJogo)) antes.forEach(p => { p.vidas = 1 });
  const caiu = antes.filter(p => !emJogo(p)).map(p => p.dev);
  const el = (Array.isArray(so.el) ? so.el : []).concat(caiu.length ? [caiu] : []);
  const vivos = P.filter(emJogo);
  let fim = null;
  if (vivos.length <= 1) fim = vivos.map(p => p.dev);
  else if (so.n >= MAX_RODADAS) {
    const mv = Math.max(...vivos.map(p => p.vidas)), a = vivos.filter(p => p.vidas === mv), ma = Math.max(...a.map(p => +p.ac || 0));
    fim = a.filter(p => (+p.ac || 0) === ma).map(p => p.dev);
  }
  const so2 = Object.assign({}, so, { c: certa, esc, el });
  if (fim) { so2.fim = fim; return { g: Object.assign({}, g, { players: P, phase: 'svfim', so: so2 }), reg, fim } }
  so2.prox = agora + MOSTRA;
  return { g: Object.assign({}, g, { players: P, phase: 'svr', so: so2 }), reg, fim: null };
}

// a resposta de um aparelho vale? (rodada aberta, dentro do prazo, quem responde ainda está no jogo, alternativa existe)
function respostaOk(g, dev, qid, o, agora) {
  if (!g || g.phase !== 'svq' || !g.so || g.so.qid !== qid) return 'Essa pergunta já fechou';
  if (agora > g.so.ate + FOLGA) return 'O tempo acabou';
  const eu = (g.players || []).find(p => p.dev === dev);
  if (!eu) return 'Só quem está na partida responde';
  if (!emJogo(eu)) return 'Você já saiu desta partida';
  if (!Number.isInteger(o) || o < 0 || o >= (g.so.o || []).length) return 'Resposta inválida';
  return null;
}

module.exports = { VIDAS, DUR, CARGA, FOLGA, MOSTRA, MAX_RODADAS, FASES, nivelDa, jogadores, rodada, podeFechar, fecha, respostaOk };
