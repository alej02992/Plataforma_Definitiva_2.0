/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — SERVICIO DE PLATAFORMA (SIMULADO)

   Este archivo representa al BACKEND que todavía no existe.

   ---------------------------------------------------------------------
   CONTRATO CON EL BACKEND REAL

     POST   /api/sesion            { usuario, clave }
       → { id, nombre, rol, campana, extension, permisos }
     POST   /api/sip/credencial    (con el token de sesión)
       → { wss, dominio, extension, clave, ice, venceEn }
     GET    /api/campanas          → estado de cada campaña
     GET    /api/agentes           → agentes conectados y su estado
     GET    /api/colas             → llamadas en espera
     GET    /api/formularios       → definiciones por campaña
     POST   /api/formularios       → crear o modificar
     POST   /api/respuestas        → envío de formularios diligenciados
     GET    /api/reportes/:tipo    → datos para descargar

   Los datos EN VIVO (campañas, agentes, colas) vendrán de los eventos
   del AMI de Asterisk, no de consultas repetidas. Ver Sección 8 del
   manual de integración.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

/* ═══════════════════════════════════════════════════════════════
   Los datos de negocio (contactos, catálogo de tipificación y
   marcación rápida) vienen del backend. Aquí solo quedan las
   estructuras vacías que el código necesita para no fallar mientras
   el servidor responde.
   ═══════════════════════════════════════════════════════════════ */

const DIRECTORIO = [];
const CATALOGO = {};

