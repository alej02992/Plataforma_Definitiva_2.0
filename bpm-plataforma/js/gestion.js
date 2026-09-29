/* ═══════════════════════════════════════════════════════════════════
   ESTADOS DE PAUSA · los define el supervisor

   El agente ya no escribe sus propios estados: el supervisor los crea,
   decide si son para todas las campañas o para una sola, y los activa o
   desactiva. Los activos aparecen como botón en el panel de los agentes
   que correspondan, sin que tengan que recargar.

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

  /* El supervisor solo administra sus campañas: su desplegable trae las
     suyas y no incluye "Todas". El servidor lo comprueba igual. */
  async function llenarCampanas() {
    let r = { general: false, campanas: [] };
    try { r = await servicio.campanasDeEstados(); } catch { /* queda vacío */ }

    puedeGeneral = !!r.general;
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

    const mios = lista.filter((t) => t.editable).length;
    $e('estN').textContent = puedeGeneral
      ? `${lista.filter((t) => t.activo).length} activos`
      : `${mios} de tus campañas`;

    if (!lista.length) {
      $e('tablaEstados').innerHTML = '<div class="vacio">Todavía no hay estados creados.</div>';
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
          : `<span class="t o" title="Lo administra el superadministrador">General</span>`}
        </td></tr>`).join('')}</table>`;
  }

  async function crear() {
    const nombre = $e('estNuevo').value.trim();
    if (nombre.length < 3) {
      aviso('Escribe el nombre del estado, al menos tres caracteres.', 'av-a');
      $e('estNuevo').focus();
      return;
    }

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
