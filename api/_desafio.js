// Desafio do dia: 10 perguntas de múltipla escolha, iguais para todo mundo no mesmo dia (horário de Brasília).
// Só entram perguntas em que as alternativas erradas são confiáveis:
//  - Variedades, que já vêm com as 4 alternativas;
//  - perguntas "de molde" (ex.: "Qual é a capital deste país: X?", "Quem dirigiu o filme X?"), em que as
//    alternativas erradas são respostas de outras perguntas do mesmo molde (sempre o mesmo tipo de coisa);
//  - perguntas de ano ou de quantidade, que recebem números próximos.
// Perguntas escritas à mão, cheias de detalhes ("herói negro da Marvel", "cidade mineira"), ficam de fora.
const crypto = require('crypto');

const INICIO = Date.UTC(2026, 10, 21);           // dia 1 do desafio (lançado em 21/11/2026)
const NIVEIS = [1, 1, 2, 2, 2, 2, 3, 3, 3, 4];   // do mais fácil ao mais difícil
const MIN_MOLDE = 6;                             // um molde precisa de pelo menos 6 perguntas

const h32 = s => crypto.createHash('sha1').update(String(s)).digest().readUInt32BE(0);
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
const principal = a => String(a || '').split(' / ')[0].replace(/\s*\([^)]*\)/g, '').trim();
const alternativas = a => [a, ...String(a || '').split(/\s*[;\/]\s*|\s+ou\s+/)].map(x => norm(String(x).replace(/\([^)]*\)/g, ' '))).filter(Boolean);

// o "molde" da pergunta: o texto com a parte que muda trocada por #
const CAP = "[A-ZÁÉÍÓÚÂÊÔÃÕÇÀ0-9][\\wÀ-ÿ'’.-]*";
const NOME = new RegExp(CAP + "(?:\\s+(?:(?:de|do|da|dos|das|del|di|e|la|le|von|van)\\s+)?" + CAP + ")*", 'g');
function molde(q) {
  q = String(q).replace(/\s*⟦.*?⟧/g, '');
  if (q.includes(':')) return norm(q.split(':')[0]) + ' #';
  if (/["“][^"”]+["”]/.test(q)) return norm(q.replace(/["“][^"”]+["”]/g, '#'));
  const nomes = [...q.matchAll(NOME)].filter(m => m.index > 0);
  if (!nomes.length) return null;
  const m = nomes[nomes.length - 1];
  return norm(q.slice(0, m.index) + '#' + q.slice(m.index + m[0].length));
}
function chave(q) {
  const n = norm(q);
  if (/^(em |no |na )?(que|qual) ano\b/.test(n)) return 'ano';
  if (/^quant/.test(n)) return 'num';
  return null;
}
function forma(a) { // tipo de resposta: ano, número pequeno, lista (fica de fora) ou texto
  if (/^\d{3,4}$/.test(a) && +a >= 100 && +a <= 2100) return 'ano';
  if (/^\d{1,2}$/.test(a)) return 'num';
  if (/[,;]/.test(a) || /\s(e|and)\s/i.test(a)) return 'lista';
  return 'txt';
}
const palavras = a => a.split(/\s+/).length;
const maiuscula = a => /^[A-ZÀ-Ý0-9]/.test(a);
function parecida(a, b) { // mesmo jeito de resposta: maiúscula, número de palavras e tamanho
  if (maiuscula(a) !== maiuscula(b)) return false;
  if (Math.abs(palavras(a) - palavras(b)) > 2) return false;
  const r = b.length / a.length;
  return r >= 0.3 && r <= 3.5;
}
function numeros(a, k, semente) { // anos e números próximos (anos nunca depois de 2026)
  const v = +a, saltos = k === 'ano' ? [-12, -8, -5, -3, -2, -1, 1, 2, 3, 5, 8, 12] : [-3, -2, -1, 1, 2, 3, 4];
  const ok = x => x > 0 && x !== v && (k !== 'ano' || x <= 2026);
  const opc = saltos.map(s => v + s).filter(ok).sort((x, y) => h32(semente + x) - h32(semente + y));
  return opc.length >= 3 ? opc.slice(0, 3).map(String) : null;
}

