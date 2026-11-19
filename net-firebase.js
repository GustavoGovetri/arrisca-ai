// Conexão com o Firebase Realtime Database (salas online e reportes).
// A configuração fica em config.js (window.FIREBASE_CONFIG).
const V='10.12.2';
const cfg=window.FIREBASE_CONFIG;
const sim=new URLSearchParams(location.search).get('net')==='local';
if(cfg&&cfg.databaseURL&&!sim){
  try{
    const app=await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
    const fbApp=app.initializeApp(cfg);
    carregaLogin(fbApp); // em paralelo: não atrasa o modo online
    const d=await import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`);
    const db=d.getDatabase(fbApp);
    const R=p=>d.ref(db,p);
    let OFF=0;d.onValue(R('.info/serverTimeOffset'),x=>{OFF=Number(x.val())||0}); // diferença entre o relógio do aparelho e o do servidor
    window.NET_IMPL={
      agora(){return Date.now()+OFF},
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
      // histórico de perguntas de cada aparelho na sala: quem sorteia evita o que qualquer um ali já viu
      async setUsadas(code,dev,obj){await d.set(R('salas/'+code+'/usadas/'+dev),obj)},
      async getUsadas(code){return (await d.get(R('salas/'+code+'/usadas'))).val()||{}},
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
// ----- login (contas): Google ou e-mail e senha -----
async function carregaLogin(fbApp){
  try{
    const a=await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
    const auth=a.getAuth(fbApp);
    auth.languageCode='pt-BR'; // e-mails de confirmação e de nova senha em português
    const quem=u=>u&&!u.isAnonymous?{uid:u.uid,email:u.email||'',nome:u.displayName||'',verificado:!!u.emailVerified,
      provedor:((u.providerData||[]).find(x=>x&&x.providerId==='google.com')?'google.com':'password')}:null;
    window.AUTH_IMPL={
      onChange(cb){return a.onAuthStateChanged(auth,u=>cb(quem(u)))},
      async google(){const p=new a.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});await a.signInWithPopup(auth,p)},
      async entrar(email,senha){await a.signInWithEmailAndPassword(auth,email,senha)},
      async criar(email,senha,nome){
        const c=await a.createUserWithEmailAndPassword(auth,email,senha);
        if(nome){try{await a.updateProfile(c.user,{displayName:nome})}catch(e){}}
        try{await a.sendEmailVerification(c.user)}catch(e){}
      },
      async esqueci(email){await a.sendPasswordResetEmail(auth,email)},
      async reenviar(){if(auth.currentUser)await a.sendEmailVerification(auth.currentUser)},
      async recarrega(){if(auth.currentUser){await auth.currentUser.reload();return quem(auth.currentUser)}return null},
      async token(forca){return auth.currentUser?auth.currentUser.getIdToken(!!forca):null},
      async sair(){await a.signOut(auth)},
      async apagar(){if(auth.currentUser)await auth.currentUser.delete()}
    };
  }catch(e){console.warn('Login indisponível:',e);window.AUTH_ERRO=String((e&&(e.code||e.message))||e).slice(0,160)}
  window.AUTH_DONE=true;
  window.dispatchEvent(new Event('auth-ready'));
}
if(!(cfg&&cfg.databaseURL&&!sim)){window.AUTH_DONE=true;window.dispatchEvent(new Event('auth-ready'))}
window.NET_DONE=true;
window.dispatchEvent(new Event('net-ready'));
