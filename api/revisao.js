// Copia os reportes abertos para o repositório privado de perguntas, para o Claude revisar (ver _revisao.js).
// A Vercel chama uma vez por dia (vercel.json → crons). O dono também pode mandar na hora, pelo painel.
// Depois da cópia, apaga as salas vazias paradas há mais de 12 horas e qualquer sala parada há mais de 7 dias (_limpeza.js).
// Só aceita a chamada da própria Vercel, com o segredo CRON_SECRET (configurado na Vercel).
const { freia } = require('./_limite');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    // trancado: sem o segredo certo, ninguém roda (a revisão na hora é pelo painel do dono, que confere a conta)
    const seg = process.env.CRON_SECRET;
    if (!seg) return res.status(503).json({ erro: 'Falta configurar o CRON_SECRET na Vercel.' });
    const veio = Buffer.from(String(req.headers.authorization || '')), certo = Buffer.from('Bearer ' + seg);
    if (veio.length !== certo.length || !require('crypto').timingSafeEqual(veio, certo)) return res.status(401).json({ erro: 'Não autorizado.' });
    freia(req, 'revisao', 6, 3600e3);
    const out = await require('./_revisao').revisa();
    // e apaga as salas paradas há mais de 7 dias (não mexe em contas nem no ranking)
    try { out.limpeza = await require('./_limpeza').limpaSalas() } catch (e) { out.limpeza = { erro: e.message } }
    res.status(200).json(out);
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message || 'Erro' });
  }
};
