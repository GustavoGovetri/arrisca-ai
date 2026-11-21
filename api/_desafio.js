// Desafio do dia: 10 perguntas de múltipla escolha, iguais para todo mundo no mesmo dia (horário de Brasília).
// Variedades já vem com alternativas. Nas perguntas abertas, as alternativas erradas são respostas de outras
// perguntas do mesmo tipo (ex.: "Qual país..." recebe outros países), parecidas no formato; anos e números
// recebem valores próximos. Pergunta que não tem três alternativas boas não entra no desafio.
const crypto = require('crypto');

const INICIO = Date.UTC(2026, 10, 21);           // dia 1 do desafio (lançado em 21/11/2026)
const NIVEIS = [1, 1, 2, 2, 2, 2, 3, 3, 3, 4];   // do mais fácil ao mais difícil
const GENERICAS = new Set(['significa', 'maior', 'menor', 'primeiro', 'primeira', 'tipo', 'verdadeiro', 'outro', 'outra', 'unico', 'unica',
  'mais', 'famoso', 'famosa', 'principal', 'ultimo', 'ultima', 'segundo', 'segunda', 'nome', 'termo', 'palavra', 'expressao', 'parte', 'coisa',
  'objeto', 'evento', 'ideia', 'apelido', 'sigla', 'letra', 'cor', 'numero', 'frase', 'lema', 'titulo', 'periodo', 'fase', 'regra']);
const ADJETIVOS = new Set(['maior', 'menor', 'primeiro', 'primeira', 'mais', 'unico', 'unica', 'ultimo', 'ultima', 'segundo', 'segunda', 'principal', 'famoso', 'famosa', 'antigo', 'antiga', 'grande', 'novo', 'nova']);
// tipos de coisa bem definidos: só esses buscam alternativas em outros temas
const CATEGORIAS = new Set(('pais cidade capital estado continente rio ilha montanha lago oceano mar deserto vulcao regiao bairro ' +
  'pessoa artista ator atriz cantor cantora compositor cientista diretor escritor autor pintor escultor presidente poeta jogador piloto tenista ' +
  'tecnico treinador rei rainha imperador papa navegador inventor filosofo fisico quimico matematico astronauta ' +
  'time clube selecao banda grupo dupla filme serie novela livro jogo console empresa marca esporte instrumento moeda animal planeta ' +
  'idioma lingua personagem anime manga heroi vilao prato fruta ave peixe elemento orgao osso doenca estadio dinastia').split(' '));
const VARIAS = /\b(cite|diga|um dos|uma das|um exemplo|algum|alguma|qualquer)\b/;

