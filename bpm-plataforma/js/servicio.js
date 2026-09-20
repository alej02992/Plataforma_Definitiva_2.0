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
const MARCACION_RAPIDA = {};
 
const servicio = (() => {
 
  /* ═════════════════════════════════════════════════════════════════
     USUARIOS · en producción: tabla `usuario`
     Cada persona YA trae su extensión — requisito de la reunión:
     "la persona debe ser equivalente a la extensión que se crea".
     ═════════════════════════════════════════════════════════════════ */
  /* Los usuarios viven en la base de datos. Sin backend no hay
     usuarios: la plataforma lo dice con claridad en lugar de dejar
     entrar a cualquiera. */
  const USUARIOS = [];
 
  /* ═════════════════════════════════════════════════════════════════
     CAMPAÑAS Y COLAS
     Cada campaña se corresponde con una cola de Asterisk. Ese vínculo
     decide qué catálogo ve el agente y en qué panel aparece la llamada.
     La extensión de la cola es a donde se transfiere.
     ═════════════════════════════════════════════════════════════════ */
  /* Las campañas vienen del backend. */
  const CAMPANAS = [];
 
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
  /** Antes avanzaba una simulación del estado de la operación.
      Ahora no hace nada: los datos reales llegarán del backend cuando
      exista el módulo de eventos en vivo. Se conserva la función para
      no romper a quien la llama. */
  function tictac() { /* sin simulación */ }
 
 
  const estadoVivo = () => ({
    agentes: vivo.agentes.map((a) => ({ ...a })),
    colas: vivo.colas.map((c) => ({ ...c })),
  });
 
  /* ═════════════════════════════════════════════════════════════════
     FORMULARIOS · tablas `formulario` y `formulario_campo`
     El administrador y el supervisor los crean; el agente los llena.
     ═════════════════════════════════════════════════════════════════ */
  const CLAVE_FORMS = 'bpm.formularios';
 
  /* Los formularios los crea el superadministrador desde la
     plataforma y se guardan en la base. */
  const FORMULARIOS_BASE = [];
 
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
    return JSON.parse(JSON.stringify(FORMULARIOS_BASE));
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
        filas: CAMPANAS.map((c) => {
          const q = v.colas.find((x) => x.campana === c.nombre) || {};
          return [c.nombre, c.tipo, c.activa ? 'Sí' : 'No',
                  q.enEspera || 0, q.atendidas || 0, q.abandonadas || 0, q.nivel || 0];
        }),
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
  /* Los horarios son un atributo de cada campaña. */
  const HORARIOS_BASE = [];
 
  function horarios() {
    try {
      const g = localStorage.getItem(CLAVE_HOR);
      if (g) return JSON.parse(g);
    } catch { /* nada */ }
    return JSON.parse(JSON.stringify(HORARIOS_BASE));
  }
  function guardarHorarios(l) {
    try { localStorage.setItem(CLAVE_HOR, JSON.stringify(l)); } catch { /* nada */ }
  }
 
  /* ═════════════════════════════════════════════════════════════════
     CONFIGURACIÓN DE LA CENTRAL
     En producción esto NO viaja al navegador: lo sabe el backend y lo
     entrega junto con la credencial.
     ═════════════════════════════════════════════════════════════════ */
  /* ── Datos de la central ─────────────────────────────────────
     Vienen de js/config.js. No se piden al agente ni se guardan en el
     navegador: en producción los va a entregar el backend junto con la
     credencial.                                                        */
  function leerPbx() {
    return {
      wss: CONFIG.pbx.wss || '',
      dominio: CONFIG.pbx.dominio || '',
      clave: CONFIG.pbx.clave || '',
      ice: CONFIG.pbx.ice || [],
    };
  }
 
  function hayPbxConfigurada() {
    return !!(CONFIG.pbx.wss && CONFIG.pbx.dominio && !CONFIG.simulador);
  }
 
  async function autenticar(usuario, clave) {
    /* ── Con backend ── */
    if (hayApi()) {
      const d = await api('POST', '/sesion', { usuario, clave });
      guardarToken(d.token);
      return { ...d.usuario, usuario: d.usuario.usuario || usuario };
    }
 
    /* ── Sin backend ──
       No hay dónde validar la contraseña, así que no se deja entrar.
       Antes se aceptaba cualquier clave contra una lista local, y eso
       no puede ocurrir en una plataforma en uso. */
    if (!USUARIOS.length) {
      throw new Error('No hay conexión con el servidor. Avisa al área de tecnología.');
    }
 
    await demora(350);
    const u = USUARIOS.find((x) => x.usuario === String(usuario).toLowerCase().trim());
    if (!u || !clave) throw new Error('Usuario o contraseña incorrectos.');
    if (!u.activo) throw new Error('Este usuario está inactivo.');
    return {
      id: u.usuario, usuario: u.usuario, nombre: u.nombre, rol: u.rol,
      campana: u.campana, extension: u.extension, clave: u.clave,
      permisos: permisosDeRol(u.rol),
    };
  }
 
  async function credencialSip(sesion) {
    /* Con backend, la credencial la emite el servidor: temporal y
       asociada a la sesión. El navegador nunca ve una clave fija. */
    if (hayApi()) {
      const d = await api('POST', '/sesion/sip');
      if (!d.wss || !d.dominio) throw new Error('SIN_PBX');
      return { ...d, ext: d.extension || d.ext };
    }
 
    await demora(250);
    const pbx = leerPbx();
    if (!pbx.wss || !pbx.dominio) throw new Error('SIN_PBX');
    return {
      wss: pbx.wss, dominio: pbx.dominio,
      ext: sesion.extension,
      clave: pbx.clave || generarClaveTemporal(),
      ice: pbx.ice,
      venceEn: 8 * 60 * 60,
      emitida: new Date(),
    };
  }
 
  async function cerrar() {
    /* Con backend, el servidor invalida la sesión y la credencial SIP.
       Así, si alguien copió la clave de telefonía, deja de servir. */
    if (hayApi()) {
      try { await api('DELETE', '/sesion'); } catch { /* da igual si falla */ }
      borrarToken();
      return;
    }
    await demora(120);
  }
 
  /* ═════════════════════════════════════════════════════════════════
     PERMISOS POR ROL
     El rol solo define QUÉ SE MUESTRA. No hay código distinto por rol,
     y por eso cambiar a alguien de rol no tiene ninguna complicación.
     ═════════════════════════════════════════════════════════════════ */
  function permisosDeRol(rol) {
    /* AGENTE — vista simplificada y operativa.
       Sin diseño de encuestas, sin reportería general, sin estado
       global de colas, sin administración de la PBX. Contactos e
       historial viven DENTRO del escritorio, no en el menú. */
    const agente = ['softphone', 'tipificar', 'ficha', 'historial_sesion'];
 
    /* SUPERVISOR — monitoreo y control de operaciones.
       Puede intervenir operativamente, pero NO puede borrar campañas
       ni diseñar formularios. */
    const supervisor = [...agente,
      'supervision',      // panel en vivo
      'horarios',         // cerrar y abrir campañas
      'distribucion',     // reasignar agentes entre campañas
      'grabaciones',      // buscador y reproductor
      'escucha',          // monitoreo en tiempo real
      'reportes',         // reportería con filtros
    ];
 
    /* SUPERADMINISTRADOR Y SOPORTE — herramientas maestras.
       No requiere softphone para su operación diaria. */
    const admin = [...supervisor,
      'disenar_formularios',  // exclusivo del superadmin
      'campanas',             // creación y eliminación
      'usuarios',             // usuarios, extensiones y roles
      'modulos',              // interruptor maestro
      'telefonia',            // diagnóstico y traza
    ];
 
    if (rol === 'admin') return admin;
    if (rol === 'supervisor') return supervisor;
    return agente;
  }
 
  const puede = (sesion, permiso) => !!(sesion && sesion.permisos && sesion.permisos.includes(permiso));
 
  /* ═════════════════════════════════════════════════════════════════
     UTILIDADES
     ═════════════════════════════════════════════════════════════════ */
  const demora = (ms) => new Promise((r) => setTimeout(r, ms));
 
  /** Solo para la demostración. El backend real usa un generador seguro. */
  function generarClaveTemporal() {
    const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 24; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
  }
 
 
 
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
 
  /** Busca el contacto por teléfono. Es la consulta de cada llamada
      entrante: tiene que responder antes de que el agente conteste. */
  async function contactoPorTelefono(numero) {
    if (hayApi()) {
      try { return await api('GET', '/contactos/telefono/' + encodeURIComponent(numero)); }
      catch { return null; }
    }
    const n = String(numero || '').replace(/\D/g, '');
    return DIRECTORIO.find((c) => c.n.replace(/\D/g, '') === n) || null;
  }
 
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
 
  /** Registra la tipificación de una llamada terminada. */
  async function guardarTipificacion(datos) {
    if (hayApi()) {
      try {
        await api('POST', '/interacciones/' + encodeURIComponent(datos.linkedid || 'sin-id') + '/tipificar', datos);
        return { ok: true, enviada: true };
      } catch (e) {
        return { ok: true, enviada: false, motivo: e.message };
      }
    }
    return { ok: true, enviada: false };
  }
 
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
    return USUARIOS.map((u) => ({ ...u }));
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
    if (!hayApi()) {
      const c = CAMPANAS.find((x) => String(x.id) === String(id) || x.nombre === id);
      if (!c) return { ok: false, error: 'Campaña no encontrada' };
      c.abierta = !c.abierta;
      return { ok: true, abierta: c.abierta };
    }
    try {
      const r = await api('PUT', '/campanas/' + id + '/horario');
      return { ok: true, abierta: r.abierta };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
 
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
    return CAMPANAS.map((c) => ({ ...c }));
  }
 
  /* ── Gestión de usuarios ────────────────────────────────────────
     En producción esto son operaciones contra la base de datos.
     El rol solo define qué se muestra: no hay lógica distinta por
     rol, así que cambiarlo no requiere nada más.                    */
 
  function cambiarRol(usuario, rol) {
    const u = USUARIOS.find((x) => x.usuario === usuario);
    if (!u) return { ok: false, error: 'Usuario no encontrado' };
    u.rol = rol;
    return { ok: true };
  }
 
  function cambiarCampana(usuario, campana) {
    const u = USUARIOS.find((x) => x.usuario === usuario);
    if (!u) return { ok: false, error: 'Usuario no encontrado' };
    u.campana = campana;
    return { ok: true };
  }
 
  function guardarUsuario(datos) {
    const existe = USUARIOS.find((x) => x.usuario === datos.usuario);
 
    // Una extensión no puede compartirse entre dos personas
    const ext = String(datos.extension || '').trim();
    if (ext && USUARIOS.some((x) => x.extension === ext && x.usuario !== datos.usuario)) {
      return { ok: false, error: 'Esa extensión ya está asignada a otro usuario.' };
    }
 
    if (existe) {
      Object.assign(existe, datos);
    } else {
      USUARIOS.push({ ...datos, clave: '', activo: true });
    }
    return { ok: true };
  }
 
  function marcacionRapidaDe(campana) {
    return MARCACION_RAPIDA[campana] || MARCACION_RAPIDA['Todas'] || [];
  }
 
  return {
    autenticar, credencialSip, cerrar, puede,
    leerPbx, hayPbxConfigurada,
    estadoVivo, tictac,
    formularios, guardarFormularios, formulariosDe,
    pendientes, encolarRespuesta, sincronizar,
    generarReporte, horarios, guardarHorarios,
    cambiarRol, cambiarCampana, guardarUsuario, marcacionRapidaDe,
    listarUsuarios, guardarUsuarioRemoto, cambiarRolRemoto, cambiarCampanaRemoto,
    restablecerClave, desactivarUsuario, reactivarUsuario, listarCampanas,
    guardarCampana, eliminarCampana, alternarHorario,
    hayApi, contactoPorTelefono, catalogoTipificacion, cambiarMiClave,
    guardarTipificacion, registrarPausa,
    get usuarios()    { return USUARIOS.map((u) => ({ ...u })); },
    get campanas()    { return CAMPANAS.map((c) => ({ ...c })); },
    get tiposCampo()  { return TIPOS_CAMPO.map((t) => ({ ...t })); },
    get tiposReporte(){ return TIPOS_REPORTE.map((t) => ({ ...t })); },
  };
})();
 