// Leitura e gravação no banco (Firebase) com a conta de serviço. Nos testes locais, tudo fica na memória.
const { DB, token, dbReq } = require('./_fb');

const DEV = !!process.env.ARRISCA_DEV_SALAS;
const MEM = DEV ? { usuarios: {}, ranking: {}, srv: {}, reportes: {
  r1: { t: 'H', id: 'h12', q: 'Em que ano foi a Proclamação da República no Brasil?', a: '1889', motivo: 'Resposta errada', nota: 'acho que está certo, só testando', quando: '2026-11-18T22:10:00.000Z' },
  r2: { t: 'GG', id: 'g7', q: 'Qual é o nome do encanador mais famoso dos games?', a: 'Mario', motivo: 'Nível de dificuldade errado', nivelAtual: 'Difícil', nivelCerto: 'Fácil', quando: '2026-11-19T10:00:00.000Z' }
} } : null;

const partes = c => String(c).split('/').filter(Boolean);
const copia = v => v == null ? null : JSON.parse(JSON.stringify(v));

async function ler(caminho, consulta) {
  if (DEV) { let o = MEM; for (const k of partes(caminho)) { if (o == null || typeof o !== 'object') return null; o = o[k] } return copia(o === undefined ? null : o) }
  const url = DB + '/' + caminho + '.json?access_token=' + encodeURIComponent(await token()) + (consulta ? '&' + consulta : '');
  const r = await fetch(url);
  if (!r.ok) throw Object.assign(new Error('O banco respondeu ' + r.status), { status: 502 });
  return r.json();
}

function memGrava(caminho, metodo, valor) {
  const ks = partes(caminho), ult = ks.pop();
  let o = MEM; for (const k of ks) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k] }
  if (metodo === 'DELETE' || valor === null) delete o[ult];
  else if (metodo === 'PATCH') o[ult] = Object.assign(o[ult] && typeof o[ult] === 'object' ? o[ult] : {}, copia(valor));
  else o[ult] = copia(valor);
}

async function grava(metodo, caminho, valor) {
  if (DEV) return memGrava(caminho, metodo, valor);
  await dbReq(metodo, caminho, valor);
}

// vários caminhos de uma vez (tudo ou nada); valor null apaga
async function gravaVarios(mapa) {
  if (!Object.keys(mapa).length) return;
  if (DEV) { for (const [c, v] of Object.entries(mapa)) memGrava(c, 'PUT', v); return }
  await dbReq('PATCH', '', mapa);
}

// leitura com "etiqueta" e gravação só se ninguém mudou no meio (para duas jogadas ao mesmo tempo não se atropelarem)
async function lerEtag(caminho) {
  if (DEV) { const v = await ler(caminho); return { v, etag: JSON.stringify(v) } }
  const r = await fetch(DB + '/' + caminho + '.json?access_token=' + encodeURIComponent(await token()), { headers: { 'X-Firebase-ETag': 'true' } });
  if (!r.ok) throw Object.assign(new Error('O banco respondeu ' + r.status), { status: 502 });
  return { v: await r.json(), etag: r.headers.get('etag') };
}
async function gravaSe(caminho, valor, etag) {
  if (DEV) { const v = await ler(caminho); if (JSON.stringify(v) !== etag) return false; memGrava(caminho, 'PUT', valor); return true }
  const r = await fetch(DB + '/' + caminho + '.json?access_token=' + encodeURIComponent(await token()), {
    method: 'PUT', headers: { 'content-type': 'application/json', 'if-match': etag || 'null_etag' }, body: JSON.stringify(valor) });
  if (r.status === 412) return false;
  if (!r.ok) throw Object.assign(new Error('O banco respondeu ' + r.status), { status: 502 });
  return true;
}

module.exports = { DEV, MEM, ler, grava, gravaVarios, lerEtag, gravaSe };
