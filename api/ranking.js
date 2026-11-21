// Ranking da semana e do mês (público). Com o login no cabeçalho, também diz a posição de quem pediu.
//   GET ?periodo=semana|mes
const { verifica } = require('./_auth');
const { limpa: semPalavrao } = require('./_palavrao');
const { ler } = require('./_store');
const ST = require('./_stats');

const TOP = 50;
const fotoMini = f => typeof f === 'string' && f.length <= 12000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(f) ? f : null;
const tituloOk = t => t && typeof t === 'object' && typeof t.x === 'string' ? { x: t.x.slice(0, 40), n: Math.max(1, Math.min(7, +t.n || 1)) } : null;
let CACHE = {}; // período → { t, lista } (30 s)

module.exports = async (req, res) => {
  try {
    const periodo = (req.query && req.query.periodo) === 'mes' ? 'mes' : 'semana';
    const per = ST.periodo(), id = per[periodo];
    let c = CACHE[periodo + id];
    if (!c || Date.now() - c.t > 30000) {
      const dados = await ler('ranking/' + periodo + '/' + id);
      const lista = Object.entries(dados || {}).filter(([, v]) => v && +v.p > 0)
        .map(([uid, v]) => ({ uid, p: Math.floor(+v.p), n: semPalavrao(String(v.n || 'Jogador').slice(0, 16)), c: /^#[0-9a-f]{6}$/i.test(v.c || '') ? v.c : null, t: tituloOk(v.t), f: fotoMini(v.f) }))
        .sort((a, b) => b.p - a.p || a.n.localeCompare(b.n));
      c = CACHE[periodo + id] = { t: Date.now(), lista };
    }
    let eu = null;
    const h = (req.headers && req.headers.authorization) || '';
    const m = /^Bearer\s+(.+)$/i.exec(h);
    if (m) { try { eu = (await verifica(m[1].trim())).uid } catch (e) { eu = null } }
    let pos = 0, minha = null;
    const top = c.lista.map((x, i) => {
      if (i > 0 && x.p < c.lista[i - 1].p) pos = i; // empate fica na mesma posição
      const linha = { pos: pos + 1, p: x.p, n: x.n, c: x.c, t: x.t, f: x.f, eu: !!eu && x.uid === eu };
      if (linha.eu) minha = linha;
      return linha;
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ periodo, id, texto: periodo === 'semana' ? 'Semana de ' + per.semanaTxt : nomeMes(per.mes), lista: top.slice(0, TOP), minha, total: top.length });
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message || 'Erro' });
  }
};

function nomeMes(id) {
  const [a, m] = id.split('-');
  return ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][+m - 1] + ' de ' + a;
}
