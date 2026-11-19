// Conexão com o Firebase Realtime Database (salas online e reportes).
// A configuração fica em config.js (window.FIREBASE_CONFIG).
const V='10.12.2';
const cfg=window.FIREBASE_CONFIG;
const sim=new URLSearchParams(location.search).get('net')==='local';
if(cfg&&cfg.databaseURL&&!sim){
  try{
    const app=await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
    const d=await import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`);
    const db=d.getDatabase(app.initializeApp(cfg));
    const R=p=>d.ref(db,p);
    window.NET_IMPL={
      async exists(code){return (await d.get(R('salas/'+code+'/meta'))).exists()},
      async create(code,meta){await d.set(R('salas/'+code+'/meta'),meta)},
      watch(code,h){
        const u=[d.onValue(R('salas/'+code+'/meta'),s=>h.onMeta(s.val())),
                 d.onValue(R('salas/'+code+'/jogadores'),s=>h.onLobby(s.val()||{})),
                 d.onValue(R('salas/'+code+'/estado'),s=>h.onState(s.val())),
                 d.onValue(R('salas/'+code+'/votos'),s=>h.onVotes&&h.onVotes(s.val()||{})),
                 d.onValue(d.query(R('salas/'+code+'/chat'),d.limitToLast(60)),s=>{const a=[];s.forEach(c=>{const v=c.val();if(v&&typeof v==='object')a.push(Object.assign({},v,{id:c.key}))});h.onChat&&h.onChat(a)})];
        return ()=>u.forEach(f=>f());
      },
      async setMe(code,dev,obj){
        const r=R('salas/'+code+'/jogadores/'+dev);
        await d.update(r,obj);
        d.onDisconnect(d.child(r,'on')).set(false);
      },
      async removePlayer(code,dev){await d.remove(R('salas/'+code+'/jogadores/'+dev))},
      async tx(code,base,val){
        const res=await d.runTransaction(R('salas/'+code+'/estado'),cur=>{const v=(cur&&cur.v)||0;if(v!==base)return;return val},{applyLocally:false});
        return res.committed;
      },
      async vote(code,dev,obj){await d.set(R('salas/'+code+'/votos/'+dev),obj)},
      async chat(code,msg){await d.push(R('salas/'+code+'/chat'),Object.assign({},msg,{ts:d.serverTimestamp()}))}, // hora do servidor: a ordem não depende do relógio de cada aparelho
      async report(r){await d.push(R('reportes'),r)},
      onConnected(cb){d.onValue(R('.info/connected'),s=>cb(!!s.val()))}
    };
  }catch(e){console.warn('Modo online indisponível:',e)}
}
window.NET_DONE=true;
window.dispatchEvent(new Event('net-ready'));