const h32 = s => crypto.createHash('sha1').update(String(s)).digest().readUInt32BE(0);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const principal = a => String(a || '').split(' / ')[0].replace(/\s*\([^)]*\)/g, '').trim();
const alternativas = a => [a, ...String(a || '').split(/\s*[;\/]\s*|\s+ou\s+/)].map(x => norm(String(x).replace(/\([^)]*\)/g, ' '))).filter(Boolean);
function chave(q) {
  const n = norm(q);
  if (/^(em |no |na )?(que|qual) ano\b/.test(n)) return 'ano';
  if (/^quant/.test(n)) return 'num';
  if (/^(de |por |para |com |a |o )?quem\b/.test(n)) { const r = /^quem (?:foi|era|e|sao|foram) (?:o |a |os |as )?(?:primeir[oa] |ultim[oa] |maior |famos[oa] )?(\w+)/.exec(n); return r && CATEGORIAS.has(r[1]) ? r[1] : 'pessoa' }
  let m = /^(?:em |de |do |da |para |com |por |a |o |na |no |sobre |entre )?(?:qual|quais|que)\s+(?:e |era |foi |sao |eram |foram )?(?:o |a |os |as )?(?:nome (?:do |da |de |dos |das )?)?(\w+)/.exec(n);
  if (!m) m = /^como se chamam? (?:o |a |os |as )?(\w+)/.exec(n);
  if (!m) return null;
  // "qual é o maior rio..." → rio; "qual foi o primeiro presidente..." → presidente
  if (ADJETIVOS.has(m[1])) { const r = new RegExp('\\b' + m[1] + ' (?:(?:do|da|de|dos|das) )?(\\w+)').exec(n); if (r && r[1].length > 2) return r[1] }
  return m[1];
}
function forma(a) { // tipo de resposta: ano, número pequeno, lista (fica de fora) ou texto
  if (/^\d{3,4}$/.test(a) && +a >= 100 && +a <= 2100) return 'ano';
  if (/^\d{1,2}$/.test(a)) return 'num';
  if (/[,;]/.test(a) || /\s(e|and)\s/i.test(a) || /\d/.test(a) && !/^[A-Za-zÀ-ÿ]/.test(a)) return 'lista';
  return 'txt';
}
const palavras = a => a.split(/\s+/).length;
const maiuscula = a => /^[A-ZÀ-Ý0-9]/.test(a);
function parecida(a, b) { // mesmo jeito de resposta: maiúscula, número de palavras e tamanho
  if (maiuscula(a) !== maiuscula(b)) return false;
  if (Math.abs(palavras(a) - palavras(b)) > 1) return false;
  const r = b.length / a.length;
  return r >= 0.4 && r <= 2.5;
}
function numeros(a, k, semente) { // anos e números próximos (anos nunca depois de 2026)
  const v = +a, saltos = k === 'ano' ? [-12, -8, -5, -3, -2, -1, 1, 2, 3, 5, 8, 12] : [-3, -2, -1, 1, 2, 3, 4];
  const ok = x => x > 0 && x !== v && (k !== 'ano' || x <= 2026);
  const opc = saltos.map(s => v + s).filter(ok).sort((x, y) => h32(semente + x) - h32(semente + y));
  return opc.length >= 3 ? opc.slice(0, 3).map(String) : null;
}

// índice das respostas (uma vez por versão do banco)
function indice(B, fx) {
  if (B._dsf) return B._dsf;
  const porChave = new Map(), porBucket = new Map(), todos = [];
  Object.entries(B.temas).forEach(([t, T]) => {
    if (t === 'V') return;
    T.items.forEach((q, i) => {
      if (fx.tipoDe(q)) return; // silhuetas e bandeiras precisam de imagem
      const a = principal(fx.resposta(t, q)), k = chave(q[0]), f = forma(a);
      if (!a || a.length > 40 || f !== 'txt') return;
      const r = { t, i, a, n: norm(a), k, b: String(fx.bucketOf(t, q)) };
      todos.push(r);
      const poe = c => { if (!porChave.has(c)) porChave.set(c, []); porChave.get(c).push(r) };
      if (k) { poe(t + '|' + k); if (!GENERICAS.has(k)) poe('*|' + k) }
      const c2 = t + '|' + r.b; if (!porBucket.has(c2)) porBucket.set(c2, []); porBucket.get(c2).push(r);
    });
  });
  return (B._dsf = { porChave, porBucket, pools: {} });
}

