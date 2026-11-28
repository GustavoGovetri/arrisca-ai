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
const semArtigo = c => c.replace(/\b(do|da|dos|das|de)\b/g, 'de').replace(/\b(no|na|nos|nas|em)\b/g, 'em');
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
      if (/^qual e a capital d(e|o|a|os|as) /.test(nq) && (x = doTexto(q[0], /capital d(?:e|o|a|os|as) ([^?]+)\?/))) pais.set(nr, x);
      if (/^em (que|qual) pais fica a cidade de/.test(nq) && (x = doTexto(q[0], /cidade de ([^?]+)\?/))) pais.set(x, nr);
      const f = forma(a), m = molde(q[0]);
      if (!a || a.length > 40 || f !== 'txt' || !m) return;
      const c = t + '|' + m;
      if (!moldes.has(c)) moldes.set(c, []);
      moldes.get(c).push({ t, i, a, n: nr, b: String(fx.bucketOf(t, q)), nv: fx.qDiff(t, q) });
    });
  });
  // para escolher as erradas, o mesmo molde com outro artigo também vale (capital da França, do Japão, de Portugal)
  const juntos = new Map();
  for (const [c, l] of moldes) { const k = semArtigo(c); juntos.set(k, (juntos.get(k) || []).concat(l)) }
  // só valem moldes com pelo menos 6 perguntas e 4 respostas diferentes
  for (const [c, l] of moldes) if (l.length < MIN_MOLDE || new Set(l.map(r => r.n)).size < 4) moldes.delete(c);
  return (B._dsf = { moldes, juntos, pais, cont, pools: {} });
}
// capitais dos estados: nunca se misturam com capitais de países (Lisboa x Recife)
const CAP_BR = new Set(['rio branco', 'maceio', 'macapa', 'manaus', 'salvador', 'fortaleza', 'vitoria', 'goiania', 'sao luis', 'cuiaba', 'campo grande', 'belo horizonte', 'belem', 'joao pessoa', 'curitiba', 'recife', 'teresina', 'rio de janeiro', 'natal', 'porto alegre', 'porto velho', 'boa vista', 'florianopolis', 'sao paulo', 'aracaju', 'palmas']);
function continente(X, n) { return X.cont.get(n) || (X.pais.has(n) ? X.cont.get(X.pais.get(n)) : null) || null }
function parentesco(X, a, b) { // 2: mesmo país; 1: mesmo continente; 0: nada em comum (ou não se sabe)
  if (CAP_BR.has(a) && CAP_BR.has(b)) return 2;
  if (X.pais.has(a) && X.pais.has(b) && X.pais.get(a) === X.pais.get(b)) return 2;
  const ca = continente(X, a), cb = continente(X, b);
  return ca && cb && ca === cb ? 1 : 0;
}

