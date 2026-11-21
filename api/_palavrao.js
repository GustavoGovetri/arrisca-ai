// Filtro de palavrão do Arrisca Aí (o mesmo código está no index.html, em "filtro de palavrão").
// Confere palavra por palavra, sem acento, com números no lugar de letras (p0rr4) e letras repetidas (porraaa).
// A palavra trocada fica com a primeira letra e bolinhas: "p••••".
const EXATO = new Set(('cu cus cuzinho cuzao cuzona cuzoes fdp vsf vtnc tnc tmnc pqp pnc crl cct prr poha pora poras porinha ' +
  'krl kct karai karaio puta putas puto putos putinha putinho putao viado viados viadinho viadao bicha bichas boiola baitola traveco sapatao ' +
  'corno cornos cornao vadia vadias otario otaria otarios otarias babaca babacas retardado retardada retardados mongoloide ' +
  'bosta bostas merda merdas cacete cacetes carai caraio xota xotas xereca ' +
  'shit shits shity cunt cunts dick dicks pusy ashole whore whores slut sluts fag fags fagot niga nigas').split(' '));
const INICIO = ['caralh', 'karalh', 'cralh', 'bucet', 'bocet', 'arombad', 'merd', 'fod', 'fude', 'fudi', 'punhet', 'siriric', 'boquet', 'piroc', 'piroq',
  'xoxot', 'escrot', 'vagabund', 'putari', 'puteir', 'fuck', 'bitch', 'cacet'];
const CONTEM = ['fuck', 'caralh', 'bucet', 'bocet', 'arombad', 'putari', 'punhet', 'siriric'];
const CRU = new Set(['nigger', 'niggers', 'nigga', 'niggas', 'faggot', 'faggots', 'pussy']); // sem juntar letras repetidas (niger é o país)
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

function base(w) {
  return String(w).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[013457@$]/g, c => LEET[c]).replace(/[^a-z]/g, '');
}
function feia(w) {
  if (w === 'Cu') return false; // cobre, na tabela periódica
  const cru = base(w);
  if (!cru) return false;
  if (CRU.has(cru)) return true;
  const n = cru.replace(/(.)\1+/g, '$1');
  if (EXATO.has(n)) return true;
  if (INICIO.some(p => n.startsWith(p))) return true;
  return CONTEM.some(p => n.includes(p));
}
const PEDACO = /[\p{L}\p{N}@$]+/gu;
function tem(t) { return (String(t || '').match(PEDACO) || []).some(feia) }
function limpa(t) {
  return String(t || '').replace(PEDACO, w => feia(w) ? w[0] + '•'.repeat(Math.max(2, [...w].length - 1)) : w);
}
module.exports = { tem, limpa, feia };