// as 3 alternativas erradas de uma pergunta aberta (ou null se não der); com "so", só diz se dá
function erradas(B, fx, t, i, so) {
  const q = B.temas[t].items[i], resp = fx.resposta(t, q), a = principal(resp);
  if (fx.tipoDe(q) || !a || a.length > 40 || VARIAS.test(norm(q[0]))) return so ? false : null;
  const f = forma(a), k = chave(q[0]), semente = B.temas[t].ids[i];
  if (f === 'lista') return so ? false : null;
  if (f === 'ano' || f === 'num') { const r = (k === 'ano' || k === 'num' || f === 'ano') ? numeros(a, f, semente) : null; return so ? !!r : r }
  const X = indice(B, fx), proibidas = new Set(alternativas(resp)), tok = new Set(norm(a).split(' ').filter(w => w.length >= 4));
  const nq = ' ' + norm(q[0]) + ' ', tq = new Set(nq.trim().split(' ').filter(w => w.length >= 4));
  // não vale: igual à certa, com palavra em comum com a certa, ou que já aparece no texto da pergunta
  const serve = r => !proibidas.has(r.n) && parecida(a, r.a) && !r.n.split(' ').some(w => w.length >= 4 && (tok.has(w) || tq.has(w))) && !nq.includes(' ' + r.n + ' ');
  const doBucket = (X.porBucket.get(t + '|' + String(fx.bucketOf(t, q))) || []).filter(r => r.k === k);
  // primeiro do mesmo assunto e do mesmo tipo; depois do mesmo tema; por último, de outros temas (só tipos bem definidos)
  const niveis = k ? [doBucket, X.porChave.get(t + '|' + k), CATEGORIAS.has(k) ? X.porChave.get('*|' + k) : null] : [doBucket];
  const vistas = new Set(), out = [];
  for (const lista of niveis) {
    if (so) { for (const r of lista || []) if (!(r.t === t && r.i === i) && !vistas.has(r.n) && serve(r)) { vistas.add(r.n); if (vistas.size === 3) return true } continue }
    const cand = (lista || []).filter(r => !(r.t === t && r.i === i) && serve(r) && !vistas.has(r.n)).map(r => [h32(semente + r.n), r]);
    cand.sort((x, y) => x[0] - y[0]);
    for (const [, r] of cand) { if (vistas.has(r.n)) continue; vistas.add(r.n); out.push(r.a); if (out.length === 3) return out }
  }
  return so ? false : null;
}

// perguntas que podem entrar no desafio, por tema e nível, numa ordem fixa embaralhada
function pool(B, fx, t, nv) {
  const X = indice(B, fx), c = t + '|' + nv;
  if (X.pools[c]) return X.pools[c];
  const T = B.temas[t];
  const l = [];
  T.items.forEach((q, i) => {
    if (fx.qDiff(t, q) !== nv) return;
    if (t === 'V') { if (Array.isArray(q[1]) && q[1].length === 4) l.push(i); return }
    if (erradas(B, fx, t, i, true)) l.push(i);
  });
  l.sort((x, y) => h32('ordem|' + T.ids[x]) - h32('ordem|' + T.ids[y]));
  return (X.pools[c] = l);
}

const diaN = dia => Math.round((Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8, 10)) - INICIO) / 864e5) + 1;
function embaralha(a, semente) { return a.map(x => [h32(semente + '|' + x), x]).sort((x, y) => x[0] - y[0]).map(x => x[1]) }

// monta o desafio de um dia: [{t, id, q, o: [4 alternativas], c: índice da certa, nv}]
function monta(B, fx, dia, temas) {
  const n = diaN(dia), sem = 'dia|' + dia;
  let lista = temas.filter(t => B.temas[t] && B.temas[t].items.length);
  const fixos = lista.filter(t => t === 'N');   // no Natal, o tema de Natal sempre entra
  let resto = embaralha(lista.filter(t => t !== 'N'), sem + '|tema');
  lista = embaralha([...fixos, ...resto].slice(0, NIVEIS.length), sem + '|ordem');
  const itens = [];
  lista.forEach((t, k) => {
    let nv = NIVEIS[k], P = pool(B, fx, t, nv);
    for (const alt of [nv - 1, nv + 1, nv - 2, nv + 2]) { if (P.length) break; if (alt >= 1 && alt <= 4) { nv = alt; P = pool(B, fx, t, nv) } }
    if (!P.length) return;
    const i = P[((n - 1) % P.length + P.length) % P.length], q = B.temas[t].items[i], id = B.temas[t].ids[i];
    let certa, ops;
    if (t === 'V') { certa = q[1][q[2]]; ops = q[1].slice() }
    else { certa = principal(fx.resposta(t, q)); ops = [certa, ...erradas(B, fx, t, i)] }
    ops = embaralha(ops, sem + '|' + id);
    itens.push({ t, id, q: fx.textoQ(q[0]), o: ops, c: ops.indexOf(certa), nv });
  });
  itens.sort((x, y) => x.nv - y.nv);
  return { dia, n, itens };
}

module.exports = { monta, erradas, pool, chave, diaN, NIVEIS };
