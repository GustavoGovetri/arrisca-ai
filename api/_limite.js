// Freio contra abuso: conta pedidos por endereço (IP) numa janela de tempo e recusa o excesso.
// Fica na memória de cada instância da Vercel (melhor esforço): não segura um ataque grande,
// mas impede que alguém baixe o banco inteiro de perguntas ou encha o banco de lixo em poucos minutos.
const DEV = !!process.env.ARRISCA_DEV_SALAS; // testes locais: sem freio
const CONTAS = new Map();

function ip(req) {
  const h = (req && req.headers) || {};
  const v = h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0];
  return String(v || 'x').trim().slice(0, 64);
}

// nome: o que está sendo limitado; max pedidos a cada janela (ms) por endereço
function freia(req, nome, max, janela) {
  if (DEV) return;
  const agora = Date.now(), k = nome + '|' + ip(req);
  let c = CONTAS.get(k);
  if (!c || agora - c.t > janela) { c = { t: agora, n: 0 }; CONTAS.set(k, c) }
  c.n++;
  if (CONTAS.size > 20000) for (const [kk, v] of CONTAS) if (agora - v.t > 3600e3) CONTAS.delete(kk);
  if (c.n > max) throw Object.assign(new Error('Muitos pedidos seguidos. Espere um pouco e tente de novo.'), { status: 429 });
}

module.exports = { freia, ip };
