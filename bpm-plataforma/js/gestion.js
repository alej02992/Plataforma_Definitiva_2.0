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
  }

  async function llenarCampanas() {
    let cs = [];
    try { cs = await servicio.listarCampanas(); } catch { /* queda solo "todas" */ }
    $e('estCampana').innerHTML = '<option value="">Todas las campañas</option>' +
      cs.map((c) => `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('');
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

    $e('estN').textContent = `${lista.filter((t) => t.activo).length} activos`;

    if (!lista.length) {
      $e('tablaEstados').innerHTML = '<div class="vacio">Todavía no hay estados creados.</div>';
      return;
    }

    $e('tablaEstados').innerHTML = `<table class="tb">
      <tr><th>Estado</th><th>Campaña</th><th>Situación</th><th></th></tr>
      ${lista.map((t) => `<tr>
        <td><b>${seguro.texto(t.nombre)}</b></td>
        <td>${t.campana_id ? seguro.texto(t.campana) : 'Todas'}</td>
        <td><span class="t ${t.activo ? 'g' : 'o'}">${t.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td style="text-align:right">
          <button class="b ${t.activo ? 'b-gh' : 'b-teal'} b-sm"
                  data-est="${seguro.texto(t.id)}" data-act="${t.activo ? 0 : 1}">
            ${t.activo ? 'Desactivar' : 'Activar'}</button>
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
    const r = await servicio.crearEstado(nombre, Number($e('estCampana').value) || null);
    btn.disabled = false;

    if (!r.ok) { aviso(r.error, 'av-a'); return; }

    const destino = $e('estCampana').selectedOptions[0]?.textContent || 'todas las campañas';
    $e('estNuevo').value = '';
    await pintar();
    aviso(`Estado "${nombre}" creado para ${destino.toLowerCase()}. ` +
          'Los agentes lo ven en menos de un minuto.', 'av-b');
  }

  document.addEventListener('click', async (ev) => {
    if (ev.target.closest('#btnEstCrear')) return crear();

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

  return { abrir };
})();
