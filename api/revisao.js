// Copia os reportes abertos para o repositório privado de perguntas, para o Claude revisar (ver _revisao.js).
// A Vercel chama uma vez por dia (vercel.json → crons). O dono também pode mandar na hora, pelo painel.
// Se a variável CRON_SECRET existir na Vercel, só aceita a chamada da própria Vercel.
const { freia } = require('./_limite');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const seg = process.env.CRON_SECRET;
    if (seg && req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'Não autorizado.' });
    freia(req, 'revisao', 6, 3600e3);
    res.status(200).json(await require('./_revisao').revisa());
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message || 'Erro' });
  }
};