const servicio = (() => {

  /* ═════════════════════════════════════════════════════════════════
     USUARIOS · en producción: tabla `usuario`
     Cada persona YA trae su extensión — requisito de la reunión:
     "la persona debe ser equivalente a la extensión que se crea".
     ═════════════════════════════════════════════════════════════════ */

  /* ═════════════════════════════════════════════════════════════════
     CAMPAÑAS Y COLAS
     Cada campaña se corresponde con una cola de Asterisk. Ese vínculo
     decide qué catálogo ve el agente y en qué panel aparece la llamada.
     La extensión de la cola es a donde se transfiere.
     ═════════════════════════════════════════════════════════════════ */

  /* ═════════════════════════════════════════════════════════════════
     ESTADO EN VIVO (simulado)
     En producción llega por WebSocket desde el backend, que a su vez
     lo recibe del AMI de Asterisk.
     ═════════════════════════════════════════════════════════════════ */
  const ESTADOS_AGENTE = ['Disponible', 'En llamada', 'Cierre', 'Baño',
                          'Almuerzo', 'Break', 'Retroalimentación'];

  /* El panel de supervisión se alimenta de los eventos que emite la
     central. Mientras ese módulo no exista, no se inventan agentes ni
     colas: el panel se muestra vacío y lo dice. */
  const vivo = { agentes: [], colas: [] };

  /** Avanza la simulación un segundo. pantalla.js la llama con un intervalo. */

  const estadoVivo = () => ({
    agentes: vivo.agentes.map((a) => ({ ...a })),
    colas: vivo.colas.map((c) => ({ ...c })),
  });

  /* ═════════════════════════════════════════════════════════════════
     FORMULARIOS · tablas `formulario` y `formulario_campo`
     El administrador y el supervisor los crean; el agente los llena.
     ═════════════════════════════════════════════════════════════════ */
  const CLAVE_FORMS = 'bpm.formularios';

  const TIPOS_CAMPO = [
    { id: 'texto',       nombre: 'Texto corto' },
    { id: 'texto_largo', nombre: 'Texto largo' },
    { id: 'numero',      nombre: 'Número' },
    { id: 'fecha',       nombre: 'Fecha' },
    { id: 'opcion',      nombre: 'Lista de opciones' },
    { id: 'casilla',     nombre: 'Casilla de verificación' },
  ];

  function formularios() {
    try {
      const g = localStorage.getItem(CLAVE_FORMS);
      if (g) return JSON.parse(g);
    } catch { /* modo privado */ }
    return [];
  }

  function guardarFormularios(lista) {
    try { localStorage.setItem(CLAVE_FORMS, JSON.stringify(lista)); } catch { /* nada */ }
  }

  /** Formularios activos de una campaña. Es lo que ve el agente. */
  function formulariosDe(campana) {
    return formularios().filter((f) => f.activo && (f.campana === campana || f.campana === 'Todas'));
  }

  /* ═════════════════════════════════════════════════════════════════
     RESPUESTAS SIN CONEXIÓN
     El agente diligencia; si el envío falla, la respuesta queda en una
     cola local con estado "pendiente" y se reintenta. Nunca se pierde.
     ═════════════════════════════════════════════════════════════════ */
  const CLAVE_COLA = 'bpm.respuestas.pendientes';

  function pendientes() {
    try { return JSON.parse(localStorage.getItem(CLAVE_COLA) || '[]'); }
    catch { return []; }
  }

  function guardarPendientes(lista) {
    try { localStorage.setItem(CLAVE_COLA, JSON.stringify(lista)); } catch { /* nada */ }
  }

  /** Encola una respuesta. Se guarda SIEMPRE antes de intentar enviarla. */
  function encolarRespuesta(resp) {
    const lista = pendientes();
    lista.push({
      ...resp,
      id: 'r' + Date.now() + Math.floor(Math.random() * 1000),
      creado: new Date().toISOString(),
      intentos: 0,
    });
    guardarPendientes(lista);
    return lista.length;
  }

  /**
   * Intenta enviar lo pendiente.
   * Reemplazar por: POST /api/respuestas
   * `hayRed` simula la disponibilidad del backend, para poder demostrar
   * el comportamiento sin conexión durante la presentación.
   */
  async function sincronizar(hayRed) {
    await demora(400);
    const lista = pendientes();
    if (!lista.length) return { enviadas: 0, quedan: 0 };
    if (hayRed === false) {
      lista.forEach((r) => { r.intentos++; });
      guardarPendientes(lista);
      throw new Error('Sin conexión con el servidor. Las respuestas quedan guardadas.');
    }
    guardarPendientes([]);
    return { enviadas: lista.length, quedan: 0 };
  }

  /* ═════════════════════════════════════════════════════════════════
     REPORTES · en producción salen de consultas sobre llamada/interaccion
     ═════════════════════════════════════════════════════════════════ */
  const TIPOS_REPORTE = [
    { id: 'agentes',  nombre: 'Actividad por agente',
      desc: 'Estado actual, llamadas atendidas y tiempo medio de operación.' },
    { id: 'campanas', nombre: 'Resumen por campaña',
      desc: 'Atendidas, abandonadas y nivel de servicio.' },
    { id: 'llamadas', nombre: 'Detalle de llamadas',
      desc: 'Una fila por llamada de esta sesión, con su tipificación.' },
    { id: 'pausas',   nombre: 'Pausas del turno',
      desc: 'Cuánto tiempo estuvo cada agente en cada pausa.' },
  ];

  /** Devuelve { columnas, filas } listo para pintar o descargar en CSV. */
  function generarReporte(tipo) {
    const v = estadoVivo();

    if (tipo === 'agentes') {
      return {
        columnas: ['Extensión', 'Agente', 'Campaña', 'Estado', 'Llamadas', 'TMO (s)'],
        filas: v.agentes.map((a) => [a.ext, a.nombre, a.campana, a.estado, a.llamadas, a.tmo]),
      };
    }
    if (tipo === 'campanas') {
      return {
        columnas: ['Campaña', 'Tipo', 'Activa', 'En espera', 'Atendidas', 'Abandonadas', 'Nivel (%)'],
        /* Este reporte se alimentaba de la lista local de campañas.
           Ahora las campañas viven en la base; lo servirá el backend. */
        filas: [],
      };
    }
    if (tipo === 'pausas') {
      /* Las pausas se registran en la tabla `pausa` de la base. Este
         reporte lo servirá el backend; antes inventaba los tiempos. */
      return { columnas: ['Extensión', 'Agente', 'Pausa', 'Segundos', 'Minutos'], filas: [] };
    }
    return { columnas: [], filas: [] };   // 'llamadas' lo arma pantalla.js
  }

  /* ═════════════════════════════════════════════════════════════════
     HORARIOS
     "El supervisor puede tomar acciones como cerrar horarios."
     ═════════════════════════════════════════════════════════════════ */
  const CLAVE_HOR = 'bpm.horarios';

  function horarios() {
    try {
      const g = localStorage.getItem(CLAVE_HOR);
      if (g) return JSON.parse(g);
    } catch { /* nada */ }
    return JSON.parse(JSON.stringify([]));
  }
  function guardarHorarios(l) {
    try { localStorage.setItem(CLAVE_HOR, JSON.stringify(l)); } catch { /* nada */ }
  }

  function hayPbxConfigurada() {
    return !!(CONFIG.pbx.wss && CONFIG.pbx.dominio && !CONFIG.simulador);
  }

  /** Inicia sesión contra el backend. La contraseña se valida en el
      servidor con bcrypt; la plataforma nunca la comprueba por su
      cuenta ni guarda usuarios propios. */
  async function autenticar(usuario, clave) {
    if (!hayApi()) {
      throw new Error('No hay conexión con el servidor. Avisa al área de tecnología.');
    }
    const d = await api('POST', '/sesion', { usuario, clave });
    guardarToken(d.token);
    return { ...d.usuario, usuario: d.usuario.usuario || usuario };
  }

  /** Credencial telefónica de la sesión. La emite el servidor: es
      temporal y cambia en cada inicio de sesión, así que copiarla no
      sirve de nada. */
  async function credencialSip() {
    if (!hayApi()) throw new Error('SIN_PBX');
    const d = await api('POST', '/sesion/sip');
    if (!d.wss || !d.dominio) throw new Error('SIN_PBX');
    return { ...d, ext: d.extension || d.ext };
  }

  /** Cierra la sesión en el servidor, que además invalida la
      credencial telefónica. */
  async function cerrar() {
    if (!hayApi()) return;
    try { await api('DELETE', '/sesion'); } catch { /* la sesión local se borra igual */ }
    borrarToken();
  }

  /* ═════════════════════════════════════════════════════════════════
     UTILIDADES
     ═════════════════════════════════════════════════════════════════ */
  const demora = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ═══════════════════════════════════════════════════════════════
     ACCESO AL BACKEND

     Si CONFIG.api tiene una dirección, la plataforma habla con el
     servidor. Si está vacía, trabaja con los datos locales de este
     archivo, como hasta ahora.

     Así se puede desarrollar y presentar sin backend, y activarlo
     cambiando una línea en js/config.js.
     ═══════════════════════════════════════════════════════════════ */

  const CLAVE_TOKEN = 'bpm.token';

  const hayApi = () => !!(typeof CONFIG !== 'undefined' && CONFIG.api);

  const guardarToken = (t) => { try { sessionStorage.setItem(CLAVE_TOKEN, t); } catch {} };
  const leerToken    = ()  => { try { return sessionStorage.getItem(CLAVE_TOKEN); } catch { return null; } };
  const borrarToken  = ()  => { try { sessionStorage.removeItem(CLAVE_TOKEN); } catch {} };

  /** Llamada al backend. Añade el token y traduce los errores. */
  async function api(metodo, ruta, cuerpo) {
    const token = leerToken();
    let r;
    try {
      r = await fetch(CONFIG.api + ruta, {
        method: metodo,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    } catch (e) {
      throw new Error('No se pudo conectar con el servidor. Revisa que esté encendido.');
    }

    let datos = null;
    try { datos = await r.json(); } catch {}

    /* Un 401 significa "sesión no válida" en casi todas las rutas, pero
       en el cambio de contraseña significa "la clave actual está mal".
       Si se borrara el token ahí, el usuario perdería la sesión por
       escribir mal su contraseña. */
    const esCredencial = ruta === '/sesion' || ruta === '/sesion/clave';
    if (r.status === 401 && !esCredencial) {
      borrarToken();
      throw new Error('La sesión expiró. Vuelve a iniciar sesión.');
    }
    if (!r.ok) throw new Error(datos?.error || 'Error ' + r.status);
    return datos;
  }

  /* ── Datos que el backend sirve cuando está conectado ──────────
     Todas devuelven lo mismo con o sin backend, así que las
     pantallas no cambian.                                          */

  /** Catálogo de tipificación de la campaña del agente. */
  async function catalogoTipificacion(campana) {
    if (hayApi()) {
      try {
        const filas = await api('GET', '/tipificacion' + (campana ? '?campana=' + encodeURIComponent(campana) : ''));
        const cat = {};
        filas.forEach((f) => {
          cat[f.categoria] = cat[f.categoria] || [];
          if (f.subcategoria) cat[f.categoria].push(f.subcategoria);
        });
        return cat;
      } catch { /* si falla, se usa el local */ }
    }
    return CATALOGO;
  }

  /** Estado de la operación en este momento, para el supervisor.
      Sin backend devuelve vacío: no se inventan agentes. */
  async function estadoEnVivo() {
    if (!hayApi()) {
      return { agentes: [], kpis: null, telefonia: { ok: false, motivo: 'Sin backend' } };
    }
    return api('GET', '/vivo');
  }

  /** Grabaciones del servidor de la central. */
  async function listarGrabaciones(filtros = {}) {
    if (!hayApi()) return { total: 0, grabaciones: [], aviso: 'Requiere backend.' };
    const q = new URLSearchParams(
      Object.entries(filtros).filter(([, v]) => v)).toString();
    return api('GET', '/grabaciones' + (q ? '?' + q : ''));
  }

  /** Agentes que tienen grabaciones, para el filtro. */
  async function agentesGrabaciones() {
    if (!hayApi()) return [];
    try { return await api('GET', '/grabaciones/agentes'); }
    catch { return []; }
  }

  /** Dirección para reproducir o descargar una grabación. */
  function urlGrabacion(archivo) {
    if (!hayApi()) return '';
    return CONFIG.api.replace(/\/$/, '') + '/grabaciones/' +
           encodeURIComponent(archivo) + '?token=' + encodeURIComponent(leerToken() || '');
  }

  /* ── Registro y reporte de llamadas ── */

  /** Guarda la llamada en la base. Si falla, no interrumpe al agente:
      la llamada ya está en su historial y se avisa. */
  async function registrarLlamadaServidor(ll) {
    if (!hayApi()) return { ok: false };
    try {
      await api('POST', '/llamadas', ll);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function reporteLlamadas(filtros = {}) {
    const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
    return api('GET', '/reportes/llamadas' + (q ? '?' + q : ''));
  }

  /* ── Formularios (en la base de datos) ── */

  const listarFormularios = (campana) =>
    api('GET', '/formularios' + (campana ? '?campana=' + encodeURIComponent(campana) : ''));

  const leerFormulario = (id) => api('GET', '/formularios/' + id);

  /** Al crearlo, el servidor le agrega los diez datos del contacto. */
  const crearFormulario = (datos) => api('POST', '/formularios', datos);

  /** Guarda nombre, campaña y las preguntas propias. Los campos fijos
      no viajan: el servidor los conserva. */
  const guardarFormulario = (id, datos) => api('PUT', '/formularios/' + id, datos);

  const eliminarFormulario = (id) => api('DELETE', '/formularios/' + id);

  /** Respuesta de un agente durante la llamada. */
  const enviarRespuesta = (id, datos) => api('POST', `/formularios/${id}/respuestas`, datos);

  /* ── Catálogo de ubicaciones ── */

  const listarPaises = () => api('GET', '/ubicaciones/paises');
  const listarDepartamentos = (pais = 'CO') =>
    api('GET', '/ubicaciones/departamentos?pais=' + encodeURIComponent(pais));
  const listarMunicipios = (departamento) =>
    api('GET', '/ubicaciones/municipios?departamento=' + encodeURIComponent(departamento));

  /** Cambia la contraseña del usuario que está en sesión. */
  async function cambiarMiClave(claveActual, claveNueva) {
    if (!hayApi()) {
      /* Sin backend no hay dónde guardarla. Se avisa con claridad en
         lugar de fingir que funcionó. */
      throw new Error('Sin backend no se puede cambiar la contraseña.');
    }
    await api('PUT', '/sesion/clave', { claveActual, claveNueva });
    return { ok: true };
  }

  /** Inicio o fin de una pausa. */
  async function registrarPausa(tipo, entrando) {
    if (hayApi()) {
      try { await api('POST', '/pausas', { tipo, entrando }); return { ok: true }; }
      catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: true };
  }

  /* ═══════════════════════════════════════════════════════════════
     GESTIÓN DE USUARIOS CONTRA EL BACKEND

     Con backend, estas funciones trabajan sobre MySQL. Sin él, sobre
     la lista local de este archivo. Las pantallas no distinguen.
     ═══════════════════════════════════════════════════════════════ */

  /** Lista los usuarios. Siempre devuelve un arreglo. */
  async function listarUsuarios() {
    if (hayApi()) {
      const filas = await api('GET', '/usuarios');
      /* El backend devuelve rol_id; las pantallas esperan el nombre. */
      return filas.map((u) => ({
        id: u.id,
        usuario: u.usuario,
        nombre: u.nombre,
        correo: u.correo,
        rol: u.rol || ROL_POR_ID[u.rol_id] || 'agente',
        rol_id: u.rol_id,
        campana: u.campana || '',
        campana_id: u.campana_id,
        extension: u.extension || '',
        activo: u.activo !== 0 && u.activo !== false,
      }));
    }
    return [];
  }

  const ROL_POR_ID = { 1: 'agente', 2: 'supervisor', 3: 'admin' };
  const ID_POR_ROL = { agente: 1, supervisor: 2, admin: 3 };

  /** Crea o modifica un usuario. La contraseña NO se envía: al crear,
      el backend asigna la temporal y exige el cambio en el primer
      acceso. */
  async function guardarUsuarioRemoto(datos) {
    if (!hayApi()) return guardarUsuario(datos);

    const cuerpo = {
      usuario: datos.usuario,
      nombre: datos.nombre,
      correo: datos.correo || null,
      rol_id: datos.rol_id || ID_POR_ROL[datos.rol] || 1,
      campana_id: datos.campana_id || null,
      extension: datos.extension || null,
    };

    try {
      if (datos.id) {
        await api('PUT', '/usuarios/' + datos.id, cuerpo);
        return { ok: true, actualizado: true };
      }
      const r = await api('POST', '/usuarios', cuerpo);
      return { ok: true, id: r.id, extensionCreada: r.extensionCreada, motivo: r.motivo };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Cambia el rol de un usuario. */
  async function cambiarRolRemoto(id, usuario, rol) {
    if (!hayApi()) return cambiarRol(usuario, rol);
    try {
      await api('PUT', '/usuarios/' + id, { rol_id: ID_POR_ROL[rol] });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Reasigna la campaña de un usuario. */
  async function cambiarCampanaRemoto(id, usuario, campanaId, campana) {
    if (!hayApi()) return cambiarCampana(usuario, campana);
    try {
      await api('PUT', '/usuarios/' + id, { campana_id: campanaId });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Devuelve al usuario a la contraseña temporal. */
  async function restablecerClave(id) {
    if (!hayApi()) return { ok: false, error: 'Requiere backend.' };
    try {
      const r = await api('POST', '/usuarios/' + id + '/restablecer');
      return { ok: true, claveTemporal: r.claveTemporal };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Desactiva un usuario. No se borra, para no perder su historial. */
  async function desactivarUsuario(id) {
    if (!hayApi()) return { ok: false, error: 'Requiere backend.' };
    try {
      await api('DELETE', '/usuarios/' + id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Crea o modifica una campaña. */
  async function guardarCampana(datos) {
    if (!hayApi()) return { ok: false, error: 'Requiere backend.' };
    try {
      if (datos.id) {
        await api('PUT', '/campanas/' + datos.id, datos);
        return { ok: true, actualizada: true };
      }
      const r = await api('POST', '/campanas', datos);
      return { ok: true, id: r.id, colaCreada: r.colaCreada, motivo: r.motivo };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Desactiva una campaña. */
  async function eliminarCampana(id) {
    if (!hayApi()) return { ok: false, error: 'Requiere backend.' };
    try {
      await api('DELETE', '/campanas/' + id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Abre o cierra la campaña. Sin backend opera sobre los datos
      locales, para que la plataforma siga siendo usable. */
  async function alternarHorario(id) {
    if (!hayApi()) return { ok: false, error: 'Requiere conexión con el servidor.' };
    try {
      const r = await api('PUT', '/campanas/' + id + '/horario');
      return { ok: true, abierta: r.abierta };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Lista las grabaciones del servidor, con filtros opcionales. */

  /** Vuelve a activar un usuario dado de baja. */
  async function reactivarUsuario(id) {
    if (!hayApi()) return { ok: false, error: 'Requiere backend.' };
    try {
      await api('PUT', '/usuarios/' + id, { activo: true });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Campañas, desde el backend o locales. */
  async function listarCampanas() {
    if (hayApi()) {
      try { return await api('GET', '/campanas'); } catch { /* cae al local */ }
    }
    return [];
  }

  /* ── Gestión de usuarios ────────────────────────────────────────
     En producción esto son operaciones contra la base de datos.
     El rol solo define qué se muestra: no hay lógica distinta por
     rol, así que cambiarlo no requiere nada más.                    */

  return {
    autenticar, credencialSip, cerrar, hayPbxConfigurada,
    estadoVivo, formularios, guardarFormularios, formulariosDe,
    pendientes, encolarRespuesta, sincronizar,
    generarReporte, horarios, guardarHorarios,

    listarUsuarios, guardarUsuarioRemoto, cambiarRolRemoto, cambiarCampanaRemoto,
    restablecerClave, desactivarUsuario, reactivarUsuario, listarCampanas,
    guardarCampana, eliminarCampana, alternarHorario,
    hayApi, catalogoTipificacion, cambiarMiClave,
    registrarLlamadaServidor, reporteLlamadas,
    estadoEnVivo, listarGrabaciones, urlGrabacion, agentesGrabaciones,
    listarFormularios, leerFormulario, crearFormulario, guardarFormulario,
    eliminarFormulario, enviarRespuesta,
    listarPaises, listarDepartamentos, listarMunicipios,
    registrarPausa,
    get usuarios()    { return []; },
    /* Listas heredadas de cuando había datos locales. Hoy siempre
       vienen del backend; se conservan vacías mientras las pantallas
       que aún las consultan se van limpiando. */
    get campanas()    { return []; },
    get tiposCampo()  { return TIPOS_CAMPO.map((t) => ({ ...t })); },
    get tiposReporte(){ return TIPOS_REPORTE.map((t) => ({ ...t })); },
  };
})();
