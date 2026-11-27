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
    // As salas usam um segundo "app" com login anônimo (invisível, sem conta): cada aparelho ganha uma
    // identidade própria e as regras do banco deixam cada um mexer só no que é dele (nome, presença, chat).
    // Fica separado da conta do jogador, então entrar ou sair da conta não atrapalha a sala.
    const salaApp=app.initializeApp(cfg,'sala');
    const d=await import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`);
    const db=d.getDatabase(salaApp);
    const R=p=>d.ref(db,p);
    // Só fica conectado ao banco enquanto precisa (dentro de uma sala online ou mandando um reporte).
    // Cada aba conectada conta no limite do plano grátis, então quem está só na tela inicial não ocupa vaga.
    d.goOffline(db);
    let USO=0,LIGADO=false,REAL=false,DESLIGA=null;const AVISA=[];
    const conta=()=>{const ok=REAL||!USO;AVISA.forEach(cb=>cb(ok))}; // fora de sala, "sem conexão" não é problema
    const liga=()=>{USO++;clearTimeout(DESLIGA);if(!LIGADO){LIGADO=true;d.goOnline(db)}conta()};
    const solta=()=>{USO=Math.max(0,USO-1);if(USO)return;clearTimeout(DESLIGA);
      DESLIGA=setTimeout(()=>{if(!USO&&LIGADO){LIGADO=false;d.goOffline(db);conta()}},15000)}; // espera um pouco: dá tempo de gravar a saída e evita liga-desliga
    const op=async f=>{liga();try{return await f()}finally{solta()}};
    let UID=null,AU=null;
    const ANON=(async()=>{
      try{
        const a=await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
        const au=a.getAuth(salaApp);AU=au;
        if(typeof au.authStateReady==='function')await au.authStateReady();
        if(!au.currentUser)await a.signInAnonymously(au);
        UID=au.currentUser?au.currentUser.uid:null;
      }catch(e){console.warn('Sala sem identidade anônima:',(e&&e.code)||e)}
      return UID;
    })();
    const comId=o=>UID?Object.assign({},o,{u:UID}):o; // marca o que este aparelho grava (as regras conferem)
    let OFF=0;d.onValue(R('.info/serverTimeOffset'),x=>{OFF=Number(x.val())||0});
    d.onValue(R('.info/connected'),s=>{REAL=!!s.val();conta()}); // diferença entre o relógio do aparelho e o do servidor
    window.NET_IMPL={
      agora(){return Date.now()+OFF},
      estado(){return {uso:USO,ligado:LIGADO,conectado:REAL}}, // para conferir se está ocupando vaga no banco
      async exists(code){return op(async()=>(await d.get(R('salas/'+code+'/meta'))).exists())},
      watch(code,h){
        liga();let solto=false;
        const u=[d.onValue(R('salas/'+code+'/meta'),s=>h.onMeta(s.val())),
                 d.onValue(R('salas/'+code+'/titulos'),s=>h.onTitulos&&h.onTitulos(s.val()||{})),
                 d.onValue(R('salas/'+code+'/respostas'),s=>h.onRespostas&&h.onRespostas(s.val()||{})),
                 d.onValue(R('salas/'+code+'/jogadores'),s=>h.onLobby(s.val()||{})),
                 d.onValue(R('salas/'+code+'/estado'),s=>h.onState(s.val())),
                 d.onValue(R('salas/'+code+'/votos'),s=>h.onVotes&&h.onVotes(s.val()||{})),
                 d.onValue(d.query(R('salas/'+code+'/chat'),d.limitToLast(60)),s=>{const a=[];s.forEach(c=>{const v=c.val();if(v&&typeof v==='object')a.push(Object.assign({},v,{id:c.key}))});h.onChat&&h.onChat(a)})];
        return ()=>{u.forEach(f=>f());if(!solto){solto=true;solta()}};
      },
      async setMe(code,dev,obj){return op(async()=>{
        await ANON;
        const r=R('salas/'+code+'/jogadores/'+dev);
        await d.update(r,comId(obj));
        d.onDisconnect(d.child(r,'on')).set(false);
      })},
      async removePlayer(code,dev){return op(async()=>{await ANON;await d.remove(R('salas/'+code+'/jogadores/'+dev))})},
      async marcaPedido(code,dev,obj){return op(async()=>{await ANON;await d.update(R('salas/'+code+'/jogadores/'+dev),obj)})}, // quem criou a sala responde a um pedido de entrada
      // histórico de perguntas de cada aparelho na sala: quem sorteia evita o que qualquer um ali já viu
      async setUsadas(code,dev,obj){return op(async()=>{await ANON;await d.set(R('salas/'+code+'/usadas/'+dev),comId(obj))})},
      async getUsadas(code){return op(async()=>(await d.get(R('salas/'+code+'/usadas'))).val()||{})},
      async chat(code,msg){return op(async()=>{await ANON;await d.push(R('salas/'+code+'/chat'),comId(Object.assign({},msg,{ts:d.serverTimestamp()})))})}, // hora do servidor: a ordem não depende do relógio de cada aparelho
      async report(r){return op(async()=>{await ANON;await d.push(R('reportes'),comId(r))})},
      onConnected(cb){AVISA.push(cb);cb(REAL||!USO)},
      // token da identidade anônima: o servidor guarda de quem é este aparelho na sala (as regras conferem)
      async anonToken(){await ANON;try{return AU&&AU.currentUser?await AU.currentUser.getIdToken():null}catch(e){return null}}
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
      onChange(cb){window.addEventListener('auth-recheca',()=>cb(quem(auth.currentUser)));return a.onAuthStateChanged(auth,u=>{if(window.AUTH_CHECANDO)return;cb(quem(u))})},
      async google(){
        const p=new a.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});
        // no celular, ir para a página do Google e voltar funciona melhor que pop-up (só no endereço oficial, onde o login é do próprio site)
        const proprio=fbApp.options.authDomain===location.hostname;
        const celular=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
        if(proprio&&celular){await a.signInWithRedirect(auth,p);return}
        try{await a.signInWithPopup(auth,p)}
        catch(e){if(proprio&&(e.code==='auth/popup-blocked'||e.code==='auth/operation-not-supported-in-this-environment')){await a.signInWithRedirect(auth,p);return}throw e}
      },
      async resultadoRedirect(){try{await a.getRedirectResult(auth);return null}catch(e){return e}},
      // conta de e-mail e senha só entra depois de confirmar o e-mail (o link chega na hora em que a conta é criada)
      async entrar(email,senha){
        window.AUTH_CHECANDO=true;
        try{
          const c=await a.signInWithEmailAndPassword(auth,email,senha);
          if(!c.user.emailVerified){try{await c.user.reload()}catch(e){}}
          if(!auth.currentUser||!auth.currentUser.emailVerified){await a.signOut(auth);throw Object.assign(new Error('auth/email-nao-confirmado'),{code:'auth/email-nao-confirmado'})}
        }finally{window.AUTH_CHECANDO=false}
        window.dispatchEvent(new Event('auth-recheca'));
      },
      async criar(email,senha,nome){
        window.AUTH_CHECANDO=true;
        try{
          const c=await a.createUserWithEmailAndPassword(auth,email,senha);
          if(nome){try{await a.updateProfile(c.user,{displayName:nome})}catch(e){}}
          try{await a.sendEmailVerification(c.user)}catch(e){}
          await a.signOut(auth);
        }finally{window.AUTH_CHECANDO=false}
      },
      async reenviarCom(email,senha){ // manda o link de novo (precisa entrar rapidinho para isso) e sai
        window.AUTH_CHECANDO=true;
        try{const c=await a.signInWithEmailAndPassword(auth,email,senha);if(!c.user.emailVerified)await a.sendEmailVerification(c.user);await a.signOut(auth)}
        finally{window.AUTH_CHECANDO=false}
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
