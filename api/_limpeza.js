// Limpeza diária das salas paradas: sai do banco a sala sem ninguém conectado e sem jogada há VAZIA_H horas,
// e qualquer sala sem nenhuma jogada há DIAS dias (mesmo com alguém aparecendo como conectado). Sai junto o que o servidor
// guardou dela (chaves dos aparelhos, histórico, respostas, palpites, pontos já contados, vínculo com contas, sala pública).
// Contas, ranking, conquistas e histórico de partidas de cada jogador ficam em usuarios/ e ranking/ e não são tocados.
const ST = require('./_store');
const DIAS = 7, VAZIA_H = 12, POR_VEZ = 300, LOTE = 25;
const CODIGO = /^[A-Z0-9]{4,6}$/;

async function limpaSalas(agora = Date.now()) {
  const todas = Object.keys((await ST.ler('salas', 'shallow=true')) || {}).filter(c => CODIGO.test(c));
  // em dias com muitas salas, olha um pedaço por vez (o resto fica para os próximos dias)
  for (let i = todas.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [todas[i], todas[j]] = [todas[j], todas[i]] }
  const olhar = todas.slice(0, POR_VEZ), limite = agora - DIAS * 864e5, limiteVazia = agora - VAZIA_H * 3600e3, velhas = [];
  // alguém conectado: o Firebase marca on=false sozinho quando a conexão do aparelho cai
  const temGente = j => Object.values(j && typeof j === 'object' ? j : {}).some(x => x && typeof x === 'object' && x.on !== false);
  for (let i = 0; i < olhar.length; i += LOTE) {
    const lote = olhar.slice(i, i + LOTE);
    const ts = await Promise.all(lote.map(c => Promise.all([ST.ler('salas/' + c + '/estado/ts'), ST.ler('salas/' + c + '/meta/criada')])));
    const parados = lote.filter((c, k) => Math.max(+ts[k][0] || 0, +ts[k][1] || 0) < limiteVazia);
    const jog = await Promise.all(parados.map(c => ST.ler('salas/' + c + '/jogadores')));
    parados.forEach((c, k) => {
      const ult = Math.max(+ts[lote.indexOf(c)][0] || 0, +ts[lote.indexOf(c)][1] || 0);
      if (ult < limite || !temGente(jog[k])) velhas.push(c);
    });
  }
  if (velhas.length) {
    const mapa = {};
    for (const c of velhas) for (const p of ['salas/', 'publicas/', 'srv/chaves/', 'srv/hist/', 'srv/resp/', 'srv/palp/', 'srv/reg/', 'srv/regv/', 'srv/regs/', 'srv/sv/', 'srv/svresp/', 'srv/svreg/', 'srv/svfim/', 'srv/fq/', 'srv/contas/', 'srv/donos/']) mapa[p + c] = null;
    await ST.gravaVarios(mapa);
  }
  return { salas: todas.length, olhadas: olhar.length, apagadas: velhas.length };
}

module.exports = { limpaSalas, DIAS, VAZIA_H };
