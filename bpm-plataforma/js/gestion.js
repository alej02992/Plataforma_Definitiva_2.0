/* ═══════════════════════════════════════════════════════════════════
   ESTADOS DE PAUSA · los define el supervisor

   El agente ya no escribe sus propios estados: el supervisor los crea,
   decide si son para todas las campañas o para una sola, y los activa o
   desactiva. Los activos aparecen como botón en el panel de los agentes
   que correspondan, sin que tengan que recargar.

   Los estados básicos (break, almuerzo, baño…) son de todas las campañas
   y no se pueden eliminar ni desactivar. Cada campaña puede darles su
   propia duración; si no, usan la general.

   El servidor también comprueba a quién le toca cada estado, así que
   ocultar un botón no es lo único que lo protege.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const gestionEstados = (() => {
  const $e = (id) => document.getElementById(id);

  async function abrir() {
    if (!$e('tablaEstados')) return;
    await llenarCampanas();
    await pintar();
    vigilar(true);
  }

  let puedeGeneral = false;      // solo el administrador
  let campanasEst = [];          // las campañas que administra quien está
  let listaActual = [];          // todos los estados, tal como llegaron

  /* El supervisor solo administra sus campañas: su desplegable trae las
     suyas y no incluye "Todas". El servidor lo comprueba igual. */
  async function llenarCampanas() {
    let r = { general: false, campanas: [] };
    try { r = await servicio.campanasDeEstados(); } catch { /* queda vacío */ }

    puedeGeneral = !!r.general;
    campanasEst = r.campanas;

    /* Las campañas para ver la duración de los básicos */
    const previa = $e('estBasCampana')?.value;
    if ($e('estBasCampana')) {
      $e('estBasCampana').innerHTML = r.campanas.length
        ? r.campanas.map((c) => `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('')
        : '<option value="">Sin campañas asignadas</option>';
      $e('estBasCampana').disabled = !r.campanas.length;
      if (previa && r.campanas.some((c) => String(c.id) === previa)) $e('estBasCampana').value = previa;
    }

    const opciones = r.campanas
      .map((c) => `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('');

    $e('estCampana').innerHTML = puedeGeneral
      ? '<option value="">Todas las campañas</option>' + opciones
      : opciones;

    /* Sin campañas asignadas no puede crear: se dice por qué. */
    const sinCampanas = !puedeGeneral && !r.campanas.length;
    $e('estCampana').disabled = sinCampanas;
    $e('estNuevo').disabled = sinCampanas;
    $e('btnEstCrear').disabled = sinCampanas;
    if (sinCampanas) {
      $e('estCampana').innerHTML = '<option>Sin campañas asignadas</option>';
    }
  }

  async function pintar() {
    $e('tablaEstados').innerHTML = '<div class="vacio">Cargando…</div>';

    let lista;
    try {
      lista = await servicio.listarEstados(true);
    } catch (e) {
      $e('tablaEstados').innerHTML =
        `<div class="vacio">No se pudieron cargar: ${seguro.texto(e.message)}</div>`;
      return;
    }

    listaActual = lista;
    pintarBasicos();

    /* Abajo, solo los propios de cada campaña */
    lista = lista.filter((t) => !t.basico);
    const mios = lista.filter((t) => t.editable).length;
    $e('estN').textContent = puedeGeneral
      ? `${lista.filter((t) => t.activo).length} activos`
      : `${mios} de tus campañas`;

    if (!lista.length) {
      $e('tablaEstados').innerHTML = '<div class="vacio">Ninguna campaña tiene estados propios todavía.</div>';
      return;
    }

    $e('tablaEstados').innerHTML = `<table class="tb">
      <tr><th>Estado</th><th>Campaña</th><th>Duración</th><th>Situación</th><th></th></tr>
      ${lista.map((t) => `<tr>
        <td><b>${seguro.texto(t.nombre)}</b></td>
        <td>${t.campana_id ? seguro.texto(t.campana) : 'Todas'}</td>
        <td class="mono">${t.limite_minutos ? seguro.texto(t.limite_minutos) + ' min' : 'Sin límite'}</td>
        <td><span class="t ${t.activo ? 'g' : 'o'}">${t.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td style="text-align:right;white-space:nowrap">
          ${t.editable ? `
            <button class="b ${t.activo ? 'b-gh' : 'b-teal'} b-sm"
                    data-est="${seguro.texto(t.id)}" data-act="${t.activo ? 0 : 1}">
              ${t.activo ? 'Desactivar' : 'Activar'}</button>
            <button class="b b-red b-sm" data-borrar="${seguro.texto(t.id)}"
                    title="Solo si nunca se ha usado">Eliminar</button>`
          : ''}
        </td></tr>`).join('')}</table>`;
  }

  /* ═══════════ ESTADOS BÁSICOS ═══════════
     Una fila por estado, con su duración en la campaña elegida. La
     duración se guarda sola al cambiarla: vacía = usa la general. */
  const minutos = (m) => (m === null || m === undefined ? 'Sin límite' : `${m} min`);

  function pintarBasicos() {
    const caja = $e('tablaBasicos');
    if (!caja) return;
    const basicos = listaActual.filter((t) => t.basico);
    $e('estBasN').textContent = `${basicos.length} estados`;

    const cid = $e('estBasCampana')?.value;
    if (!cid) {
      caja.innerHTML = '<div class="vacio">No tienes campañas a cargo.</div>';
      return;
    }
    if (!basicos.length) {
      caja.innerHTML = '<div class="vacio">No hay estados básicos.</div>';
      return;
    }
    const campana = campanasEst.find((c) => String(c.id) === String(cid))?.nombre || '';

    caja.innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Estado</th><th>Duración en ${seguro.texto(campana)}</th><th></th><th>General</th><th></th></tr>
      ${basicos.map((t) => {
        const propia = t.porCampana && Object.prototype.hasOwnProperty.call(t.porCampana, cid);
        const valor = propia ? t.porCampana[cid] : undefined;      // número, null (sin límite) o undefined
        return `<tr>
          <td><b>${seguro.texto(t.nombre)}</b>${t.activo ? '' : ' <span class="t o">Inactivo</span>'}</td>
          <td style="white-space:nowrap">
            <input class="fi mono est-min" type="number" min="1" max="480" data-dur="${seguro.texto(t.id)}"
                   value="${propia && valor !== null ? seguro.texto(valor) : ''}"
                   placeholder="${propia ? '' : seguro.texto(t.limite_minutos ?? '∞')}"
                   ${propia && valor === null ? 'disabled' : ''} aria-label="Minutos en ${seguro.texto(campana)}"> min
            <label class="chk est-sin"><input type="checkbox" data-sin="${seguro.texto(t.id)}"
                   ${propia && valor === null ? 'checked' : ''}> Sin límite</label>
          </td>
          <td>${propia
            ? '<span class="t b">Propia de la campaña</span>'
            : '<span class="t o">Usa la general</span>'}</td>
          <td class="mono">${puedeGeneral
            ? `<input class="fi mono est-min" type="number" min="1" max="480" data-gen="${seguro.texto(t.id)}"
                      value="${seguro.texto(t.limite_minutos ?? '')}" placeholder="∞"
                      title="Vacío = sin límite" aria-label="Duración general"> min`
            : minutos(t.limite_minutos)}</td>
          <td style="text-align:right;white-space:nowrap">
            ${propia ? `<button class="b b-gh b-sm" data-usar-general="${seguro.texto(t.id)}">Usar la general</button>` : ''}
            ${t.activo ? '' : `<button class="b b-teal b-sm" data-est="${seguro.texto(t.id)}" data-act="1">Activar</button>`}
          </td>
        </tr>`;
      }).join('')}</table></div>
      <div class="hint" style="margin-top:8px">Escribe los minutos y se guarda solo. Déjalo vacío para usar la
        duración general${puedeGeneral ? '; la general la cambias en su propia columna' : ''}.</div>`;
  }

  async function guardarDuracion(id, datos, que) {
    const r = await servicio.duracionEstado(id, $e('estBasCampana').value, datos);
    if (!r.ok) { aviso(r.error, 'av-a'); await pintar(); return; }
    await pintar();
    aviso(que, 'av-b');
  }

  $e('estBasCampana')?.addEventListener('change', pintarBasicos);

  $e('tablaBasicos')?.addEventListener('change', async (ev) => {
    const el = ev.target;
    const fila = el.closest('tr');
    const nombre = fila?.querySelector('b')?.textContent || 'El estado';
    const campana = $e('estBasCampana').selectedOptions[0]?.textContent || '';

    if (el.dataset.sin) {
      return el.checked
        ? guardarDuracion(el.dataset.sin, { limite_minutos: null }, `${nombre} no tiene límite en ${campana}.`)
        : guardarDuracion(el.dataset.sin, { usarGeneral: true }, `${nombre} vuelve a la duración general en ${campana}.`);
    }
    if (el.dataset.dur) {
      const v = el.value.trim();
      if (!v) return guardarDuracion(el.dataset.dur, { usarGeneral: true }, `${nombre} vuelve a la duración general en ${campana}.`);
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 480) { aviso('La duración va de 1 a 480 minutos.', 'av-a'); return pintarBasicos(); }
      return guardarDuracion(el.dataset.dur, { limite_minutos: n }, `${nombre} dura ${n} minutos en ${campana}.`);
    }
    if (el.dataset.gen) {
      const v = el.value.trim();
      const n = v ? Number(v) : null;
      if (n !== null && (!Number.isInteger(n) || n < 1 || n > 480)) { aviso('La duración va de 1 a 480 minutos.', 'av-a'); return pintarBasicos(); }
      const r = await servicio.duracionGeneral(el.dataset.gen, n);
      if (!r.ok) { aviso(r.error, 'av-a'); return pintar(); }
      await pintar();
      aviso(`${nombre}: duración general ${n === null ? 'sin límite' : n + ' minutos'}. Aplica en las campañas que no tienen la suya.`, 'av-b');
    }
  });

  $e('tablaBasicos')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-usar-general]');
    if (!b) return;
    const nombre = b.closest('tr')?.querySelector('b')?.textContent || 'El estado';
    const campana = $e('estBasCampana').selectedOptions[0]?.textContent || '';
    guardarDuracion(b.dataset.usarGeneral, { usarGeneral: true }, `${nombre} vuelve a la duración general en ${campana}.`);
  });

  async function crear() {
    const nombre = $e('estNuevo').value.trim();
    if (nombre.length < 3) {
      aviso('Escribe el nombre del estado, al menos tres caracteres.', 'av-a');
      $e('estNuevo').focus();
      return;
    }

    if (!$e('estCampana').value && !confirm(
      `"${nombre}" será un estado básico: lo tendrán todas las campañas y no se podrá eliminar ` +
      'ni desactivar después. ¿Crearlo así?')) return;

    const btn = $e('btnEstCrear');
    btn.disabled = true;
    const minutos = Number($e('estMinutos').value) || null;
    const r = await servicio.crearEstado(nombre, Number($e('estCampana').value) || null, minutos);
    btn.disabled = false;

    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    const destino = $e('estCampana').selectedOptions[0]?.textContent || 'todas las campañas';
    $e('estNuevo').value = '';
    $e('estMinutos').value = '';
    await pintar();
    aviso(`Estado "${nombre}" creado para ${destino.toLowerCase()}` +
          (minutos ? `, con ${minutos} minutos de duración. ` : '. ') +
          'Los agentes lo ven en menos de un minuto.', 'av-b');
  }

  document.addEventListener('click', async (ev) => {
    if (ev.target.closest('#btnEstCrear')) return crear();

    /* Eliminar: desaparece de la lista. El servidor lo rechaza si el
       estado ya tiene pausas registradas. */
    const del = ev.target.closest('[data-borrar]');
    if (del) {
      const fila = del.closest('tr');
      const nombre = fila?.querySelector('b')?.textContent || 'este estado';
      if (!confirm(`¿Eliminar el estado "${nombre}"?\n\n` +
                   'Desaparece de la lista. Si ya se usó alguna vez, el servidor ' +
                   'no lo permitirá y tendrás que desactivarlo.')) return;

      del.disabled = true;
      const r = await servicio.eliminarEstado(del.dataset.borrar);
      if (!r.ok) { aviso(r.error, 'av-a'); del.disabled = false; return; }

      await pintar();
      aviso(`Estado "${nombre}" eliminado.`, 'av-b');
      return;
    }

    const b = ev.target.closest('[data-est]');
    if (!b) return;

    b.disabled = true;
    const activar = b.dataset.act === '1';
    const r = await servicio.activarEstado(b.dataset.est, activar);
    if (!r.ok) { aviso(r.error, 'av-a'); b.disabled = false; return; }

    await pintar();
    aviso(activar ? 'Estado activado.' : 'Estado desactivado. Ya no aparece a los agentes.', 'av-b');
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'estNuevo') crear();
  });

  /* ── Quiénes se pasaron del tiempo ────────────────────────────────
     El cálculo lo hace el servidor, para que todos vean lo mismo sin
     depender del reloj de cada equipo. */

  let revisor = null;

  async function revisarExcedidas() {
    if (!$e('tablaExcedidas')) return;

    let lista;
    try { lista = await servicio.pausasExcedidas(); } catch { return; }

    const caja = $e('tarjetaExcedidas');

    if (!lista.length) {
      caja.style.display = 'none';
      $e('excN').textContent = '0';
      return;
    }

    caja.style.display = '';
    $e('excN').textContent = lista.length;

    const reloj = (s) => {
      const m = Math.floor(s / 60);
      return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
    };

    $e('tablaExcedidas').innerHTML = `<table class="tb">
      <tr><th>Agente</th><th>Ext.</th><th>Campaña</th><th>Estado</th>
          <th>Permitido</th><th>Lleva</th><th>Excedido</th></tr>
      ${lista.map((a) => `<tr>
        <td><b>${seguro.texto(a.nombre)}</b></td>
        <td class="mono">${seguro.celda(a.extension)}</td>
        <td>${seguro.celda(a.campana)}</td>
        <td><span class="t a">${seguro.texto(a.estado)}</span></td>
        <td class="mono">${seguro.texto(a.limite_minutos)} min</td>
        <td class="mono">${reloj(a.segundos)}</td>
        <td class="mono" style="color:var(--danger);font-weight:700">+${reloj(a.excedido)}</td>
      </tr>`).join('')}</table>`;
  }

  /* Solo se consulta mientras la vista está abierta */
  function vigilar(encender) {
    if (revisor) { clearInterval(revisor); revisor = null; }
    if (!encender) return;
    revisarExcedidas();
    revisor = setInterval(() => {
      const v = document.querySelector('.vista.on');
      if (v && v.dataset.v === 'campanas') revisarExcedidas();
      else vigilar(false);
    }, 15000);
  }

  return { abrir, vigilar, revisarExcedidas };
})();
