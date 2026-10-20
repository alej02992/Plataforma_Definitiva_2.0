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

  /* ═══════════ DISTRIBUCIÓN DE AGENTES ═══════════

     Una columna por campaña, con sus agentes dentro. Antes era una lista
     donde había que usar Ctrl o Shift para marcar varios, y no se veía
     quién estaba en cada campaña. Ahora se marca con casillas y se ve el
     reparto de un vistazo.                                             */

  let agentesDist = [];
  const marcadosDist = new Set();

  /* Cuántos se ven por campaña antes de pulsar "Ver todos". Con veinte o
     cincuenta agentes, la columna crecería hasta el fondo de la página. */
  const VISIBLES = 5;
  const columnasAbiertas = new Set();

  async function pintarDistribucion() {
    /* Las campañas se cargaban solo al visitar la vista de Campañas. Si
       se entraba directo a Usuarios, no había columnas ni destinos. */
    if (!campanas.length) {
      try { campanas = await servicio.listarCampanas(); } catch { campanas = []; }
    }
    const todos = await servicio.listarUsuarios();
    agentesDist = todos.filter((u) => u.rol === 'agente' && u.activo !== false);
    if ($$('distTotal')) $$('distTotal').textContent = `${agentesDist.length} agentes`;
    dibujarColumnas();

    $$('selDestino').innerHTML = campanas.map((c) =>
      `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('');
  }

  function dibujarColumnas() {
    const filtro = String($$('distBuscar')?.value || '').trim().toLowerCase();

    /* Las campañas, más una columna para los que no tienen ninguna */
    const columnas = campanas.map((c) => ({ nombre: c.nombre, agentes: [] }));
    const sinCampana = { nombre: 'Sin campaña', agentes: [], vacia: true };

    agentesDist.forEach((a) => {
      const col = columnas.find((c) => c.nombre === a.campana) || sinCampana;
      col.agentes.push(a);
    });
    if (sinCampana.agentes.length) columnas.push(sinCampana);

    const clave = (a) => String(a.id ?? a.usuario);
    const coincide = (a) => !filtro ||
      String(a.nombre).toLowerCase().includes(filtro) ||
      String(a.usuario).toLowerCase().includes(filtro) ||
      String(a.extension || '').includes(filtro);

    if (!agentesDist.length) {
      $$('distCols').innerHTML = '<div class="vacio">No hay agentes activos.</div>';
      actualizarDist();
      return;
    }

    $$('distCols').innerHTML = columnas.map((col) => {
      const visibles = col.agentes.filter(coincide);

      /* Se muestran los primeros; el resto, al pulsar "Ver todos". Si se
         está buscando, se muestran todos los que coinciden. */
      const abierta = filtro || columnasAbiertas.has(col.nombre);
      const mostrar = abierta ? visibles : visibles.slice(0, VISIBLES);
      const ocultos = visibles.length - mostrar.length;

      return `
      <div class="dist-col${col.vacia ? ' dist-col-sin' : ''}">
        <div class="dist-col-h">
          <b>${seguro.texto(col.nombre)}</b>
          <span class="t ${col.agentes.length ? 'b' : 'o'}">${col.agentes.length}</span>
        </div>
        ${col.agentes.length ? `
          <label class="dist-todos"><input type="checkbox" data-col="${seguro.texto(col.nombre)}"
            ${visibles.length && visibles.every((a) => marcadosDist.has(clave(a))) ? 'checked' : ''}>
            Marcar todos</label>` : ''}
        <div class="dist-lista">
          ${mostrar.map((a) => `
            <label class="dist-ag${marcadosDist.has(clave(a)) ? ' on' : ''}">
              <input type="checkbox" data-ag="${seguro.texto(clave(a))}"
                ${marcadosDist.has(clave(a)) ? 'checked' : ''}>
              <span class="dist-av">${seguro.texto(String(a.nombre || '?').trim().charAt(0).toUpperCase())}</span>
              <span class="dist-bd"><b>${seguro.texto(a.nombre)}</b>
                <small>${a.extension ? 'Ext. ' + seguro.texto(a.extension) : seguro.texto(a.usuario)}</small></span>
            </label>`).join('') ||
            `<div class="dist-vacia">${col.agentes.length ? 'Ninguno coincide' : 'Sin agentes'}</div>`}
        </div>
        ${ocultos > 0 ? `<button class="dist-mas" type="button" data-ver="${seguro.texto(col.nombre)}">
            Ver los ${visibles.length} ▾</button>`
          : (!filtro && columnasAbiertas.has(col.nombre) && visibles.length > VISIBLES
            ? `<button class="dist-mas" type="button" data-ver="${seguro.texto(col.nombre)}">Ver menos ▴</button>` : '')}
      </div>`;
    }).join('');

    actualizarDist();
  }

  function actualizarDist() {
    const n = marcadosDist.size;
    $$('distBarra').style.display = n ? '' : 'none';
    $$('distTxt').textContent = `Mover ${n} agente${n === 1 ? '' : 's'}`;
  }

  $$('distCols')?.addEventListener('change', (e) => {
    const ag = e.target.dataset.ag;
    const col = e.target.dataset.col;

    if (ag) {
      if (e.target.checked) marcadosDist.add(ag); else marcadosDist.delete(ag);
      e.target.closest('.dist-ag')?.classList.toggle('on', e.target.checked);
      actualizarDist();
    }
    if (col) {
      const filtro = String($$('distBuscar')?.value || '').trim().toLowerCase();
      agentesDist
        .filter((a) => (a.campana || 'Sin campaña') === col || (col === 'Sin campaña' &&
                       !campanas.some((c) => c.nombre === a.campana)))
        .filter((a) => !filtro || String(a.nombre).toLowerCase().includes(filtro) ||
                       String(a.usuario).toLowerCase().includes(filtro))
        .forEach((a) => {
          const k = String(a.id ?? a.usuario);
          if (e.target.checked) marcadosDist.add(k); else marcadosDist.delete(k);
        });
      dibujarColumnas();
    }
  });

  $$('distBuscar')?.addEventListener('input', dibujarColumnas);

  $$('distCols')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ver]');
    if (!b) return;
    const n = b.dataset.ver;
    if (columnasAbiertas.has(n)) columnasAbiertas.delete(n); else columnasAbiertas.add(n);
    dibujarColumnas();
  });

  $$('btnDistLimpiar')?.addEventListener('click', () => {
    marcadosDist.clear();
    dibujarColumnas();
  });

  $$('btnMover')?.addEventListener('click', async () => {
    const lista = agentesDist.filter((a) => marcadosDist.has(String(a.id ?? a.usuario)));
    if (!lista.length) return;

    const campanaId = Number($$('selDestino').value);
    const destino = $$('selDestino').selectedOptions[0]?.textContent || '';

    /* Los que ya están en esa campaña no se mueven: no hay nada que hacer */
    const aMover = lista.filter((a) => a.campana !== destino);
    if (!aMover.length) {
      aviso(`Los agentes marcados ya están en ${destino}.`, 'av-a');
      return;
    }

    const btn = $$('btnMover');
    btn.disabled = true;
    let ok = 0;
    for (const a of aMover) {
      btn.textContent = `Moviendo ${ok + 1} de ${aMover.length}…`;
      const r = await servicio.cambiarCampanaRemoto(Number(a.id) || null, a.usuario, campanaId, destino);
      if (r.ok) ok++;
    }
    btn.disabled = false;
    btn.textContent = 'Mover';

    marcadosDist.clear();
    await pintarDistribucion();
    aviso(ok === aMover.length
      ? `${ok} agente(s) movido(s) a ${destino}.`
      : `Se movieron ${ok} de ${aMover.length}. Revisa los que fallaron.`,
      ok === aMover.length ? 'av-b' : 'av-a');
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

     El servidor comprueba que el agente sea de una campaña del
     supervisor, lo deja registrado y devuelve un código interno. La
     plataforma lo marca por detrás, en silencio: el supervisor pulsa
     el botón y empieza a oír, sin contestar nada.

     Se marca desde su navegador y no al revés porque, si la central lo
     llamara a él, tendría que contestar su teléfono para poder oír. */
  $$('tablaEscucha')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-oir]');
    if (!b) return;

    if (telefonia.estado !== 'reposo') {
      aviso('Cuelga tu llamada actual antes de entrar a escuchar.', 'av-a');
      return;
    }

    const susurro = b.dataset.modo === 'susurrar';
    const texto = susurro
      ? `Vas a hablarle a ${b.dataset.nombre}. El cliente no te escuchará.`
      : `Vas a escuchar la llamada de ${b.dataset.nombre}. Ni el agente ni el cliente lo notarán.`;

    if (!confirm(`${texto}\n\nQueda registrado en la auditoría.`)) return;

    b.disabled = true;
    try {
      const r = await servicio.escuchar(b.dataset.oir, b.dataset.modo);

      /* El código no se le muestra: es plomería, no información útil */
      await telefonia.llamar(r.numero);

      escuchando = b.dataset.oir;
      $$('escuchaActiva').style.display = '';
      $$('escDetalle').textContent =
        `${b.dataset.nombre} · extensión ${b.dataset.oir} · ${susurro ? 'susurrando' : 'escuchando'}`;
      aviso(susurro ? 'Estás hablando con el agente.' : 'Estás escuchando la llamada.', 'av-b');
    } catch (err) {
      aviso(err.message, 'av-a');
    } finally {
      b.disabled = false;
    }
  });

  /* Salir es colgar: la escucha vive en la llamada del supervisor */
  $$('btnDejarEscucha')?.addEventListener('click', () => {
    if (telefonia.estado !== 'reposo') telefonia.colgar();
    escuchando = null;
    $$('escuchaActiva').style.display = 'none';
    aviso('Escucha finalizada.', 'av-b');
  });

  /* Si cuelga desde el softphone, la tarjeta no puede quedarse puesta */
  telefonia.on('fin', () => {
    if (escuchando) {
      escuchando = null;
      if ($$('escuchaActiva')) $$('escuchaActiva').style.display = 'none';
    }
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

  /* Los formularios salen del servidor. Antes venían de una copia
     guardada en el navegador, que ya no se llena: el desplegable
     aparecía siempre vacío. */
  async function llenarFormularios() {
    let fs = [];
    try { fs = await servicio.listarFormularios(); } catch { /* queda vacío */ }

    $$('campForm').innerHTML = '<option value="">— Sin formulario —</option>' +
      fs.map((f) => `<option value="${seguro.texto(f.id)}">${
        seguro.texto(f.nombre)}</option>`).join('');
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

  /* ── Apartados plegables ──
     Al entrar se ven los tres títulos con su número; se despliega el que
     se va a usar. Así la página no se vuelve eterna con muchos usuarios.
     Lo abierto se recuerda mientras dure la sesión. */
  const abiertos = new Set();

  function aplicarPlegables() {
    document.querySelectorAll('[data-v="usuarios"] .plegable').forEach((c) => {
      const abierto = abiertos.has(c.dataset.pleg);
      c.classList.toggle('abierto', abierto);
      const f = c.querySelector('.pleg-f');
      if (f) f.textContent = abierto ? '▾' : '▸';
    });
  }

  document.querySelectorAll('[data-v="usuarios"] .plegable .pleg-t').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.closest('.plegable').dataset.pleg;
      if (abiertos.has(id)) abiertos.delete(id); else abiertos.add(id);
      aplicarPlegables();
    });
  });

  /* "Nuevo usuario" despliega la lista, para que se vea el resultado */
  $$('btnUsrNuevo')?.addEventListener('click', () => { abiertos.add('usuarios'); aplicarPlegables(); });

  async function abrirUsuarios() {
    aplicarPlegables();
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

  /* ── Selección para eliminar varios ── */
  const seleccion = new Set();

  function actualizarBarra() {
    /* Solo cuentan los que siguen en la lista */
    [...seleccion].forEach((id) => { if (!usuarios.some((u) => String(u.id) === id)) seleccion.delete(id); });

    const marcados = usuarios.filter((u) => seleccion.has(String(u.id)));
    const activos = marcados.filter((u) => u.activo !== false);
    const inactivos = marcados.filter((u) => u.activo === false);

    $$('usrBarra').style.display = marcados.length ? '' : 'none';
    $$('usrBarraTxt').textContent = `${marcados.length} seleccionado(s)`;

    /* Dar de baja aplica a los activos; eliminar definitivamente, a los
       ya dados de baja. Es la misma regla que la de uno en uno. */
    $$('btnUsrBajaVarios').style.display = activos.length ? '' : 'none';
    $$('btnUsrBajaVarios').textContent = `Dar de baja (${activos.length})`;
    /* Eliminar definitivamente aplica a TODOS los marcados: a los
       activos se les da de baja primero, en el mismo paso. Antes había
       que darlos de baja, volver a marcarlos y eliminarlos. */
    $$('btnUsrBorrarVarios').style.display = '';
    $$('btnUsrBorrarVarios').textContent = `Eliminar definitivamente (${marcados.length})`;

    const todos = $$('usrTodos');
    if (todos) {
      const marcables = filtrados().filter((u) => u.usuario !== ui.sesion?.usuario);
      todos.checked = marcables.length > 0 && marcables.every((u) => seleccion.has(String(u.id)));
    }
  }

  $$('tablaUsuarios')?.addEventListener('change', (e) => {
    if (e.target.id === 'usrTodos') {
      /* Solo los que se ven: si se filtró por "dados de baja", marcar
         todos no debe arrastrar a los activos que no están a la vista. */
      const marcar = e.target.checked;
      filtrados().filter((u) => u.usuario !== ui.sesion?.usuario)
        .forEach((u) => (marcar ? seleccion.add(String(u.id)) : seleccion.delete(String(u.id))));
      $$('tablaUsuarios').querySelectorAll('[data-sel]').forEach((c) => { c.checked = marcar; });
    } else if (e.target.dataset.sel) {
      if (e.target.checked) seleccion.add(e.target.dataset.sel);
      else seleccion.delete(e.target.dataset.sel);
    } else {
      return;
    }
    actualizarBarra();
  });

  /* ── Seleccionar desde archivo ──
     Para cuando llega una lista larga —de Recursos Humanos, por ejemplo—
     con las personas que salieron. El archivo no borra nada: solo marca
     las casillas, y después se usa la misma barra de siempre. */
  $$('usrSelArchivo')?.addEventListener('change', async (e) => {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    e.target.value = '';

    $$('usrSelRes').innerHTML = '<div class="hint">Leyendo el archivo…</div>';

    let filas;
    try {
      ({ filas } = await servicio.leerTabla(archivo));
    } catch (err) {
      $$('usrSelRes').innerHTML = `<div class="aviso av-r"><div>${seguro.texto(err.message)}</div></div>`;
      return;
    }

    /* Se busca por usuario, que es único. Si el archivo no trae esa
       columna, se intenta con la primera que tenga. */
    const valores = (filas || []).map((f) => {
      const v = f.usuario ?? f.Usuario ?? f.USUARIO ?? Object.values(f)[0];
      return String(v ?? '').trim().toLowerCase();
    }).filter(Boolean);

    const encontrados = [];
    const noEstan = [];
    const yoMismo = ui.sesion?.usuario;

    [...new Set(valores)].forEach((v) => {
      const u = usuarios.find((x) => String(x.usuario).toLowerCase() === v);
      if (!u) noEstan.push(v);
      else if (u.usuario !== yoMismo) encontrados.push(u);
    });

    encontrados.forEach((u) => seleccion.add(String(u.id)));

    /* Que se vea lo marcado: se quitan los filtros y se abre la lista */
    $$('usrBuscar').value = '';
    $$('usrFiltroEstado').value = '';
    $$('usrFiltroRol').value = '';
    abiertos.add('usuarios');
    aplicarPlegables();
    pintarUsuarios();

    $$('usrSelRes').innerHTML = `<div class="aviso ${noEstan.length ? 'av-a' : 'av-b'}"><div>
      Se marcaron <b>${encontrados.length}</b> usuario(s) del archivo.${noEstan.length
        ? ` <b>${noEstan.length}</b> no existen en la plataforma: ${
            seguro.texto(noEstan.slice(0, 6).join(', '))}${noEstan.length > 6 ? '…' : ''}` : ''}
      ${encontrados.length ? 'Revisa la lista y usa la barra para eliminarlos.' : ''}</div></div>`;
  });

  $$('btnUsrQuitarSel')?.addEventListener('click', () => {
    seleccion.clear();
    pintarUsuarios();
  });

  /**
   * Aplica una acción a varios usuarios, uno por uno.
   *
   * Usa las mismas rutas que los botones de cada fila, así que tiene las
   * mismas protecciones: el servidor puede rechazar alguno —por ejemplo
   * el último administrador— y los demás siguen. Al final se dice
   * cuántos salieron bien y por qué fallaron los otros.
   */
  async function aplicarAVarios(lista, accion, verbo, boton) {
    const original = boton.textContent;
    boton.disabled = true;
    let bien = 0;
    const fallos = [];

    for (let i = 0; i < lista.length; i++) {
      const u = lista[i];
      boton.textContent = `${verbo} ${i + 1} de ${lista.length}…`;
      try {
        const r = await accion(u.id);
        if (r && r.ok === false) fallos.push(`${u.nombre}: ${r.error}`);
        else { bien++; seleccion.delete(String(u.id)); }
      } catch (err) {
        fallos.push(`${u.nombre}: ${err.message}`);
      }
    }

    boton.disabled = false;
    boton.textContent = original;
    await recargarUsuarios();
    /* La distribución también: si no, seguiría mostrando a los eliminados */
    await pintarDistribucion();

    aviso(fallos.length
      ? `${bien} de ${lista.length} listos. No se pudo con: ${fallos.slice(0, 3).join(' · ')}${
          fallos.length > 3 ? ` y ${fallos.length - 3} más` : ''}`
      : `${bien} usuario(s) listos.`,
      fallos.length ? 'av-a' : 'av-b');
  }

  $$('btnUsrBajaVarios')?.addEventListener('click', async () => {
    const lista = usuarios.filter((u) => seleccion.has(String(u.id)) && u.activo !== false);
    if (!lista.length) return;
    if (!confirm(`¿Dar de baja a ${lista.length} usuario(s)?\n\n` +
                 lista.slice(0, 8).map((u) => '· ' + u.nombre).join('\n') +
                 (lista.length > 8 ? `\n· y ${lista.length - 8} más` : '') +
                 '\n\nDejarán de poder entrar y sus extensiones se liberarán. ' +
                 'Su historial de llamadas se conserva.')) return;
    await aplicarAVarios(lista, (id) => servicio.desactivarUsuario(id), 'Dando de baja', $$('btnUsrBajaVarios'));
  });

  $$('btnUsrBorrarVarios')?.addEventListener('click', async () => {
    const lista = usuarios.filter((u) => seleccion.has(String(u.id)));
    if (!lista.length) return;
    if (!confirm(`¿Eliminar DEFINITIVAMENTE a ${lista.length} usuario(s)?\n\n` +
                 lista.slice(0, 8).map((u) => '· ' + u.nombre).join('\n') +
                 (lista.length > 8 ? `\n· y ${lista.length - 8} más` : '') +
                 '\n\nDesaparecen de la lista. Sus llamadas y gestiones se conservan ' +
                 'en los reportes, con su nombre.\n\nEsto no se puede deshacer.')) return;
    /* A los activos se les da de baja y se eliminan en seguida: el
       borrado definitivo, por diseño, solo aplica a usuarios de baja. */
    await aplicarAVarios(lista, async (id) => {
      const u = usuarios.find((x) => String(x.id) === String(id));
      if (u && u.activo !== false) {
        const r = await servicio.desactivarUsuario(id);
        if (r && r.ok === false) return r;
      }
      return servicio.eliminarUsuarioDefinitivo(id);
    }, 'Eliminando', $$('btnUsrBorrarVarios'));
  });

  /** Los usuarios que pasan el buscador y los filtros. */
  function filtrados() {
    const q = String($$('usrBuscar')?.value || '').trim().toLowerCase();
    const estado = $$('usrFiltroEstado')?.value || '';
    const rol = $$('usrFiltroRol')?.value || '';

    return usuarios.filter((u) => {
      if (estado === 'activo' && u.activo === false) return false;
      if (estado === 'baja' && u.activo !== false) return false;
      if (rol && u.rol !== rol) return false;
      if (!q) return true;
      return [u.nombre, u.usuario, u.extension, u.campana]
        .some((v) => String(v ?? '').toLowerCase().includes(q));
    });
  }

  ['usrBuscar', 'usrFiltroEstado', 'usrFiltroRol'].forEach((id) =>
    $$(id)?.addEventListener(id === 'usrBuscar' ? 'input' : 'change', () => pintarUsuarios()));

  function pintarUsuarios() {
    if ($$('usrTotal')) {
      const activos = usuarios.filter((u) => u.activo !== false).length;
      $$('usrTotal').textContent = activos === usuarios.length ? `${activos}` : `${activos} activos`;
    }

    if (!usuarios.length) {
      $$('tablaUsuarios').innerHTML = '<div class="vacio">No hay usuarios registrados.</div>';
      return;
    }

    const lista = filtrados();
    if (!lista.length) {
      $$('tablaUsuarios').innerHTML = '<div class="vacio">Ningún usuario coincide con la búsqueda.</div>';
      actualizarBarra();
      return;
    }
    /* Una casilla por usuario para eliminar varios a la vez. La propia
       cuenta no se puede marcar: nadie debe poder darse de baja a sí
       mismo y quedarse fuera de la plataforma. */
    const yo = ui.sesion?.usuario;

    $$('tablaUsuarios').innerHTML = `<table class="tb">
      <tr><th style="width:28px"><input type="checkbox" id="usrTodos" title="Marcar todos"></th>
        <th>Nombre</th><th>Usuario</th><th>Extensión</th><th>Campaña</th><th>Rol</th><th></th></tr>
      ${lista.map((u) => `<tr${u.activo === false ? ' style="opacity:.5"' : ''}>
        <td>${u.usuario === yo ? ''
          : `<input type="checkbox" data-sel="${seguro.texto(u.id)}"${seleccion.has(String(u.id)) ? ' checked' : ''}>`}</td>
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
            ? `<button class="b b-green b-sm" data-activar="${seguro.texto(u.id)}">Reactivar</button>
               <button class="b b-red b-sm" data-borrar-usr="${seguro.texto(u.id)}"
                       title="Quitarlo de la lista para siempre">Eliminar definitivamente</button>`
            : (u.usuario === ui.sesion?.usuario
                ? ''
                : `<button class="b b-red b-sm" data-baja="${seguro.texto(u.id)}" title="El usuario deja de entrar; su historial se conserva">Eliminar</button>`)}
        </td>
      </tr>`).join('')}</table>`;
    actualizarBarra();
  }

  /* ── Eliminar definitivamente ──
     Solo aparece en usuarios ya desactivados. Lo que dejaron hecho no
     se borra: las llamadas y gestiones conservan su nombre. */
  $$('tablaUsuarios')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-borrar-usr]');
    if (!b) return;

    const nombre = b.closest('tr')?.querySelector('b')?.textContent || 'este usuario';

    if (!confirm(`¿Eliminar definitivamente a ${nombre}?\n\n` +
                 'Desaparece de la lista y su extensión se borra de la central.\n' +
                 'Sus llamadas y gestiones se conservan en los reportes, con su nombre.\n\n' +
                 'Esto no se puede deshacer.')) return;

    b.disabled = true;
    try {
      const r = await servicio.eliminarUsuarioDefinitivo(b.dataset.borrarUsr);
      await recargarUsuarios();

      const c = r.conservado || {};
      const quedan = [
        c.llamadas ? `${c.llamadas} llamada(s)` : null,
        c.gestiones ? `${c.gestiones} gestión(es)` : null,
        c.formularios ? `${c.formularios} formulario(s)` : null,
      ].filter(Boolean);

      aviso(quedan.length
        ? `${nombre} eliminado. Se conservan ${quedan.join(', ')} con su nombre.`
        : `${nombre} eliminado.`, 'av-b');
    } catch (err) {
      aviso(err.message, 'av-a');
      b.disabled = false;
    }
  });

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
  };
})();