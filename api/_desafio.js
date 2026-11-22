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
const MIN_NIVEL = 25;                            // nível com menos perguntas que isso fica de fora (repetiria demais)
// moldes que não servem: o Pokémon pode ter dois tipos, e a alternativa "errada" pode ser o outro
const FORA = [/\btipo\b.*\bpokemon\b|\bpokemon\b.*\btipo\b/];
const VAZIAS = new Set('o a os as um uma de do da dos das em no na nos nas que qual quais quem como e para por com se ao pelo pela foi era tem nome'.split(' '));
const palavrasQ = q => new Set(norm(String(q).replace(/\s*⟦.*?⟧/g, '')).split(' ').filter(w => w.length > 2 && !VAZIAS.has(w)));
const parecidas = (a, b) => { let n = 0; a.forEach(w => { if (b.has(w)) n++ }); return n / (a.size + b.size - n || 1) };

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
  const X = indice(B, fx), m = molde(q[0]), irmas = m && !FORA.some(re => re.test(norm(q[0]))) && X.moldes.get(t + '|' + m);
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

const respostaDe = (B, fx, t, i) => { const q = B.temas[t].items[i]; return norm(t === 'V' ? q[1][q[2]] : principal(fx.resposta(t, q))) };
// todas as perguntas do tema que servem, sem as quase repetidas (mesma resposta e texto parecido)
function doTema(B, fx, t) {
  const X = indice(B, fx);
  if (X.pools['*' + t]) return X.pools['*' + t];
  const T = B.temas[t], l = [], porResp = new Map();
  if (!X.donos) { // a mesma pergunta pode estar em dois temas: vale só a primeira
    X.donos = new Map();
    Object.entries(B.temas).forEach(([tt, TT]) => TT.items.forEach((q, i) => { const k = norm(q[0]); if (!X.donos.has(k)) X.donos.set(k, tt + '|' + i) }));
  }
  T.items.forEach((q, i) => {
    if (X.donos.get(norm(q[0])) !== t + '|' + i) return;
    const ok = t === 'V' ? Array.isArray(q[1]) && q[1].length === 4 : erradas(B, fx, t, i, true);
    if (!ok) return;
    const r = respostaDe(B, fx, t, i), w = palavrasQ(q[0]), ja = porResp.get(r) || [];
    if (ja.some(o => parecidas(o, w) >= 0.4)) return;
    ja.push(w); porResp.set(r, ja); l.push(i);
  });
  l.sort((x, y) => h32('ordem|' + T.ids[x]) - h32('ordem|' + T.ids[y]));
  return (X.pools['*' + t] = l);
}
// as do tema num nível, numa ordem fixa embaralhada
function pool(B, fx, t, nv) {
  const X = indice(B, fx), c = t + '|' + nv;
  if (!X.pools[c]) X.pools[c] = doTema(B, fx, t).filter(i => fx.qDiff(t, B.temas[t].items[i]) === nv);
  return X.pools[c];
}

const diaN = dia => Math.round((Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8, 10)) - INICIO) / 864e5) + 1;
function embaralha(a, semente) { return a.map(x => [h32(semente + '|' + x), x]).sort((x, y) => x[0] - y[0]).map(x => x[1]) }

// os planos dos dias, em sequência a partir do dia 1: quais temas entram, em qual nível, e qual pergunta da
// fila daquele tema/nível é a da vez. Cada nível vai para o tema que menos gastou a sua fila, então as perguntas
// só se repetem quando a fila inteira já saiu.
const diaDe = d => new Date(INICIO + (d - 1) * 864e5).toISOString().slice(0, 10);
function plano(B, fx, n, temas) {
  const X = indice(B, fx);
  if (!X.pl) X.pl = { dias: [], cont: new Map() };
  const st = X.pl, lista = temas.filter(t => t !== 'N' && B.temas[t] && B.temas[t].items.length);
  while (st.dias.length < Math.max(1, n)) {
    const d = st.dias.length + 1, dia = diaDe(d), sem = 'dia|' + dia;
    // Natal: em dezembro, uma pergunta dia sim, dia não (1, 3, 5... até o dia 25), sem repetir
    const natal = dia.slice(5, 7) === '12' && B.temas.N ? doTema(B, fx, 'N') : [], dd = +dia.slice(8, 10), posN = (dd - 1) / 2;
    const comNatal = dd % 2 === 1 && posN < natal.length;
    const niveis = comNatal ? [1, 1, 2, 2, 2, 3, 3, 3, 4] : NIVEIS;
    const sobra = embaralha(lista, sem + '|ordem'), out = [];
    const gasto = (t, nv) => (st.cont.get(t + '|' + nv) || 0) / pool(B, fx, t, nv).length;
    for (const nv of niveis) {
      let achou = null;
      for (const alt of [nv, nv + 1, nv - 1, nv + 2, nv - 2]) {
        if (alt < 1 || alt > 4) continue;
        const c = sobra.filter(x => pool(B, fx, x, alt).length >= MIN_NIVEL);
        if (!c.length) continue;
        c.sort((x, y) => gasto(x, alt) - gasto(y, alt)); // a ordem do dia desempata
        achou = [c[0], alt]; break;
      }
      if (!achou) break;
      const [t, alt] = achou, k = t + '|' + alt, usado = st.cont.get(k) || 0;
      sobra.splice(sobra.indexOf(t), 1);
      out.push([t, alt, usado % pool(B, fx, t, alt).length]);
      st.cont.set(k, usado + 1);
    }
    if (comNatal) out.push(['N', 0, posN]);
    st.dias.push(out);
  }
  return st.dias[Math.max(1, n) - 1];
}

// monta o desafio de um dia: [{t, id, q, o: [4 alternativas], c: índice da certa, nv}]
function monta(B, fx, dia, temas) {
  const n = diaN(dia), sem = 'dia|' + dia;
  const itens = [], respostas = new Set();
  for (const [t, nvP, pos] of plano(B, fx, n, temas)) {
    const P = t === 'N' ? doTema(B, fx, 'N') : pool(B, fx, t, nvP);
    // no mesmo dia, nada de duas perguntas com a mesma resposta (pula para outra mais adiante na fila)
    let i = P[pos];
    for (let k = 1; k < P.length && respostas.has(respostaDe(B, fx, t, i)); k++) i = P[(pos + k * 13) % P.length];
    if (respostas.has(respostaDe(B, fx, t, i))) continue;
    respostas.add(respostaDe(B, fx, t, i));
    const q = B.temas[t].items[i], id = B.temas[t].ids[i], nv = fx.qDiff(t, q);
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
