/* Moncloa Game · configuración de la partida online
   Por defecto el juego conecta los móviles directamente (PeerJS), sin cuentas ni servidores propios.
   Si alguna vez falla la conexión entre ciertos móviles o redes, puedes usar Firebase, que es gratis
   y más fiable: crea un proyecto en https://console.firebase.google.com, añade una «Realtime Database»
   y pega aquí los datos de tu app web (lo explica el LEEME.md). */
window.MONCLOA_CONFIG = {
  firebase: null
  // firebase: {
  //   apiKey: "…",
  //   authDomain: "tu-proyecto.firebaseapp.com",
  //   databaseURL: "https://tu-proyecto-default-rtdb.europe-west1.firebasedatabase.app",
  //   projectId: "tu-proyecto",
  //   appId: "…"
  // }
};