// índice dos moldes e do que se sabe de cada lugar (cidade → país, país → continente), uma vez por banco
function indice(B, fx) {
  if (B._dsf) return B._dsf;
  const moldes = new Map(), pais = new Map(), cont = new Map();
  const doTexto = (q, re) => { const m = re.exec(String(q).replace(/\s*⟦.*?⟧/g, '')); return m ? norm(m[1]) : null };
  Object.entries(B.temas).forEach(([t, T]) => {
    if (t === 'V') return;
    T.items.forEach((q, i) => {
      if (fx.tipoDe(q)) return; // silhuetas e bandeiras precisam de imagem
      const resp = fx.resposta(t, q), a = principal(resp), nr = norm(a), nq = norm(q[0]);
      // lugares: para preferir alternativas do mesmo país ou continente
      let x;
      if (/^em qual continente fica/.test(nq) && (x = doTexto(q[0], /fica(?: este país:| o| a| os| as)? ([^?]+)\?/))) cont.set(x, nr);
      if (/^qual e a capital deste pais/.test(nq) && (x = doTexto(q[0], /país: ([^?]+)\?/))) pais.set(nr, x);
      if (/ e a capital de qual pais$/.test(nq) && (x = doTexto(q[0], /^(.+?) é a capital/))) pais.set(x, nr);
      if (/^em (que|qual) pais fica a cidade de/.test(nq) && (x = doTexto(q[0], /cidade de ([^?]+)\?/))) pais.set(x, nr);
      const f = forma(a), m = molde(q[0]);
      if (!a || a.length > 40 || f !== 'txt' || !m) return;
      const c = t + '|' + m;
      if (!moldes.has(c)) moldes.set(c, []);
      moldes.get(c).push({ t, i, a, n: nr, b: String(fx.bucketOf(t, q)) });
    });
  });
  // só valem moldes com pelo menos 6 perguntas e 4 respostas diferentes
  for (const [c, l] of moldes) if (l.length < MIN_MOLDE || new Set(l.map(r => r.n)).size < 4) moldes.delete(c);
  return (B._dsf = { moldes, pais, cont, pools: {} });
}
function continente(X, n) { return X.cont.get(n) || (X.pais.has(n) ? X.cont.get(X.pais.get(n)) : null) || null }
function parentesco(X, a, b) { // 2: mesmo país; 1: mesmo continente; 0: nada em comum (ou não se sabe)
  if (X.pais.has(a) && X.pais.has(b) && X.pais.get(a) === X.pais.get(b)) return 2;
  const ca = continente(X, a), cb = continente(X, b);
  return ca && cb && ca === cb ? 1 : 0;
}

// as 3 alternativas erradas (ou null se a pergunta não serve); com "so", só diz se serve
function erradas(B, fx, t, i, so) {
  const nao = so ? false : null;
  const q = B.temas[t].items[i], resp = fx.resposta(t, q), a = principal(resp);
  if (fx.tipoDe(q) || !a || a.length > 40) return nao;
  const f = forma(a), k = chave(q[0]), semente = B.temas[t].ids[i];
  if (f === 'lista') return nao;
  if (f === 'ano' || f === 'num') { const r = (k === 'ano' || k === 'num' || f === 'ano') ? numeros(a, f, semente) : null; return so ? !!r : r }
  const X = indice(B, fx), m = molde(q[0]), irmas = m && X.moldes.get(t + '|' + m);
  if (!irmas) return nao;
  const proibidas = new Set(alternativas(resp)), na = norm(a), b = String(fx.bucketOf(t, q));
  const tok = new Set(na.split(' ').filter(w => w.length >= 4)), nq = ' ' + norm(q[0]) + ' ';
  // não vale: igual à certa, com palavra em comum com ela, que já aparece na pergunta, ou de formato muito diferente
  const serve = r => !(r.t === t && r.i === i) && !proibidas.has(r.n) && parecida(a, r.a) &&
    !r.n.split(' ').some(w => w.length >= 4 && tok.has(w)) && !nq.includes(' ' + r.n + ' ');
  const vistas = new Set(), cand = [];
  for (const r of irmas) if (!vistas.has(r.n) && serve(r)) { vistas.add(r.n); cand.push(r) }
  if (cand.length < 3) return nao;
  if (so) return true;
  // primeiro as do mesmo assunto e do mesmo país/continente; o resto vem embaralhado
  const nota = r => (r.b === b ? 4 : 0) + parentesco(X, na, r.n);
  cand.sort((x, y) => nota(y) - nota(x) || h32(semente + x.n) - h32(semente + y.n));
  const topo = nota(cand[0]), melhores = cand.filter(r => nota(r) === topo);
  return (melhores.length >= 3 ? melhores : cand).slice(0, 3).map(r => r.a);
}

// perguntas que podem entrar no desafio, por tema e nível, numa ordem fixa embaralhada
function pool(B, fx, t, nv) {
  const X = indice(B, fx), c = t + '|' + nv;
  if (X.pools[c]) return X.pools[c];
  const T = B.temas[t], l = [];
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
  const resto = embaralha(lista.filter(t => t !== 'N'), sem + '|tema');
  lista = embaralha([...fixos, ...resto], sem + '|ordem');
  const itens = [];
  for (const t of lista) {
    if (itens.length >= NIVEIS.length) break;
    let nv = NIVEIS[itens.length], P = pool(B, fx, t, nv);
    for (const alt of [nv - 1, nv + 1, nv - 2, nv + 2]) { if (P.length) break; if (alt >= 1 && alt <= 4) { nv = alt; P = pool(B, fx, t, nv) } }
    if (!P.length) continue;   // tema sem pergunta que sirva: passa para o próximo
    const i = P[((n - 1) % P.length + P.length) % P.length], q = B.temas[t].items[i], id = B.temas[t].ids[i];
    let certa, ops;
    if (t === 'V') { certa = q[1][q[2]]; ops = q[1].slice() }
    else { certa = principal(fx.resposta(t, q)); ops = [certa, ...erradas(B, fx, t, i)] }
    ops = embaralha(ops, sem + '|' + id);
    itens.push({ t, id, q: fx.textoQ(q[0]), o: ops, c: ops.indexOf(certa), nv });
  }
  itens.sort((x, y) => x.nv - y.nv);
  return { dia, n, itens };
}

module.exports = { monta, erradas, pool, molde, diaN, NIVEIS };
