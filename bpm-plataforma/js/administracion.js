/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — ADMINISTRACIÓN Y SUPERVISIÓN

   Todo lo que pidieron los tres perfiles y no existía:

     SUPERVISOR    horarios de campaña, distribución de agentes,
                   grabaciones con reproductor, escucha en línea.

     SUPERADMIN    configuración de campañas con DID y formulario,
                   usuarios con cambio de rol de un clic,
                   interruptor maestro de módulos.

   No toca la telefonía. Solo lee el estado que expone `telefonia`.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const administracion = (() => {

  /* ── Datos que en producción vienen del backend ─────────────── */

  const MODULOS = [
    { id:'calidad',    nom:'Calidad',              desc:'Evaluación de llamadas y retroalimentación.', on:false },
    { id:'ivr',        nom:'IVR',                  desc:'Menú de opciones para llamadas entrantes.',   on:false },
    { id:'grabacion',  nom:'Grabación de llamadas', desc:'Almacena el audio de cada interacción.',      on:true  },
    { id:'pantalla',   nom:'Grabación de pantalla', desc:'Registra la pantalla del agente durante la llamada.', on:false },
    { id:'whatsapp',   nom:'WhatsApp',             desc:'Canal de mensajería integrado al escritorio.', on:false },
    { id:'encuestas',  nom:'Encuestas de salida',  desc:'Encuesta de satisfacción al finalizar la llamada.', on:false },
  ];

  /* Se cargan del backend al abrir cada vista */
  let campanas = [];

  let editandoCamp = null;
  let editandoUsr = null;
  let escuchando = null;

  const $$ = (id) => document.getElementById(id);

  /* ═══════════════════════════════════════════════════════════════
     SUPERVISOR · HORARIOS Y DISTRIBUCIÓN
     ═══════════════════════════════════════════════════════════════ */

  /* La distribución de agentes se movió a Usuarios y roles: necesita la
     lista completa de usuarios, que es permiso de administrador, y el
     supervisor la veía siempre vacía. */
  async function abrirCampanas() {
    campanas = await servicio.listarCampanas();
    pintarHorarios();
  }

  function pintarHorarios() {
    $$('tablaHorarios').innerHTML = `<table class="tb">
      <tr><th>Campaña</th><th>Tipo</th><th>Horario</th><th>Estado</th><th></th></tr>
      ${campanas.map((c) => `<tr>
        <td><b>${seguro.texto(c.nombre)}</b></td>
        <td>${seguro.texto(c.tipo)}</td>
        <td class="mono">${(c.hora_apertura||'').slice(0,5)} – ${(c.hora_cierre||'').slice(0,5)}</td>
        <td><span class="t ${c.abierta ? 'g' : 'r'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span></td>
        <td><button class="b ${c.abierta ? 'b-red' : 'b-green'} b-sm"
              data-hor="${seguro.texto(c.id)}">${c.abierta ? 'Cerrar' : 'Abrir'}</button></td>
      </tr>`).join('')}</table>`;
  }

  $$('tablaHorarios')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-hor]');
    if (!b) return;
    const c = campanas.find((x) => String(x.id) === b.dataset.hor);
    if (!c) return;

    const r = await servicio.alternarHorario(c.id);
    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    c.abierta = r.abierta;
    pintarHorarios();
    aviso(c.abierta
      ? `Campaña ${c.nombre} abierta.`
      : `Campaña ${c.nombre} cerrada. Las llamadas entrantes escuchan el audio de fuera de horario.`,
      c.abierta ? 'av-b' : 'av-a');
  });

  async function pintarDistribucion() {
    const todos = await servicio.listarUsuarios();
    const agentes = todos.filter((u) => u.rol === 'agente' && u.activo !== false);

    $$('selAgentes').innerHTML = agentes.map((a) =>
      `<option value="${seguro.texto(a.id ?? a.usuario)}" data-usuario="${seguro.texto(a.usuario)}">${seguro.texto(a.nombre)} · ${seguro.texto(a.campana || 'sin campaña')}</option>`).join('');
    $$('selDestino').innerHTML = campanas.map((c) =>
      `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('');
  }

  $$('btnMover')?.addEventListener('click', async () => {
    const sel = [...$$('selAgentes').selectedOptions];
    if (!sel.length) { aviso('Selecciona al menos un agente.', 'av-a'); return; }

    const campanaId = Number($$('selDestino').value);
    const destino = $$('selDestino').selectedOptions[0]?.textContent || '';

    let ok = 0;
    for (const o of sel) {
      const r = await servicio.cambiarCampanaRemoto(
        Number(o.value) || null, o.dataset.usuario, campanaId, destino);
      if (r.ok) ok++;
    }

    await pintarDistribucion();
    aviso(ok === sel.length
      ? `${ok} agente(s) movido(s) a ${destino}.`
      : `Se movieron ${ok} de ${sel.length}. Revisa los que fallaron.`,
      ok === sel.length ? 'av-b' : 'av-a');
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERVISOR · GRABACIONES
     ═══════════════════════════════════════════════════════════════ */

  let grabaciones = [];

  /* Al abrir no se lista nada: con muchas grabaciones, mostrarlas todas
     sería un reguero inútil. Se pide primero un agente o una fecha. */
  async function abrirGrabaciones() {
    grabaciones = [];
    $$('grabN').textContent = '0';
    $$('reproductor').style.display = 'none';
    pedirFiltro();
    await llenarAgentes();
  }

  function pedirFiltro() {
    $$('tablaGrabaciones').innerHTML = `
      <div class="vacio" style="padding:26px 12px">
        <svg viewBox="0 0 24 24" style="width:28px;height:28px;stroke:var(--ink-3);fill:none;stroke-width:1.6;margin-bottom:8px"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <div>Elige un agente o una fecha para buscar las grabaciones.</div>
      </div>`;
  }

  const hayFiltro = () =>
    !!($$('grabAgente').value || $$('grabDesde').value ||
       $$('grabHasta').value || $$('grabNumero').value.trim());

  async function llenarAgentes() {
    const lista = await servicio.agentesGrabaciones();
    const actual = $$('grabAgente').value;

    $$('grabAgente').innerHTML = '<option value="">Selecciona un agente…</option>' +
      lista.map((a) => `<option value="${seguro.texto(a.extension)}">${seguro.texto(a.agente)}</option>`).join('');

    if (actual) $$('grabAgente').value = actual;   // no se pierde el filtro
  }

  async function buscarGrabaciones() {
    if (!hayFiltro()) {
      grabaciones = [];
      $$('grabN').textContent = '0';
      pedirFiltro();
      return;
    }

    $$('tablaGrabaciones').innerHTML = '<div class="vacio">Buscando…</div>';
    $$('reproductor').style.display = 'none';

    const r = await servicio.listarGrabaciones({
      desde: $$('grabDesde').value,
      hasta: $$('grabHasta').value,
      extension: $$('grabAgente').value,
      numero: $$('grabNumero').value.trim(),
    });

    if (r.error) {
      $$('tablaGrabaciones').innerHTML =
        `<div class="aviso av-r" style="margin:0"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div>${seguro.texto(r.error)}</div></div>`;
      $$('grabN').textContent = '0';
      return;
    }

    grabaciones = r.grabaciones || [];
    $$('grabN').textContent = r.total ?? grabaciones.length;

    if (!grabaciones.length) {
      $$('tablaGrabaciones').innerHTML = r.aviso
        ? `<div class="vacio">${r.aviso}</div>`
        : '<div class="vacio">Ninguna grabación coincide con el filtro.</div>';
      return;
    }

    $$('tablaGrabaciones').innerHTML = `<table class="tb">
      <tr><th>Fecha</th><th>Hora</th><th>Agente</th><th>Número</th><th>Tamaño</th><th></th></tr>
      ${grabaciones.map((g) => `<tr${g.vacia ? ' style="opacity:.55"' : ''}>
        <td class="mono">${seguro.celda(g.fecha)}</td>
        <td class="mono">${seguro.celda(g.hora)}</td>
        <td>${seguro.celda(g.agente)}<br><span class="mono" style="font-size:10.5px;color:var(--ink-3)">ext. ${seguro.celda(g.extension)}</span></td>
        <td class="mono">${seguro.celda(g.numero)}</td>
        <td class="mono">${tamano(g.bytes)}</td>
        <td style="white-space:nowrap">
          ${g.vacia
            ? '<span class="t o">Sin audio</span>'
            : `<button class="b b-teal b-sm" data-grab="${seguro.texto(g.id)}">Escuchar</button>`}
        </td>
      </tr>`).join('')}</table>`;

    if (r.mostrando && r.total > r.mostrando) {
      $$('tablaGrabaciones').insertAdjacentHTML('beforeend',
        `<p class="c-sub" style="margin-top:9px">Mostrando ${r.mostrando} de ${r.total}. Afina los filtros para ver el resto.</p>`);
    }
  }

  const tamano = (b) => !b ? '—'
    : b < 1024 ? b + ' B'
    : b < 1048576 ? (b / 1024).toFixed(0) + ' KB'
    : (b / 1048576).toFixed(1) + ' MB';

  $$('btnBuscarGrab')?.addEventListener('click', () => {
    if (!hayFiltro()) {
      aviso('Elige un agente o una fecha para buscar.', 'av-a');
      return;
    }
    buscarGrabaciones();
  });

  ['grabDesde', 'grabHasta', 'grabAgente'].forEach((id) =>
    $$(id)?.addEventListener('change', buscarGrabaciones));

  $$('grabNumero')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') buscarGrabaciones();
  });

  let grabActual = null;

  $$('tablaGrabaciones')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-grab]');
    if (!b) return;

    const g = grabaciones.find((x) => x.id === b.dataset.grab);
    if (!g) return;
    grabActual = g;

    $$('reproductor').style.display = '';
    $$('grabDetalle').textContent =
      `${g.agente || 'ext. ' + g.extension} · ${g.numero} · ${g.fecha} ${g.hora}`;
    $$('grabRuta').textContent = g.id;

    const audio = $$('audioGrab');
    audio.src = servicio.urlGrabacion(g.id);
    audio.play().catch(() => {
      /* Algunos navegadores exigen un gesto del usuario. Ya lo hubo al
         pulsar el botón, pero si aun así lo bloquea, queda el control
         del reproductor. */
    });

    /* Marca visual de cuál se está escuchando */
    $$('tablaGrabaciones').querySelectorAll('[data-grab]').forEach((x) =>
      x.classList.toggle('b-dark', x === b));
  });

  /* Si el audio falla, se pregunta al servidor el motivo real. El
     elemento <audio> solo informa "error", sin decir por qué. */
  $$('audioGrab')?.addEventListener('error', async () => {
    const audio = $$('audioGrab');
    if (!audio.src) return;

    let motivo = 'No se pudo reproducir la grabación.';
    try {
      const r = await fetch(audio.src, { method: 'GET', headers: { Range: 'bytes=0-0' } });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        motivo = r.status === 401 ? 'La sesión no es válida para reproducir. Vuelve a iniciar sesión.'
               : r.status === 403 ? 'No tienes permiso para escuchar esta grabación.'
               : r.status === 404 ? 'La grabación ya no está en el servidor.'
               : (d.error || `El servidor respondió con error ${r.status}.`);
      }
    } catch { /* se queda el mensaje genérico */ }

    aviso(motivo, 'av-a');
  });

  $$('btnDescargarGrab')?.addEventListener('click', () => {
    if (!grabActual) return;
    /* Se abre en una pestaña: el navegador la descarga por su nombre. */
    window.open(servicio.urlGrabacion(grabActual.id), '_blank', 'noopener');
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERVISOR · ESCUCHA EN LÍNEA
     ═══════════════════════════════════════════════════════════════ */

  /* Las llamadas en curso salen del panel en vivo, que a su vez las
     toma de la central. Se refresca solo mientras la vista está
     abierta: con llamadas de dos minutos, una foto vieja no sirve. */

  let relojEscucha = null;

  async function abrirEscucha() {
    await pintarEscucha();

    clearInterval(relojEscucha);
    relojEscucha = setInterval(() => {
      const v = document.querySelector('.vista.on');
      if (v && v.dataset.v === 'escucha') pintarEscucha();
      else { clearInterval(relojEscucha); relojEscucha = null; }
    }, 5000);
  }

  async function pintarEscucha() {
    let estado;
    try {
      estado = await servicio.estadoEnVivo();
    } catch (e) {
      $$('tablaEscucha').innerHTML =
        `<div class="vacio">No se pudo consultar: ${seguro.texto(e.message)}</div>`;
      return;
    }

    /* Solo los que están hablando ahora mismo */
    const activas = (estado.agentes || []).filter((a) => a.estado === 'En llamada');

    $$('escN').textContent = activas.length;

    if (!activas.length) {
      $$('tablaEscucha').innerHTML =
        '<div class="vacio">No hay llamadas activas en este momento.</div>';
      return;
    }

    $$('tablaEscucha').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Agente</th><th>Ext.</th><th>Número</th><th>Campaña</th>
          <th>Duración</th><th></th></tr>
      ${activas.map((a) => `<tr>
        <td><b>${seguro.texto(a.nombre)}</b></td>
        <td class="mono">${seguro.celda(a.extension)}</td>
        <td class="mono">${seguro.celda(a.numero)}</td>
        <td>${seguro.celda(a.campana)}</td>
        <td class="mono">${duracion(Math.round((Date.now() - new Date(a.desde)) / 1000))}</td>
        <td style="white-space:nowrap;text-align:right">
          <button class="b b-dark b-sm" data-oir="${seguro.texto(a.extension)}"
                  data-modo="escuchar" data-nombre="${seguro.texto(a.nombre)}"
                  title="Solo oír, sin que lo noten">Escuchar</button>
          <button class="b b-gh b-sm" data-oir="${seguro.texto(a.extension)}"
                  data-modo="susurrar" data-nombre="${seguro.texto(a.nombre)}"
                  title="Hablarle al agente sin que el cliente oiga">Susurrar</button>
        </td>
      </tr>`).join('')}</table></div>`;
  }

  /* ── Entrar a una llamada ──
     El servidor comprueba que el agente sea de una campaña suya y deja
     registro de quién escuchó a quién. */
  $$('tablaEscucha')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-oir]');
    if (!b) return;

    const susurro = b.dataset.modo === 'susurrar';
    const texto = susurro
      ? `Vas a hablarle a ${b.dataset.nombre}. El cliente no te escuchará.`
      : `Vas a escuchar la llamada de ${b.dataset.nombre}. Ni el agente ni el cliente lo notarán.`;

    if (!confirm(`${texto}\n\nTu extensión va a sonar: contesta para entrar.`)) return;

    b.disabled = true;
    try {
      await servicio.escuchar(b.dataset.oir, b.dataset.modo);

      escuchando = b.dataset.oir;
      $$('escuchaActiva').style.display = '';
      $$('escDetalle').textContent =
        `${b.dataset.nombre} · extensión ${b.dataset.oir} · ${susurro ? 'susurrando' : 'escuchando'}`;
      aviso('Contesta tu extensión para entrar a la llamada.', 'av-b');
    } catch (err) {
      aviso(err.message, 'av-a');
    } finally {
      b.disabled = false;
    }
  });

  /* Para salir basta con colgar: la escucha vive en la llamada del
     supervisor, no en la plataforma. */
  $$('btnDejarEscucha')?.addEventListener('click', () => {
    if (telefonia.estado !== 'reposo') telefonia.colgar();
    escuchando = null;
    $$('escuchaActiva').style.display = 'none';
    aviso('Escucha finalizada.', 'av-b');
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERADMIN · CONFIGURACIÓN DE CAMPAÑAS
     ═══════════════════════════════════════════════════════════════ */

  async function abrirAdmCampanas() {
    await recargarCampanas();
    await llenarFormularios();
  }

  async function recargarCampanas() {
    $$('listaCampanas').innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      campanas = await servicio.listarCampanas();
    } catch (e) {
      $$('listaCampanas').innerHTML =
        `<div class="aviso av-r" style="margin:0"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div>No se pudieron cargar: ${seguro.texto(e.message)}</div></div>`;
      return;
    }
    pintarListaCampanas();
  }

  function pintarListaCampanas() {
    if (!campanas.length) {
      $$('listaCampanas').innerHTML = '<div class="vacio">No hay campañas registradas.</div>';
      return;
    }
    $$('listaCampanas').innerHTML = campanas.map((c) => `
      <div class="fila-camp" data-camp="${seguro.texto(c.id)}">
        <div class="bd">
          <b>${seguro.texto(c.nombre)}</b>
          <span>${seguro.texto(c.tipo)}${c.did ? ' · DID ' + seguro.texto(c.did) : ''} · cola ${seguro.celda(c.cola_asterisk)}</span>
        </div>
        <span class="t ${c.abierta ? 'g' : 'o'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span>
      </div>`).join('');
  }

  async function llenarFormularios() {
    let fs = [];
    try { fs = servicio.formularios ? servicio.formularios() : []; } catch {}
    $$('campForm').innerHTML = '<option value="">— Sin formulario —</option>' +
      fs.map((f) => `<option value="${seguro.texto(f.id)}">${seguro.texto(f.nombre)}</option>`).join('');
  }

  $$('listaCampanas')?.addEventListener('click', (e) => {
    const f = e.target.closest('[data-camp]');
    if (!f) return;
    const c = campanas.find((x) => String(x.id) === f.dataset.camp);
    if (c) editarCampana({ ...c });
  });

  $$('btnCampNueva')?.addEventListener('click', () => {
    editarCampana({ nombre:'', tipo:'entrante', cola_asterisk:'', did:'',
      hora_apertura:'08:00', hora_cierre:'18:00', acw_segundos:60, marcacion:[] });
  });

  function editarCampana(c) {
    editandoCamp = c;
    $$('editorCampana').style.display = '';
    $$('campTitulo').textContent = c.nombre || 'Nueva campaña';
    $$('campNombre').value = c.nombre || '';
    $$('campCola').value = c.cola_asterisk || '';
    $$('campDid').value = c.did || '';
    $$('campApertura').value = (c.hora_apertura || '08:00').slice(0, 5);
    $$('campCierre').value = (c.hora_cierre || '18:00').slice(0, 5);
    $$('campForm').value = c.formulario_id || '';
    $$('campCola').disabled = !!c.id;      // la cola no se renombra

    c.tipo = c.tipo || 'entrante';
    document.querySelectorAll('#campTipo .tab').forEach((t) =>
      t.classList.toggle('on', t.dataset.t === c.tipo));
    $$('campDidBox').style.display = c.tipo === 'saliente' ? 'none' : '';
    $$('btnCampBorrar').style.display = c.id ? '' : 'none';

    c.marcacion = c.marcacion || [];
    pintarMarcacion();
  }

  /* El DID solo aplica a campañas que reciben llamadas */
  $$('campTipo')?.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t || !editandoCamp) return;
    editandoCamp.tipo = t.dataset.t;
    document.querySelectorAll('#campTipo .tab').forEach((x) => x.classList.toggle('on', x === t));
    $$('campDidBox').style.display = t.dataset.t === 'saliente' ? 'none' : '';
  });

  function pintarMarcacion() {
    const m = editandoCamp?.marcacion || [];
    $$('listaMarcacion').innerHTML = !m.length
      ? '<div class="vacio">Sin contactos de marcación rápida.</div>'
      : m.map((x, i) => `
        <div class="marc" data-i="${i}">
          <input class="fi" data-k="et" value="${(x.et||'').replace(/"/g,'&quot;')}" placeholder="Etiqueta">
          <input class="fi mono" data-k="n" value="${x.n||''}" placeholder="Número">
          <button class="del" data-quitar="${i}">×</button>
        </div>`).join('');
  }

  $$('btnMarcNueva')?.addEventListener('click', () => {
    if (!editandoCamp) return;
    editandoCamp.marcacion = editandoCamp.marcacion || [];
    editandoCamp.marcacion.push({ et:'', n:'' });
    pintarMarcacion();
  });

  $$('listaMarcacion')?.addEventListener('input', (e) => {
    const fila = e.target.closest('.marc');
    if (!fila || !e.target.dataset.k) return;
    editandoCamp.marcacion[Number(fila.dataset.i)][e.target.dataset.k] = e.target.value;
  });

  $$('listaMarcacion')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    editandoCamp.marcacion.splice(Number(b.dataset.quitar), 1);
    pintarMarcacion();
  });

  $$('btnCampGuardar')?.addEventListener('click', async () => {
    if (!editandoCamp) return;

    const datos = {
      id: editandoCamp.id,
      nombre: $$('campNombre').value.trim(),
      tipo: editandoCamp.tipo,
      cola_asterisk: $$('campCola').value.trim(),
      did: $$('campDid').value.trim(),
      formulario_id: Number($$('campForm').value) || null,
      hora_apertura: $$('campApertura').value + ':00',
      hora_cierre: $$('campCierre').value + ':00',
      acw_segundos: 60,
    };

    if (!datos.nombre) { aviso('La campaña necesita un nombre.', 'av-a'); return; }
    if (!datos.cola_asterisk) { aviso('Indica la cola de Asterisk.', 'av-a'); return; }
    if (!/^[a-z0-9_-]+$/i.test(datos.cola_asterisk)) {
      aviso('La cola solo admite letras, números, guion y guion bajo.', 'av-a'); return;
    }
    if (datos.tipo !== 'saliente' && !datos.did) {
      aviso('Una campaña de entrada necesita un DID.', 'av-a'); return;
    }

    const btn = $$('btnCampGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    const r = await servicio.guardarCampana(datos);
    btn.disabled = false; btn.textContent = 'Guardar';

    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    await recargarCampanas();
    $$('editorCampana').style.display = 'none';
    editandoCamp = null;

    if (r.actualizada) { aviso('Campaña actualizada.', 'av-b'); return; }

    let msg = 'Campaña creada.';
    if (r.colaCreada === false) {
      msg += ` La cola <b>${datos.cola_asterisk}</b> debe crearse manualmente en la central.`;
    } else {
      msg += ` Su cola <b>${datos.cola_asterisk}</b> quedó creada en la central.`;
    }
    aviso(msg, 'av-b');
  });

  $$('btnCampCancel')?.addEventListener('click', () => {
    $$('editorCampana').style.display = 'none';
    editandoCamp = null;
  });

  $$('btnCampBorrar')?.addEventListener('click', async () => {
    if (!editandoCamp?.id) return;
    if (!confirm(`¿Desactivar la campaña ${editandoCamp.nombre}?\n\n` +
                 'No se elimina: sus llamadas se conservan para los reportes.')) return;

    const r = await servicio.eliminarCampana(editandoCamp.id);
    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    await recargarCampanas();
    $$('editorCampana').style.display = 'none';
    editandoCamp = null;
    aviso('Campaña desactivada.', 'av-b');
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERADMIN · USUARIOS Y ROLES
     ═══════════════════════════════════════════════════════════════ */

  const ROL_ET = { agente:'Agente', supervisor:'Supervisor', admin:'Superadmin' };

  let usuarios = [];        // lo que se está mostrando

  async function abrirUsuarios() {
    await pintarDistribucion();
    const cs = await servicio.listarCampanas();
    $$('usrCampana').innerHTML = cs.map((c) =>
      `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('');
    await recargarUsuarios();
  }

  async function recargarUsuarios() {
    $$('tablaUsuarios').innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      usuarios = await servicio.listarUsuarios();
    } catch (e) {
      $$('tablaUsuarios').innerHTML =
        `<div class="aviso av-r" style="margin:0"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div>No se pudo cargar la lista: ${seguro.texto(e.message)}</div></div>`;
      return;
    }
    pintarUsuarios();
  }

  function pintarUsuarios() {
    if (!usuarios.length) {
      $$('tablaUsuarios').innerHTML = '<div class="vacio">No hay usuarios registrados.</div>';
      return;
    }
    $$('tablaUsuarios').innerHTML = `<table class="tb">
      <tr><th>Nombre</th><th>Usuario</th><th>Extensión</th><th>Campaña</th><th>Rol</th><th></th></tr>
      ${usuarios.map((u) => `<tr${u.activo === false ? ' style="opacity:.5"' : ''}>
        <td><b>${seguro.texto(u.nombre)}</b>${u.activo === false ? ' <span class="t o">Inactivo</span>' : ''}</td>
        <td class="mono">${seguro.texto(u.usuario)}</td>
        <td class="mono">${seguro.celda(u.extension)}</td>
        <td>${seguro.celda(u.campana)}</td>
        <td>
          <div class="roles" data-usuario="${seguro.texto(u.usuario)}" data-id="${seguro.texto(u.id)}">
            ${Object.keys(ROL_ET).map((r) =>
              `<button class="rol-b ${u.rol === r ? 'on' : ''}" data-rol="${r}">${ROL_ET[r]}</button>`).join('')}
          </div>
        </td>
        <td style="white-space:nowrap">
          <button class="b b-gh b-sm" data-editar="${seguro.texto(u.usuario)}">Editar</button>
          <button class="b b-gh b-sm" data-rest="${seguro.texto(u.id)}" title="Devolver a la contraseña temporal">Restablecer</button>
          ${u.activo === false
            ? `<button class="b b-green b-sm" data-activar="${seguro.texto(u.id)}">Reactivar</button>`
            : (u.usuario === ui.sesion?.usuario
                ? ''
                : `<button class="b b-red b-sm" data-baja="${seguro.texto(u.id)}" title="El usuario deja de entrar; su historial se conserva">Eliminar</button>`)}
        </td>
      </tr>`).join('')}</table>`;
  }

  $$('tablaUsuarios')?.addEventListener('click', async (e) => {
    /* Cambio de rol de un solo clic */
    const rb = e.target.closest('[data-rol]');
    if (rb) {
      const caja = rb.closest('[data-usuario]');
      const r = await servicio.cambiarRolRemoto(
        Number(caja.dataset.id) || null, caja.dataset.usuario, rb.dataset.rol);
      if (!r.ok) { aviso(r.error, 'av-a'); return; }
      await recargarUsuarios();
      aviso(`Rol cambiado a ${ROL_ET[rb.dataset.rol]}. Se aplica al volver a iniciar sesión.`, 'av-b');
      return;
    }

    /* Restablecer contraseña */
    const rest = e.target.closest('[data-rest]');
    if (rest) {
      const u = usuarios.find((x) => String(x.id) === rest.dataset.rest);
      if (!confirm(`¿Restablecer la contraseña de ${u?.nombre || 'este usuario'}?\n\n` +
                   'Volverá a la contraseña temporal y se le exigirá cambiarla al entrar.')) return;
      const r = await servicio.restablecerClave(rest.dataset.rest);
      if (!r.ok) { aviso(r.error, 'av-a'); return; }
      aviso(`Contraseña restablecida. Entrégale: ${r.claveTemporal}`, 'av-b');
      return;
    }

    /* Dar de baja. No se borra la fila: si se eliminara, se perdería
       su historial de llamadas y los reportes de meses anteriores
       quedarían incompletos. Se marca como inactivo. */
    const baja = e.target.closest('[data-baja]');
    if (baja) {
      const u = usuarios.find((x) => String(x.id) === baja.dataset.baja);
      if (!confirm(`¿Eliminar a ${u?.nombre || 'este usuario'}?\n\n` +
                   'Dejará de poder entrar y su extensión se liberará. ' +
                   'Su historial de llamadas se conserva para los reportes.')) return;

      const r = await servicio.desactivarUsuario(baja.dataset.baja);
      if (!r.ok) { aviso(r.error, 'av-a'); return; }
      await recargarUsuarios();
      aviso(`${u?.nombre || 'El usuario'} fue eliminado.`, 'av-b');
      return;
    }

    /* Reactivar */
    const alta = e.target.closest('[data-activar]');
    if (alta) {
      const u = usuarios.find((x) => String(x.id) === alta.dataset.activar);
      const r = await servicio.reactivarUsuario(alta.dataset.activar);
      if (!r.ok) { aviso(r.error, 'av-a'); return; }
      await recargarUsuarios();
      aviso(`${u?.nombre || 'El usuario'} fue reactivado.`, 'av-b');
      return;
    }

    /* Editar */
    const eb = e.target.closest('[data-editar]');
    if (eb) {
      const u = usuarios.find((x) => x.usuario === eb.dataset.editar);
      if (u) editarUsuario({ ...u });
    }
  });

  $$('btnUsrNuevo')?.addEventListener('click', () => {
    editarUsuario({ usuario:'', nombre:'', rol:'agente', extension:'', campana_id:null });
  });

  function editarUsuario(u) {
    editandoUsr = u;
    $$('editorUsuario').style.display = '';
    $$('usrTitulo').textContent = u.nombre || 'Nuevo usuario';
    $$('usrNombre').value = u.nombre || '';
    $$('usrUsuario').value = u.usuario || '';
    $$('usrUsuario').disabled = !!u.id;       // el usuario no se renombra
    $$('usrCorreo').value = u.correo || '';
    $$('usrExt').value = u.extension || '';
    if (u.campana_id != null) $$('usrCampana').value = String(u.campana_id);
    document.querySelectorAll('#usrRol .tab').forEach((t) =>
      t.classList.toggle('on', t.dataset.t === u.rol));

    /* Al crear, se avisa qué contraseña se le entregará */
    const nota = $$('usrNotaClave');
    if (nota) nota.style.display = u.id ? 'none' : '';

    pintarCampanasACargo(u);
  }

  /* ── Campañas a cargo ───────────────────────────────────────────
     Solo tienen sentido para supervisores: de ahí salen los agentes que
     ve, las grabaciones que escucha y los estados que puede crear. */

  async function pintarCampanasACargo(u) {
    const caja = $$('usrCampanasBox');
    if (!caja) return;

    const esSupervisor = (u.rol || 'agente') === 'supervisor';
    caja.style.display = esSupervisor ? '' : 'none';
    if (!esSupervisor) return;

    let asignadas = [];
    if (u.id) {
      try { asignadas = await servicio.campanasDeUsuario(u.id); } catch { /* ninguna */ }
    }
    const marcadas = new Set(asignadas.map((c) => c.id));
    if (u.campana_id) marcadas.add(Number(u.campana_id));

    const cs = await servicio.listarCampanas();
    $$('usrCampanas').innerHTML = cs.map((c) => `
      <label><input type="checkbox" value="${seguro.texto(c.id)}"${marcadas.has(c.id) ? ' checked' : ''}>
        ${seguro.texto(c.nombre)}</label>`).join('') ||
      '<div class="vacio">No hay campañas activas.</div>';
  }

  const campanasMarcadas = () =>
    [...$$('usrCampanas').querySelectorAll('input:checked')].map((i) => Number(i.value));

  $$('usrRol')?.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t || !editandoUsr) return;
    editandoUsr.rol = t.dataset.t;
    document.querySelectorAll('#usrRol .tab').forEach((x) => x.classList.toggle('on', x === t));
    pintarCampanasACargo(editandoUsr);      // las campañas solo aplican al supervisor
  });

  $$('btnUsrGuardar')?.addEventListener('click', async () => {
    if (!editandoUsr) return;

    const datos = {
      id: editandoUsr.id,
      usuario: $$('usrUsuario').value.trim().toLowerCase(),
      nombre: $$('usrNombre').value.trim(),
      correo: $$('usrCorreo').value.trim(),
      extension: $$('usrExt').value.trim(),
      campana_id: Number($$('usrCampana').value) || null,
      campana: $$('usrCampana').selectedOptions[0]?.textContent || '',
      rol: editandoUsr.rol,
    };

    if (!datos.usuario || !datos.nombre) {
      aviso('El usuario necesita nombre y nombre de usuario.', 'av-a'); return;
    }
    if (datos.extension && !/^\d{3,6}$/.test(datos.extension)) {
      aviso('La extensión debe ser un número de 3 a 6 dígitos.', 'av-a'); return;
    }
    if (datos.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(datos.correo)) {
      aviso('El correo no parece válido.', 'av-a'); return;
    }

    const btn = $$('btnUsrGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';

    const r = await servicio.guardarUsuarioRemoto(datos);

    /* Las campañas a cargo van aparte: viven en su propia tabla */
    if (r.ok && datos.rol === 'supervisor') {
      const id = datos.id || r.id;
      if (id) await servicio.guardarCampanasDeUsuario(id, campanasMarcadas());
    }

    btn.disabled = false; btn.textContent = 'Guardar';
    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    await recargarUsuarios();
    $$('editorUsuario').style.display = 'none';
    editandoUsr = null;

    if (r.actualizado) {
      aviso('Usuario actualizado.', 'av-b');
    } else {
      /* Al crear se informa la contraseña temporal y el estado de la
         extensión en la central. */
      let msg = `Usuario creado. Entrégale la contraseña temporal: <b>${CLAVE_TEMPORAL}</b>. ` +
                'Se le pedirá cambiarla al entrar.';
      if (r.extensionCreada === false && datos.extension) {
        msg += `<br><br>La extensión <b>${datos.extension}</b> debe crearse manualmente ` +
               'en la central telefónica.';
      }
      aviso(msg, 'av-b');
    }
  });

  $$('btnUsrCancel')?.addEventListener('click', () => {
    $$('editorUsuario').style.display = 'none';
    editandoUsr = null;
  });

  /* La contraseña temporal la define el backend. Este valor es solo
     informativo para el mensaje que ve el administrador. */
  const CLAVE_TEMPORAL = 'BpmTemp2026#';

  /* ═══════════════════════════════════════════════════════════════
     SUPERADMIN · ALTA MASIVA DE USUARIOS

     Para dar de alta muchas personas de una vez. El administrador
     exporta desde Excel un archivo separado por comas y lo sube.

     Se hace en dos pasos a propósito: primero una revisión que no
     escribe nada y muestra fila por fila qué está bien y qué está mal,
     y solo después la creación. Con 300 filas, descubrir los errores
     después de crearlas sería mucho peor.
     ═══════════════════════════════════════════════════════════════ */

  const COLUMNAS = ['usuario', 'nombre', 'correo', 'extension', 'campana', 'rol'];
  let filasMasivas = [];

  /* El archivo lo interpreta el servidor: así se aceptan Excel y CSV
     por el mismo camino. */

  $$('masArchivo')?.addEventListener('change', async (e) => {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    e.target.value = '';                    // permite volver a subir el mismo

    $$('masResultado').innerHTML = '<div class="vacio">Leyendo el archivo…</div>';

    /* El servidor interpreta el archivo: así se aceptan Excel y CSV. */
    let filas, error;
    try {
      ({ filas } = await servicio.leerTabla(archivo));
      if (!filas.some((f) => f.usuario || f.nombre)) {
        error = 'Al archivo le faltan las columnas "usuario" y "nombre". Descarga la plantilla.';
      }
    } catch (e) {
      error = e.message;
    }

    if (error) {
      filasMasivas = [];
      $$('masCrear').style.display = 'none';
      $$('masN').textContent = '—';
      $$('masResultado').innerHTML =
        `<div class="aviso av-r" style="margin:0"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div>${seguro.texto(error)}</div></div>`;
      return;
    }

    $$('masResultado').innerHTML = `<div class="vacio">Revisando ${filas.length} filas…</div>`;

    let r;
    try {
      r = await servicio.altaMasiva(filas, true);     // revisar, sin crear
    } catch (err) {
      $$('masResultado').innerHTML =
        `<div class="aviso av-r" style="margin:0"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><div>${seguro.texto(err.message)}</div></div>`;
      return;
    }

    filasMasivas = filas;
    pintarRevision(r);
  });

  function pintarRevision(r) {
    $$('masN').textContent = `${r.correctas} de ${r.total}`;
    $$('masCrear').style.display = r.correctas ? '' : 'none';
    $$('masCrear').textContent = `Crear ${r.correctas} usuario(s)`;

    const resumen = r.conError
      ? `<div class="aviso av-a" style="margin:0 0 10px">
           <svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
           <div>${r.correctas} fila(s) listas y ${r.conError} con problemas.
           Solo se crearán las correctas; corrige el archivo y vuelve a subirlo
           si quieres las demás.</div></div>`
      : `<div class="aviso av-b" style="margin:0 0 10px">
           <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
           <div>Las ${r.correctas} filas están correctas.</div></div>`;

    $$('masResultado').innerHTML = resumen + `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Línea</th><th>Usuario</th><th>Nombre</th><th>Correo</th><th>Ext.</th>
          <th>Campaña</th><th>Rol</th><th>Revisión</th></tr>
      ${r.filas.map((f) => `<tr${f.errores.length ? ' style="background:var(--danger-l)"' : ''}>
        <td class="mono">${seguro.texto(f.linea)}</td>
        <td class="mono">${seguro.celda(f.usuario)}</td>
        <td>${seguro.celda(f.nombre)}</td>
        <td>${seguro.celda(f.correo)}</td>
        <td class="mono">${seguro.celda(f.extension)}</td>
        <td>${seguro.celda(f.campana)}</td>
        <td>${seguro.celda(f.rol)}</td>
        <td>${f.errores.length
          ? `<span class="mas-error">${seguro.texto(f.errores.join('. '))}</span>`
          : '<span class="mas-ok">Lista</span>'}</td>
      </tr>`).join('')}</table></div>`;
  }

  $$('masCrear')?.addEventListener('click', async () => {
    if (!filasMasivas.length) return;

    const btn = $$('masCrear');
    btn.disabled = true; btn.textContent = 'Creando…';

    let r;
    try {
      r = await servicio.altaMasiva(filasMasivas, false);
    } catch (e) {
      aviso('No se pudo completar: ' + e.message, 'av-a');
      btn.disabled = false; btn.textContent = 'Crear los usuarios';
      return;
    }

    btn.disabled = false;
    btn.style.display = 'none';
    filasMasivas = [];

    await recargarUsuarios();

    const fallos = r.fallidos?.length
      ? `<br>${r.fallidos.length} fila(s) fallaron al crearse: ` +
        seguro.texto(r.fallidos.map((f) => `línea ${f.linea}`).join(', '))
      : '';
    $$('masResultado').innerHTML = `<div class="aviso av-b" style="margin:0">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
      <div><b>${r.creados} usuario(s) creados.</b> Todos entran con la contraseña
      <b>${seguro.texto(r.claveTemporal)}</b> y deberán cambiarla al ingresar.${fallos}</div></div>`;
    $$('masN').textContent = `${r.creados} creados`;
  });

  /* La plantilla evita la mitad de los errores: el administrador parte
     del formato correcto en lugar de adivinarlo. */
  $$('masPlantilla')?.addEventListener('click', () => {
    /* La primera línea le dice a Excel cómo separar. Sin ella, según
       la configuración del equipo, todo aparece en una sola columna. */
    const ejemplo = [
      'sep=;',
      COLUMNAS.join(';'),
      'jperez;Juan Pérez;jperez@bpmconsulting.com.co;1101;Ventas;agente',
      'mlopez;María López;mlopez@bpmconsulting.com.co;1102;Ventas;agente',
      'csoto;Carlos Soto;csoto@bpmconsulting.com.co;;Ventas;supervisor',
    ].join('\r\n');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + ejemplo], { type: 'text/csv;charset=utf-8' }));
    a.download = 'plantilla_usuarios.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });

  /* ═══════════════════════════════════════════════════════════════
     SUPERADMIN · MÓDULOS
     ═══════════════════════════════════════════════════════════════ */

  function abrirModulos() {
    $$('listaModulos').innerHTML = MODULOS.map((m) => `
      <div class="modulo">
        <div class="bd"><b>${m.nom}</b><span>${m.desc}</span></div>
        <button class="sw ${m.on ? 'on' : ''}" data-mod="${m.id}">
          <span class="sw-p"></span>
          <span class="sw-t">${m.on ? 'Activo' : 'Inactivo'}</span>
        </button>
      </div>`).join('');
  }

  $$('listaModulos')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mod]');
    if (!b) return;
    const m = MODULOS.find((x) => x.id === b.dataset.mod);
    if (!m) return;
    m.on = !m.on;
    abrirModulos();
    aviso(`Módulo ${m.nom} ${m.on ? 'activado' : 'desactivado'}.`, 'av-b');
  });

  /* ── Utilidades ─────────────────────────────────────────────── */
  const duracion = (s) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return {
    abrirCampanas, abrirGrabaciones, abrirEscucha,
    abrirAdmCampanas, abrirUsuarios, abrirModulos,
    get campanas() { return campanas.map((c) => ({ ...c })); },
    get modulos() { return MODULOS.map((m) => ({ ...m })); },
  };
})();
