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
   El catálogo de tipificación viene del servidor. `CATALOGO` queda
   como red de seguridad: si el servidor no responde justo cuando el
   agente abre su escritorio, la pantalla muestra un desplegable vacío
   en lugar de romperse.
   ═══════════════════════════════════════════════════════════════ */

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
     FORMULARIOS · tablas `formulario` y `formulario_campo`
     El administrador y el supervisor los crean; el agente los llena.
     ═════════════════════════════════════════════════════════════════ */
  const TIPOS_CAMPO = [
    { id: 'texto',       nombre: 'Texto corto' },
    { id: 'texto_largo', nombre: 'Texto largo' },
    { id: 'numero',      nombre: 'Número' },
    { id: 'fecha',       nombre: 'Fecha' },
    { id: 'opcion',      nombre: 'Lista de opciones' },
    { id: 'casilla',     nombre: 'Casilla de verificación' },
  ];



  /** Formularios activos de una campaña. Es lo que ve el agente. */

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

  /**
   * Intenta enviar las respuestas que quedaron guardadas sin conexión.
   *
   * `hayServidor` lo decide quien llama, mirando si la plataforma tiene
   * backend disponible. Si no lo hay, se cuenta el intento y las
   * respuestas se quedan donde están: no se pierde ninguna.
   */
  async function sincronizar(hayServidor) {
    const lista = pendientes();
    if (!lista.length) return { enviadas: 0, quedan: 0 };
    if (hayServidor === false) {
      lista.forEach((r) => { r.intentos++; });
      guardarPendientes(lista);
      throw new Error('Sin conexión con el servidor. Las respuestas quedan guardadas.');
    }
    guardarPendientes([]);
    return { enviadas: lista.length, quedan: 0 };
  }

  function hayPbxConfigurada() {
    return !!(CONFIG.pbx.wss && CONFIG.pbx.dominio);
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
      } catch { /* si falla, se usan las de reserva */ }
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

  /* ── Estados de pausa (los define el supervisor) ── */

  /** Con todos=true devuelve también los inactivos y los de otras
      campañas, para que el supervisor los administre. */
  const listarEstados = (todos = false) =>
    api('GET', '/pausas/tipos' + (todos ? '?todos=1' : ''));

  async function crearEstado(nombre, campana_id = null, limite_minutos = null) {
    try {
      return { ok: true, ...(await api('POST', '/pausas/tipos',
        { nombre, campana_id, limite_minutos, activo: true })) };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  /* ── Blaster de voz ── */

  const listarBlasters = () => api('GET', '/blasters');
  const leerBlaster = (id) => api('GET', '/blasters/' + id);
  const crearBlaster = (datos) => api('POST', '/blasters', datos);
  const guardarBlaster = (id, datos) => api('PUT', '/blasters/' + id, datos);
  const eliminarBlaster = (id) => api('DELETE', '/blasters/' + id);

  /** Revisa la lista sin cargar nada: devuelve qué filas están mal y
      cómo quedará el mensaje de las primeras. */
  const revisarDestinos = (id, filas) =>
    api('POST', `/blasters/${id}/destinos`, { filas, revisar: true });

  const cargarDestinos = (id, filas) =>
    api('POST', `/blasters/${id}/destinos`, { filas, revisar: false });

  const listarDestinos = (id) => api('GET', `/blasters/${id}/destinos`);

  /** Aprobar, pausar o cancelar. Solo el administrador. */
  const cambiarEstadoBlaster = (id, estado) =>
    api('PUT', `/blasters/${id}/estado`, { estado });

  const respuestasBlaster = (id) => api('GET', `/blasters/${id}/respuestas`);

  /** Cómo va el día: llamadas, efectividad y comparación con ayer. */
  const indicadoresDelDia = () => api('GET', '/vivo/indicadores');

  /* ── Reportería ── */

  const comoTexto = (f) => new URLSearchParams(
    Object.entries(f || {}).filter(([, v]) => v !== '' && v != null)).toString();

  const reporteTipificaciones = (f) => api('GET', '/reportes/tipificaciones?' + comoTexto(f));
  const reporteSesiones = (f) => api('GET', '/reportes/sesiones?' + comoTexto(f));

  /** Los grupos de un blaster que se pueden pasar a una base, y el paso
      en sí. */
  const gruposBlaster = (id) => api('GET', `/blasters/${id}/grupos`);
  const blasterABase = (id, grupo, nombre) =>
    api('POST', `/blasters/${id}/a-base`, { grupo, nombre });

  /** Genera con voz sintética el audio de un blaster. Con `muestra`,
      solo uno de prueba para escucharlo antes de gastar en todos. */
  const generarAudioBlaster = (id, muestra) =>
    api('POST', `/blasters/${id}/audio`, { muestra: !!muestra });

  /** Los blasters que el supervisor puede consultar, y el resultado de
      uno: a quién se llamó, quién contestó y qué respondió. */
  const listarBlastersReporte = () => api('GET', '/reportes/blasters');
  const reporteBlaster = (id) => api('GET', `/reportes/blasters/${id}`);

  /** Los formularios que el supervisor puede consultar. */
  const listarFormulariosReporte = () => api('GET', '/reportes/formularios');

  /** Las respuestas de un formulario. Las columnas vienen con los
      datos, porque cada formulario tiene sus propias preguntas. */
  const reporteFormulario = (id, f) =>
    api('GET', `/reportes/formularios/${id}?` + comoTexto(f));

  /** El archivo lo arma el servidor y llega como texto; la plataforma
      lo vuelve a convertir en archivo para descargarlo. */
  const exportarReporte = (reporte, formato, filas, periodo, columnas, extra = {}) =>
    api('POST', '/reportes/exportar', { reporte, formato, filas, periodo, columnas, ...extra });

  /** Las troncales de la central, con su estado de registro. */
  const listarTroncales = () => api('GET', '/troncales');

  /** Las troncales que administra la plataforma. Nunca traen la clave. */
  const listarTroncalesPropias = () => api('GET', '/troncales/propias');
  const crearTroncal = (datos) => api('POST', '/troncales/propias', datos);
  const guardarTroncal = (id, datos) => api('PUT', `/troncales/propias/${id}`, datos);
  const eliminarTroncal = (id) => api('DELETE', `/troncales/propias/${id}`);

  /** Pone la troncal en servicio o la saca. Es lo único que escribe en
      la configuración de la central. */
  const estadoTroncal = (id, estado) =>
    api('PUT', `/troncales/propias/${id}/estado`, { estado });

  /* ── Tipificador ── */

  const leerTipificador = (campanaId) =>
    api('GET', '/tipificador/' + (campanaId || 0));

  const guardarTipificador = (campanaId, tipificaciones) =>
    api('PUT', '/tipificador/' + (campanaId || 0), { tipificaciones });

  /* ── Seguridad ── */

  /** Qué debe cumplir una contraseña. La puede consultar cualquiera
      que esté cambiando la suya. */
  const reglasClave = () => api('GET', '/seguridad/reglas');

  const leerPolitica = () => api('GET', '/seguridad/politica');
  const guardarPolitica = (datos) => api('PUT', '/seguridad/politica', datos);
  const cuentasBloqueadas = () => api('GET', '/seguridad/bloqueados');
  const desbloquearCuenta = (id) => api('POST', `/seguridad/desbloquear/${id}`);
  const desactivarInactivos = () => api('POST', '/seguridad/inactivos');

  /* ── Marcación ── */

  const listarBases = () => api('GET', '/bases');
  const leerBase = (id) => api('GET', '/bases/' + id);
  const crearBase = (datos) => api('POST', '/bases', datos);
  const guardarBase = (id, datos) => api('PUT', '/bases/' + id, datos);
  const eliminarBase = (id) => api('DELETE', '/bases/' + id);
  const cambiarEstadoBase = (id, estado) => api('PUT', `/bases/${id}/estado`, { estado });

  const revisarContactos = (id, filas) =>
    api('POST', `/bases/${id}/contactos`, { filas, revisar: true });
  const cargarContactos = (id, filas) =>
    api('POST', `/bases/${id}/contactos`, { filas, revisar: false });
  const seguimientoBase = (id, estado) =>
    api('GET', `/bases/${id}/contactos` + (estado ? '?estado=' + encodeURIComponent(estado) : ''));

  /** Cuelga los canales de una extensión trancada. */
  const liberarAgente = (extension) => api('POST', `/ami/liberar/${extension}`);

  /** Entra a oír una llamada en curso. El servidor comprueba que el
      agente sea de una campaña del supervisor y lo deja registrado. */
  const escuchar = (extension, modo) => api('POST', '/escucha', { extension, modo });

  /** Quién está esperando en las colas de este agente. */
  const llamadasEnCola = () => api('GET', '/cola/mias');

  /** Estado del canal con la central y del motor de marcación. */
  const estadoMotor = () => api('GET', '/marcacion/motor');

  /** El siguiente contacto para este agente. El servidor lo marca como
      suyo antes de devolverlo, así que dos agentes nunca reciben el
      mismo. */
  const siguienteContacto = () => api('GET', '/marcacion/siguiente');

  const resultadoContacto = (id, datos) =>
    api('POST', `/marcacion/contactos/${id}/resultado`, datos);

  /** Devuelve a la cola el contacto que tenía asignado. */
  const soltarContacto = () => api('POST', '/marcacion/soltar');

  /* ── Archivos ── */

  /** Convierte un archivo en filas. Lo hace el servidor porque el
      navegador no sabe abrir un .xlsx por su cuenta. Sirve igual para
      Excel y para CSV. */
  async function leerTabla(archivo) {
    const contenido = await aBase64(archivo);
    return api('POST', '/archivos/tabla', { contenido, nombre: archivo.name });
  }

  /** Sube un audio grabado para el blaster. */
  async function subirAudio(archivo) {
    const contenido = await aBase64(archivo);
    return api('POST', '/archivos/audio', { contenido, nombre: archivo.name });
  }

  const listarAudios = () => api('GET', '/archivos/audios');

  /** Pasa un archivo a texto para poder mandarlo dentro del JSON. */
  function aBase64(archivo) {
    return new Promise((listo, falla) => {
      const lector = new FileReader();
      lector.onload = () => listo(String(lector.result).split(',')[1] || '');
      lector.onerror = () => falla(new Error('No se pudo leer el archivo'));
      lector.readAsDataURL(archivo);
    });
  }

  /* ── Envío de SMS ── */

  const listarSms = () => api('GET', '/sms');
  const leerSms = (id) => api('GET', '/sms/' + id);
  const crearSms = (datos) => api('POST', '/sms', datos);
  const guardarSms = (id, datos) => api('PUT', '/sms/' + id, datos);
  const eliminarSms = (id) => api('DELETE', '/sms/' + id);

  /** Revisa la lista sin cargar nada: qué filas están mal, cómo quedará
      el mensaje de las primeras y cuántos SMS cuesta cada uno. */
  const revisarDestinosSms = (id, filas) =>
    api('POST', `/sms/${id}/destinos`, { filas, revisar: true });

  const cargarDestinosSms = (id, filas) =>
    api('POST', `/sms/${id}/destinos`, { filas, revisar: false });

  const listarDestinosSms = (id) => api('GET', `/sms/${id}/destinos`);

  const cambiarEstadoSms = (id, estado) => api('PUT', `/sms/${id}/estado`, { estado });

  /** Dispara el envío. Solo el administrador. */
  const enviarSms = (id) => api('POST', `/sms/${id}/enviar`);

  /** Agentes que llevan más tiempo del permitido en su estado. */
  const pausasExcedidas = () => api('GET', '/pausas/excedidas');

  async function activarEstado(id, activo) {
    try { await api('PUT', '/pausas/tipos/' + id, { activo }); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  /* ── Campañas a cargo y alta masiva ── */

  /** Borra un usuario para siempre. Solo funciona si ya está dado de
      baja; su historial se conserva con el nombre guardado. */
  const eliminarUsuarioDefinitivo = (id) => api('DELETE', `/usuarios/${id}/definitivo`);

  const campanasDeUsuario = (id) => api('GET', '/usuarios/' + id + '/campanas');

  async function guardarCampanasDeUsuario(id, campanas) {
    try { await api('PUT', '/usuarios/' + id + '/campanas', { campanas }); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  /** Con revisar=true no crea nada: devuelve qué filas están bien y
      cuáles tienen errores, para mostrarlo antes de confirmar. */
  const altaMasiva = (filas, revisar = true) =>
    api('POST', '/usuarios/masivo', { filas, revisar });

  /** Campañas sobre las que el usuario puede crear estados. El
      administrador recibe todas y puede además crear generales. */
  const campanasDeEstados = () => api('GET', '/pausas/campanas');

  /** Elimina un estado. Solo funciona si nunca se usó; si ya tiene
      pausas registradas, el servidor lo impide para no perder el
      historial y hay que desactivarlo. */
  async function eliminarEstado(id) {
    try { await api('DELETE', '/pausas/tipos/' + id); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  /** Busca el contacto por teléfono en la base. Es la consulta de cada
      llamada entrante: tiene que responder antes de que el agente
      conteste, por eso la tabla tiene índice por número. */
  async function contactoPorTelefono(numero) {
    if (!hayApi()) return null;
    try { return await api('GET', '/contactos/telefono/' + encodeURIComponent(numero)); }
    catch { return null; }          // 404 = número no registrado
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
  /** Entra o sale de pausa. Al entrar, el servidor devuelve la
      duración máxima del estado para que la plataforma avise. */
  async function registrarPausa(tipo, entrando) {
    if (hayApi()) {
      try {
        const d = await api('POST', '/pausas', { tipo, entrando });
        return { ok: true, limite_minutos: d?.limite_minutos ?? null };
      } catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: true };
  }

  /* ═══════════════════════════════════════════════════════════════
     GESTIÓN DE USUARIOS

     Todas trabajan contra la base de datos a través del servidor. Si
     el servidor no responde, devuelven una lista vacía en lugar de
     fallar: la pantalla muestra que no hay datos y lo dice.
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

  /** Las campañas de la operación. Vacío si el servidor no responde. */
  async function listarCampanas() {
    if (hayApi()) {
      try { return await api('GET', '/campanas'); } catch { /* sin datos */ }
    }
    return [];
  }

  /* ── Gestión de usuarios ────────────────────────────────────────
     En producción esto son operaciones contra la base de datos.
     El rol solo define qué se muestra: no hay lógica distinta por
     rol, así que cambiarlo no requiere nada más.                    */

  return {
    autenticar, credencialSip, cerrar, hayPbxConfigurada,
    pendientes, sincronizar,

    listarUsuarios, guardarUsuarioRemoto, cambiarRolRemoto, cambiarCampanaRemoto,
    restablecerClave, desactivarUsuario, reactivarUsuario, listarCampanas,
    guardarCampana, eliminarCampana, alternarHorario,
    hayApi, contactoPorTelefono, catalogoTipificacion, cambiarMiClave,
    listarEstados, crearEstado, activarEstado, eliminarEstado, campanasDeEstados,
    leerTabla, subirAudio, listarAudios,
    indicadoresDelDia, reporteLlamadas, reporteTipificaciones,
    listarFormulariosReporte, reporteFormulario, listarBlastersReporte, reporteBlaster,
    generarAudioBlaster, gruposBlaster, blasterABase, reporteSesiones, exportarReporte,
    listarTroncales, listarTroncalesPropias, crearTroncal, guardarTroncal,
    eliminarTroncal, estadoTroncal,
    leerTipificador, guardarTipificador,
    reglasClave, leerPolitica, guardarPolitica, cuentasBloqueadas, desbloquearCuenta, desactivarInactivos,
    listarBases, leerBase, crearBase, guardarBase, eliminarBase, cambiarEstadoBase,
    revisarContactos, cargarContactos, seguimientoBase,
    siguienteContacto, resultadoContacto, soltarContacto, estadoMotor, llamadasEnCola,
    liberarAgente, escuchar,
    listarSms, leerSms, crearSms, guardarSms, eliminarSms,
    revisarDestinosSms, cargarDestinosSms, listarDestinosSms, cambiarEstadoSms, enviarSms,
    listarBlasters, leerBlaster, crearBlaster, guardarBlaster, eliminarBlaster,
    revisarDestinos, cargarDestinos, listarDestinos, cambiarEstadoBlaster, respuestasBlaster,
    pausasExcedidas,
    campanasDeUsuario, guardarCampanasDeUsuario, altaMasiva, eliminarUsuarioDefinitivo,
    registrarLlamadaServidor,
    estadoEnVivo, listarGrabaciones, urlGrabacion, agentesGrabaciones,
    listarFormularios, leerFormulario, crearFormulario, guardarFormulario,
    eliminarFormulario, enviarRespuesta,
    listarPaises, listarDepartamentos, listarMunicipios,
    registrarPausa,
    get tiposCampo()  { return TIPOS_CAMPO.map((t) => ({ ...t })); },
  };
})();