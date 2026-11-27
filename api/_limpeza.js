// Limpeza diária das salas paradas: uma sala sem nenhuma jogada há DIAS dias sai do banco, junto com o que o servidor
// guardou dela (chaves dos aparelhos, histórico, respostas, palpites, pontos já contados, vínculo com contas, sala pública).
// Contas, ranking, conquistas e histórico de partidas de cada jogador ficam em usuarios/ e ranking/ e não são tocados.
const ST = require('./_store');
const DIAS = 7, POR_VEZ = 300, LOTE = 25;
const CODIGO = /^[A-Z0-9]{4,6}$/;

async function limpaSalas(agora = Date.now()) {
  const todas = Object.keys((await ST.ler('salas', 'shallow=true')) || {}).filter(c => CODIGO.test(c));
  // em dias com muitas salas, olha um pedaço por vez (o resto fica para os próximos dias)
  for (let i = todas.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [todas[i], todas[j]] = [todas[j], todas[i]] }
  const olhar = todas.slice(0, POR_VEZ), limite = agora - DIAS * 864e5, velhas = [];
  for (let i = 0; i < olhar.length; i += LOTE) {
    const lote = olhar.slice(i, i + LOTE);
    const ts = await Promise.all(lote.map(c => Promise.all([ST.ler('salas/' + c + '/estado/ts'), ST.ler('salas/' + c + '/meta/criada')])));
    lote.forEach((c, k) => { const ult = Math.max(+ts[k][0] || 0, +ts[k][1] || 0); if (ult < limite) velhas.push(c) });
  }
  if (velhas.length) {
    const mapa = {};
    for (const c of velhas) for (const p of ['salas/', 'publicas/', 'srv/chaves/', 'srv/hist/', 'srv/resp/', 'srv/palp/', 'srv/reg/', 'srv/contas/', 'srv/donos/']) mapa[p + c] = null;
    await ST.gravaVarios(mapa);
  }
  return { salas: todas.length, olhadas: olhar.length, apagadas: velhas.length };
}

module.exports = { limpaSalas, DIAS };