// ----- "o que significa a sigla X?" -----
// As erradas são a própria resposta com uma ou duas palavras trocadas por outras com a mesma inicial, tiradas das outras
// siglas do banco (mesma língua e mesmo papel na expressão): continuam batendo com as letras da sigla e nenhuma posição
// entrega a certa pela maioria (cada palavra trocada aparece em metade das alternativas).
const LIGA = new Set('de da do das dos e em para por com sem sobre entre a o as os ao à the of and for to in on by at per one two three four five non not no'.split(' ')); // ligações e números ficam como estão
function siglaDe(q) {
  const n = String(q).replace(/\s*⟦.*?⟧/g, '');
  if (!/significa|quer dizer|por extenso/i.test(n)) return null;
  const m = /\bsigla\s+([A-Za-z0-9][A-Za-z0-9&.\-]*)/.exec(n);
  if (!m || (m[1].match(/[A-Z0-9]/g) || []).length < 2) return null;
  return m[1].replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
const tiraAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const raiz = w => tiraAcento(w).replace(/s$/, '');
const simples = w => /^[A-Za-zÀ-ÿ]{3,}$/.test(w) && !/[A-ZÀ-Ý]/.test(w.slice(1)); // sem sigla, número ou MaiúsculaNoMeio
const conteudo = w => !LIGA.has(w.toLowerCase());
const quase = (x, y) => { // a mesma palavra com uma letra diferente (Disc e Disk)
  x = raiz(x); y = raiz(y);
  if (x === y) return true;
  if (Math.abs(x.length - y.length) > 1) return false;
  let i = 0; while (i < x.length && x[i] === y[i]) i++;
  return x.slice(i + (x.length >= y.length ? 1 : 0)) === y.slice(i + (y.length >= x.length ? 1 : 0));
};
const prefixo = w => tiraAcento(w).slice(0, 5);
function linguaDe(a) { // português: acento, ligação (de, da, e…) ou a maioria das palavras terminando em o/a
  if (/[áàâãéêíóôõúç]/i.test(a) || /\b(de|da|do|das|dos|e|para|em|com|sobre)\b/i.test(a)) return 'pt';
  const ws = a.split(/[\s-]+/).filter(w => /^[A-Za-z]{3,}$/.test(w) && conteudo(w));
  return ws.length && ws.filter(w => /[oa]$/i.test(w)).length * 2 > ws.length ? 'pt' : 'en';
}
// papel da palavra: em inglês o núcleo é a última (Network, Protocol) e as outras qualificam; em português o núcleo
// é a primeira (Unidade, Instituto), depois de "de/da/do" vem outro substantivo, e o resto qualifica
function papeis(partes, lg) {
  const idx = partes.map((w, j) => j).filter(j => j % 2 === 0 && partes[j] && conteudo(partes[j]));
  return partes.map((w, j) => {
    if (j % 2 || !w || !conteudo(w)) return null;
    if (lg === 'en') return j === idx[idx.length - 1] ? 'nucleo' : 'mod';
    if (j === idx[0]) return 'nucleo';
    const antes = partes.slice(0, j).filter((x, k) => k % 2 === 0 && x).pop();
    return antes && LIGA.has(antes.toLowerCase()) ? 'nucleo' : 'mod';
  });
}
function genero(w) { // concordância em português: feminino, masculino ou a letra final
  const f = tiraAcento(w);
  if (/(cao|sao|coes|dade|gem|a)$/.test(f)) return 'f';
  if (/(o|or|mento)$/.test(f)) return 'm';
  return f.slice(-1);
}
function siglaBoa(t, q, resp, voc) { // a resposta é uma expansão que dá para mexer? devolve as partes e a língua
  const sg = siglaDe(q[0]), a = principal(resp);
  if (!sg || !a || /[,;:]/.test(a)) return null; // listas (Red, Green, Blue) ficam de fora
  if (new RegExp('\\b' + sg + '\\b', 'i').test(tiraAcento(a))) return null; // sigla recursiva (GNU's Not Unix)
  if (/fundador|irmãos|marca/i.test(resp)) return null;
  const lg = linguaDe(a), partes = a.split(/([\s-]+)/);
  // marcas por extenso (Bayerische Motoren Werke, Kentucky Fried Chicken): nenhuma palavra aparece em outra sigla
  if (voc && t === 'S' && lg === 'en' && partes.every((w, j) => j % 2 || !simples(w) || !conteudo(w) || (voc.freq.get('en|' + raiz(w)) || 0) <= 1)) return null;
  return { sg, a, lg, partes };
}
function vocabulario(B, fx) { // palavras das siglas do banco, por língua, inicial e papel
  const X = indice(B, fx);
  if (X.voc) return X.voc;
  const voc = new Map(), freq = new Map(), lista = [];
  Object.entries(B.temas).forEach(([t, T]) => {
    if (t === 'V') return;
    T.items.forEach(q => { const r = siglaBoa(t, q, String(fx.resposta(t, q) || ''), null); if (r) lista.push([t, r]) });
  });
  lista.forEach(([, r]) => new Set(r.partes.filter((w, j) => j % 2 === 0 && simples(w) && conteudo(w)).map(raiz)).forEach(k => freq.set(r.lg + '|' + k, (freq.get(r.lg + '|' + k) || 0) + 1)));
  voc.freq = freq;
  lista.forEach(([t, r]) => {
    if (t === 'S' && r.lg === 'en' && r.partes.every((w, j) => j % 2 || !simples(w) || !conteudo(w) || (freq.get('en|' + raiz(w)) || 0) <= 1)) return; // marca
    const pp = papeis(r.partes, r.lg);
    r.partes.forEach((w, j) => {
      if (!pp[j] || !simples(w)) return;
      if (r.lg === 'en' && (freq.get('en|' + raiz(w)) || 0) < 2) return; // em inglês, só palavras de mais de uma sigla (tira nomes como Amazon)
      const k = r.lg + '|' + tiraAcento(w)[0] + '|' + pp[j];
      if (!voc.has(k)) voc.set(k, new Map());
      if (!voc.get(k).has(raiz(w))) voc.get(k).set(raiz(w), w);
    });
  });
  return (X.voc = voc);
}
function siglaErradas(B, fx, t, q, resp, semente) {
  const voc = vocabulario(B, fx), r = siglaBoa(t, q, resp, voc);
  if (!r) return null;
  const { lg, partes } = r, pp = papeis(partes, lg), proibidas = new Set(alternativas(resp));
  const usadas = new Set(partes.filter((_, j) => j % 2 === 0).map(raiz));
  const pos = []; // posições que dá para trocar e as palavras possíveis em cada uma
  partes.forEach((w, j) => {
    if (!pp[j] || !simples(w)) return;
    const m = voc.get(lg + '|' + tiraAcento(w)[0] + '|' + pp[j]);
    if (!m) return;
    const cap = /^[A-ZÀ-Ý]/.test(w), g = lg === 'pt' ? genero(w) : null;
    const ops = [...m.values()].filter(c => (!g || genero(c) === g) && !usadas.has(raiz(c)) && !quase(c, w) && prefixo(c) !== prefixo(w) && !raiz(c).startsWith(raiz(w)) && !raiz(w).startsWith(raiz(c)))
      .map(c => cap ? c[0].toUpperCase() + c.slice(1) : c.toLowerCase())
      .sort((x, y) => h32(semente + '|' + x) - h32(semente + '|' + y));
    if (ops.length) pos.push({ j, ops });
  });
  pos.sort((x, y) => h32(semente + '#' + x.j) - h32(semente + '#' + y.j));
  // uma palavra nova diferente para cada posição
  const escolhe = ps => { const ja = new Set(), out = []; for (const p of ps) { const w = p.ops.find(o => !ja.has(prefixo(o))); if (!w) return null; ja.add(prefixo(w)); out.push([p.j, w]) } return out };
  const troca = mudas => { const p = partes.slice(); mudas.forEach(([j, w]) => { p[j] = w }); return p.join('') };
  let out = null;
  if (pos.length >= 3) { const e = escolhe(pos.slice(0, 3)); if (e) { const [X, Y, Z] = e; out = [troca([X, Y]), troca([X, Z]), troca([Y, Z])] } }
  else if (pos.length === 2) { const e = escolhe(pos); if (e) { const [X, Y] = e; out = [troca([X]), troca([Y]), troca([X, Y])] } }
  else if (pos.length === 1) { const ops = pos[0].ops.filter((o, k, l) => l.findIndex(x => prefixo(x) === prefixo(o)) === k); if (ops.length >= 3) out = ops.slice(0, 3).map(w => troca([[pos[0].j, w]])) }
  if (!out || new Set(out.map(norm)).size < 3 || out.some(o => proibidas.has(norm(o)))) return null;
  return out;
}

// as 3 alternativas erradas (ou null se a pergunta não serve); com "so", só diz se serve
function erradas(B, fx, t, i, so) {
  const nao = so ? false : null;
  const q = B.temas[t].items[i], resp = fx.resposta(t, q), a = principal(resp);
  if (fx.tipoDe(q) || !a || a.length > 40) return nao;
  const f = forma(a), k = chave(q[0]), semente = B.temas[t].ids[i];
  if (f === 'lista') return nao;
  if (f === 'ano' || f === 'num') { const r = (k === 'ano' || k === 'num' || f === 'ano') ? numeros(a, f, semente) : null; return so ? !!r : r }
  // sigla: as erradas trocam palavras da própria resposta. Se não der, a pergunta sai do desafio (nunca entra uma que antes não entrava)
  const sg = siglaDe(q[0]) ? siglaErradas(B, fx, t, q, resp, semente) : null;
  if (siglaDe(q[0]) && !sg) return nao;
  if (sg && !so) return sg;
  const X = indice(B, fx), m = molde(q[0]), irmas = m && !FORA.some(re => re.test(norm(q[0]))) && X.moldes.get(t + '|' + m);
  if (!irmas) return nao;
  const proibidas = new Set(alternativas(resp)), na = norm(a), b = String(fx.bucketOf(t, q));
  const tok = new Set(na.split(' ').filter(w => w.length >= 4)), nq = ' ' + norm(q[0]) + ' ', capital = /^ qual e a capital d/.test(nq);
  // não vale: igual à certa, com palavra em comum com ela, que já aparece na pergunta, ou de formato muito diferente
  const serve = r => !(r.t === t && r.i === i) && !proibidas.has(r.n) && parecida(a, r.a) &&
    !r.n.split(' ').some(w => w.length >= 4 && tok.has(w)) && !nq.includes(' ' + r.n + ' ') && (!capital || CAP_BR.has(r.n) === CAP_BR.has(na));
  const vistas = new Set(), cand = [];
  for (const r of irmas) if (!vistas.has(r.n) && serve(r)) { vistas.add(r.n); cand.push(r) }
  if (cand.length < 3) return nao;
  if (so) return true;
  // quem entra no desafio continua igual (molde exato); as erradas podem vir também do mesmo molde com outro artigo
  for (const r of X.juntos.get(semArtigo(t + '|' + m)) || []) if (!vistas.has(r.n) && serve(r)) { vistas.add(r.n); cand.push(r) }
  // primeiro as do mesmo país/continente, do mesmo assunto e de dificuldade parecida (capital fácil com capital conhecida); o resto vem embaralhado
  const nv = fx.qDiff(t, q), nota = r => parentesco(X, na, r.n) * 3 + (r.b === b ? 2 : 0) + (Math.abs((r.nv || 2) - nv) <= 1 ? 1 : 0);
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
    const sobra = embaralha(lista, sem + '|ordem'), out = [], resps = new Set();
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
      const [t, alt] = achou, k = t + '|' + alt, P = pool(B, fx, t, alt);
      let usado = st.cont.get(k) || 0;
      // no mesmo dia, nada de duas com a mesma resposta: a que bateria fica para a próxima volta da fila (sem repetir antes)
      for (let n = 0; n < P.length && resps.has(respostaDe(B, fx, t, P[usado % P.length])); n++) usado++;
      resps.add(respostaDe(B, fx, t, P[usado % P.length]));
      sobra.splice(sobra.indexOf(t), 1);
      out.push([t, alt, usado % P.length]);
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

// as 4 alternativas de uma pergunta que serve (a certa primeiro), para a Sobrevivência relâmpago; null se não serve
function opcoes(B, fx, t, i) {
  const q = B.temas[t].items[i];
  if (t === 'V') return Array.isArray(q[1]) && q[1].length === 4 ? { certa: q[1][q[2]], ops: q[1].slice() } : null;
  const e = erradas(B, fx, t, i);
  if (!e) return null;
  const certa = principal(fx.resposta(t, q));
  return { certa, ops: [certa, ...e] };
}

module.exports = { monta, erradas, pool, opcoes, molde, diaN, diaDe, NIVEIS, siglaErradas, siglaDe };
