// Recebe os avisos de problema ("Reportar bug") do Arrisca Aí (função da Vercel).
//   POST /api/bugs   {tipo, texto, nome, info}
// Guarda em /bugs no Firebase, que só esta função escreve e ninguém de fora lê.
// Para ler: console do Firebase → Realtime Database → Dados → bugs.
const { dbReq } = require('./_fb');
const { ip } = require('./_limite');

const TIPOS = ['travou', 'visual', 'online', 'som', 'outro'];
const DEV = !!process.env.ARRISCA_DEV_SALAS; // testes locais: guarda em memória
const MEM = [];
const JANELA = 10 * 60 * 1000, LIMITE = 6;   // até 6 avisos por aparelho a cada 10 minutos (melhor esforço)
const VISTOS = new Map();

const txt = (x, n) => String(x == null ? '' : x).replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, n);
function limpaInfo(info) {
  if (!info || typeof info !== 'object') return null;
  const s = JSON.stringify(info);
  if (s.length > 6000) return { cortado: true, inicio: s.slice(0, 6000) };
  return info;
}

async function handle(body, quem) {
  const texto = txt(body.texto, 1500);
  if (texto.length < 5) throw Object.assign(new Error('Conte um pouco mais do que aconteceu.'), { status: 400 });
  const agora = Date.now();
  const lista = (VISTOS.get(quem) || []).filter(t => agora - t < JANELA);
  if (lista.length >= LIMITE) throw Object.assign(new Error('Muitos avisos seguidos. Tente de novo daqui a pouco.'), { status: 429 });
  lista.push(agora); VISTOS.set(quem, lista);
  const bug = {
    tipo: TIPOS.includes(body.tipo) ? body.tipo : 'outro',
    texto,
    nome: txt(body.nome, 16),
    info: limpaInfo(body.info),
    versao: (process.env.VERCEL_GIT_COMMIT_SHA || 'local').slice(0, 7),
    quando: new Date(agora).toISOString()
  };
  if (DEV) MEM.push(bug);
  else await dbReq('POST', 'bugs', bug);
  return { ok: true };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    if (DEV && req.query && req.query.acao === 'lista') return res.status(200).json({ bugs: MEM });
    return res.status(405).json({ erro: 'Use POST' });
  }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body) } catch (e) { body = {} } }
  const quem = DEV ? String((body && body.dev) || 'x').slice(0, 64) : ip(req);
  try { res.status(200).json(await handle(body || {}, quem)) }
  catch (e) { res.status(e.status || 500).json({ erro: e.message || 'Erro' }) }
};

module.exports.MEM = MEM; // testes locais: o painel lê daqui
