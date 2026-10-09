/* ═══════════════════════════════════════════════════════════════════
   TIPIFICADOR

   El administrador define, por campaña, cómo cierra el agente cada
   gestión. Una campaña de atención al ciudadano no se cierra igual que
   una de cobranza, y forzar una lista única lleva a que los agentes
   elijan lo que menos mal les suene.

   DOS NIVELES
   Categoría es el resultado general; subcategoría, el detalle. El
   agente elige la primera y la segunda se filtra sola.

   LA ACCIÓN
   Es lo que distingue esto de una simple lista: cada tipificación dice
   qué hace el sistema con el contacto. Reintentar, usar el otro
   teléfono, agendar o no volver a llamar. El agente tipifica una vez y
   no tiene que pulsar nada más.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const tipificador = (() => {
  const $t = (id) => document.getElementById(id);

  let lista = [];
  let acciones = {};

  /* ═══════════ ABRIR ═══════════ */

  async function abrir() {
    await llenarCampanas();
    await cargar();
  }

  async function llenarCampanas() {
    let r = { campanas: [] };
    try { r = await servicio.campanasDeEstados(); } catch { /* sin campañas */ }

    $t('tpCampana').innerHTML =
      '<option value="">Generales (todas las campañas)</option>' +
      r.campanas.map((c) =>
        `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('');
  }

  async function cargar() {
    try {
      const r = await servicio.leerTipificador($t('tpCampana').value);
      lista = r.tipificaciones || [];
      acciones = r.acciones || {};
    } catch (e) {
      aviso('No se pudo cargar: ' + e.message, 'av-a');
      lista = [];
    }
    pintar();
  }

  $t('tpCampana').addEventListener('change', cargar);

  /* ═══════════ LA LISTA ═══════════ */

  function pintar() {
    $t('tpTag').className = 't ' + (lista.length ? 'g' : 'o');
    $t('tpTag').textContent = lista.length ? `${lista.length} opciones` : 'Sin definir';

    if (!lista.length) {
      $t('tpLista').innerHTML =
        '<div class="vacio">Esta campaña no tiene tipificaciones propias: ' +
        'sus agentes usan las generales. Agrega las suyas con el botón de arriba.</div>';
      return;
    }

    const opcionesAccion = (sel) => Object.keys(acciones).map((a) =>
      `<option value="${a}"${a === sel ? ' selected' : ''}>${seguro.texto(etiquetaAccion(a))}</option>`
    ).join('');

    $t('tpLista').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Categoría</th><th>Subcategoría</th><th>Acción</th>
          <th title="Cuenta como gestión lograda en los reportes">Efectiva</th><th></th></tr>
      ${lista.map((t, i) => `<tr${t.activa === false ? ' style="opacity:.5"' : ''}>
        <td><input class="fi" data-campo="categoria" data-i="${i}"
                   value="${seguro.texto(t.categoria || '')}" placeholder="Resultado general"></td>
        <td><input class="fi" data-campo="subcategoria" data-i="${i}"
                   value="${seguro.texto(t.subcategoria || '')}" placeholder="Detalle (opcional)"></td>
        <td><select class="fi" data-campo="accion" data-i="${i}">
              ${opcionesAccion(t.accion || 'cerrar')}</select></td>
        <td style="text-align:center">
          <input type="checkbox" data-campo="efectiva" data-i="${i}"
                 ${t.efectiva ? 'checked' : ''}></td>
        <td style="text-align:right">
          <button class="b b-red b-sm" data-quitar="${i}">Quitar</button></td>
      </tr>
      <tr><td colspan="5" class="hint" style="padding-top:0;border:0">
        ${seguro.texto(acciones[t.accion || 'cerrar'] || '')}</td></tr>`).join('')}
      </table></div>`;
  }

  const etiquetaAccion = (a) => ({
    cerrar: 'Cerrar la gestión',
    reintentar: 'Reintentar más tarde',
    otro_telefono: 'Probar el otro teléfono',
    agendar: 'Agendar llamada',
    no_llamar: 'No volver a llamar',
  }[a] || a);

  /* Los cambios se guardan en memoria según se escriben, y se mandan
     todos juntos al pulsar Guardar. */
  $t('tpLista').addEventListener('input', (e) => {
    const el = e.target.closest('[data-campo]');
    if (!el) return;
    const i = Number(el.dataset.i);
    if (!lista[i]) return;

    lista[i][el.dataset.campo] = el.type === 'checkbox' ? el.checked : el.value;
  });

  $t('tpLista').addEventListener('change', (e) => {
    const el = e.target.closest('[data-campo]');
    if (!el) return;
    const i = Number(el.dataset.i);
    if (!lista[i]) return;

    lista[i][el.dataset.campo] = el.type === 'checkbox' ? el.checked : el.value;
    /* La acción cambia el texto explicativo de abajo */
    if (el.dataset.campo === 'accion') pintar();
  });

  $t('tpLista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-quitar]');
    if (!b) return;
    lista.splice(Number(b.dataset.quitar), 1);
    pintar();
  });

  $t('btnTpAgregar').addEventListener('click', () => {
    lista.push({ id: null, categoria: '', subcategoria: '', accion: 'cerrar',
                 efectiva: true, activa: true });
    pintar();
    /* El foco va al campo nuevo: se agregan varias seguidas */
    const campos = $t('tpLista').querySelectorAll('[data-campo="categoria"]');
    campos[campos.length - 1]?.focus();
  });

  /* ═══════════ GUARDAR ═══════════ */

  $t('btnTpGuardar').addEventListener('click', async () => {
    const vacias = lista.filter((t) => !String(t.categoria || '').trim());
    if (vacias.length) {
      aviso('Hay tipificaciones sin categoría. Complétalas o quítalas.', 'av-a');
      return;
    }
    if (!lista.length) {
      aviso('Define al menos una tipificación.', 'av-a');
      return;
    }

    const btn = $t('btnTpGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await servicio.guardarTipificador($t('tpCampana').value, lista);

      /* Lo que ya se usó no se borra: se desactiva, para que los
         reportes viejos sigan mostrando con qué se cerró cada
         gestión. Conviene decirlo. */
      aviso(r.desactivadas
        ? `Guardado. ${r.desactivadas} tipificación(es) quedaron desactivadas porque ya se usaron.`
        : 'Tipificaciones guardadas.', 'av-b');

      await cargar();
    } catch (e) {
      aviso(e.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  });

  /* ═══════════ LAS DOS PESTAÑAS ═══════════ */

  document.getElementById('disTabs')?.addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;

    document.querySelectorAll('#disTabs .tab')
      .forEach((x) => x.classList.toggle('on', x === t));

    const esTip = t.dataset.d === 'tipificador';
    $t('panelTipificador').style.display = esTip ? '' : 'none';
    $t('panelFormularios').style.display = esTip ? 'none' : '';

    if (esTip && !lista.length) abrir();
  });

  return { abrir };
})();
