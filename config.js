// Configuração pública do Firebase (não é segredo: o acesso é controlado pelas regras do banco).
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyA4SoyI8ENB71tdvvcn8IvC6Ae8mT8CFUo",
  // no site oficial, o login passa pelo próprio endereço (/__/auth é repassado ao Firebase pela Vercel):
  // a janela do Google não vira "pop-up de outro site" e o login por redirecionamento funciona no celular
  authDomain: location.hostname === "arrisca-ai.vercel.app" ? "arrisca-ai.vercel.app" : "arrisca-ai.firebaseapp.com",
  databaseURL: "https://arrisca-ai-default-rtdb.firebaseio.com",
  projectId: "arrisca-ai",
  storageBucket: "arrisca-ai.firebasestorage.app",
  messagingSenderId: "94259796425",
  appId: "1:94259796425:web:5d98f3d3414b3e7120f018"
};
