// Versão do site que está no ar (o commit publicado). O site pergunta de vez em quando e, se mudou, recarrega sozinho.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=20');
  res.status(200).json({ v: (process.env.VERCEL_GIT_COMMIT_SHA || process.env.ARRISCA_VERSAO || 'local').slice(0, 12) });
};
