/* ═══════════════════════════════════════════════════════════════════
   TRONCALES

   Una troncal es el enlace con el operador telefónico. Por ahí salen y
   entran las llamadas hacia la calle.

   Esta vista SOLO CONSULTA. Las troncales viven en la configuración de
   la central y por ellas pasan todas las llamadas de la operación:
   modificarlas desde aquí, sin haberlo probado, podría dejar a la
   empresa sin servicio telefónico.

   LO QUE DE VERDAD IMPORTA MIRAR
   No es que la troncal exista, sino que su REGISTRO esté aceptado por
   el operador. Una troncal puede estar configurada y con el registro
   rechazado: las salientes siguen funcionando si el operador autoriza
   por dirección IP, pero las entrantes no llegan. Es el fallo que más
   cuesta encontrar al montar un número de entrada.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const troncales = (() => {
  const $k = (id) => document.getElementById(id);

  async function abrir() {
    if (!$k('trkLista')) return;
    await consultar();
    await cargarPropias();
  }

  async function consultar() {
    const btn = $k('btnTrkRefrescar');
    if (btn) { btn.disabled = true; btn.textContent = 'Consultando…'; }

    try {
      const r = await servicio.listarTroncales();
      pintar(r);
    } catch (e) {
      $k('trkTag').className = 't r';
      $k('trkTag').textContent = 'Sin conexión';
      $k('trkLista').innerHTML =
        `<div class="vacio">No se pudo consultar la central: ${seguro.texto(e.message)}</div>`;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Actualizar'; }
    }
  }

  $k('btnTrkRefrescar')?.addEventListener('click', consultar);

  function pintar(r) {
    const lista = r.troncales || [];
    const res = r.resumen || {};

    $k('trkTag').className = 't ' + (res.conProblema ? 'a' : lista.length ? 'g' : 'o');
    $k('trkTag').textContent = lista.length
      ? `${res.registradas || 0} de ${lista.length} registradas`
      : 'Ninguna';

    if (!lista.length) {
      $k('trkLista').innerHTML =
        '<div class="vacio">La central no tiene troncales configuradas.</div>';
      return;
    }

    $k('trkLista').innerHTML = lista.map((t) => {
      /* Tres estados posibles, y conviene distinguirlos bien:
         registrada, rechazada, o sin registro configurado —esta última
         es normal cuando el operador autoriza por dirección IP. */
      const sinRegistro = !t.registro;
      const tono = t.registrada ? 'ok' : sinRegistro ? 'neutro' : 'mal';

      return `
      <div class="trk ${tono}">
        <div class="trk-bd">
          <b>${seguro.texto(t.nombre)}</b>
          ${t.servidor ? `<span class="mono">${seguro.texto(t.servidor)}</span>` : ''}
          <span>${seguro.texto(t.estado)}</span>
        </div>
        <div class="trk-est">
          <span class="t ${t.registrada ? 'g' : sinRegistro ? 'o' : 'r'}">${
            t.registrada ? 'Registrada'
              : sinRegistro ? 'Sin registro'
              : 'Registro rechazado'}</span>
          ${t.registro && !t.registrada
            ? `<span class="trk-det">${seguro.texto(t.registro)}</span>` : ''}
        </div>
      </div>

      ${!t.registrada && !sinRegistro ? `
        <div class="aviso av-a" style="margin:-4px 0 10px">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          <div>El operador no está aceptando el registro de esta troncal. Las llamadas
            salientes pueden seguir funcionando si autoriza por dirección IP, pero
            <b>las entrantes probablemente no lleguen</b>. Conviene consultarlo con el
            operador antes de dar de alta un número de entrada.</div>
        </div>` : ''}`;
    }).join('');
  }

  /* ═══════════ LAS QUE ADMINISTRA LA PLATAFORMA ═══════════ */

  let editando = null;

  async function cargarPropias() {
    if (!$k('trkPropias')) return;

    let lista = [];
    try { lista = await servicio.listarTroncalesPropias(); }
    catch (e) {
      $k('trkPropias').innerHTML = `<div class="vacio">${seguro.texto(e.message)}</div>`;
      return;
    }

    if (!lista.length) {
      $k('trkPropias').innerHTML =
        '<div class="vacio">Todavía no has creado ninguna troncal desde la plataforma.</div>';
      return;
    }

    $k('trkPropias').innerHTML = lista.map((t) => {
      const activa = t.estado === 'activa';
      return `
      <div class="trk ${activa ? 'ok' : 'neutro'}">
        <div class="trk-bd">
          <b>${seguro.texto(t.nombre)}</b>
          <span class="mono">${seguro.texto(t.servidor)}:${seguro.texto(t.puerto)}</span>
          <span>${seguro.texto(t.descripcion || 'Sin descripción')}${
            t.registra ? ' · con registro' : ' · autorizada por IP'}</span>
        </div>
        <div class="trk-est">
          <span class="t ${activa ? 'g' : 'o'}">${
            activa ? 'En servicio' : t.estado === 'borrador' ? 'Borrador' : 'Inactiva'}</span>
          <div class="ctrls" style="margin:4px 0 0">
            <button class="b b-sm ${activa ? 'b-gh' : 'b-teal'}"
                    data-estado="${seguro.texto(t.id)}"
                    data-a="${activa ? 'inactiva' : 'activa'}">${
              activa ? 'Desactivar' : 'Activar'}</button>
            ${activa ? '' : `
              <button class="b b-gh b-sm" data-editar="${seguro.texto(t.id)}">Editar</button>
              <button class="b b-red b-sm" data-borrar="${seguro.texto(t.id)}">Eliminar</button>`}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  /* ── Abrir el formulario ── */

  function abrirEditor(t) {
    editando = t;
    $k('trkTitulo').textContent = t ? `Editar ${t.nombre}` : 'Nueva troncal';
    $k('trkEditor').style.display = '';

    $k('trkNombre').value = t?.nombre || '';
    $k('trkNombre').disabled = !!t;          // el nombre no se cambia: es su identidad
    $k('trkDesc').value = t?.descripcion || '';
    $k('trkServidor').value = t?.servidor || '';
    $k('trkPuerto').value = t?.puerto || 5060;
    $k('trkRegistra').checked = t ? !!t.registra : true;
    $k('trkUsuario').value = t?.usuario || '';
    $k('trkClave').value = '';
    $k('trkContexto').value = t?.contexto || 'from-pstn';
    $k('trkCid').value = t?.identificador || '';
    $k('trkCodecs').value = t?.codecs || 'ulaw,alaw';
    $k('trkErr').innerHTML = '';
    $k('trkClaveHint').textContent = t
      ? 'Déjala vacía para no cambiarla.'
      : 'La que entrega el operador.';

    /* Llevar la vista al formulario, si el navegador lo admite */
    $k('trkEditor').scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  $k('btnTrkNueva')?.addEventListener('click', () => abrirEditor(null));
  $k('btnTrkCancelar')?.addEventListener('click', () => {
    $k('trkEditor').style.display = 'none';
    editando = null;
  });

  /* ── Guardar ── */

  $k('btnTrkGuardar')?.addEventListener('click', async () => {
    const datos = {
      nombre: $k('trkNombre').value.trim().toLowerCase(),
      descripcion: $k('trkDesc').value.trim(),
      servidor: $k('trkServidor').value.trim(),
      puerto: Number($k('trkPuerto').value) || 5060,
      usuario: $k('trkUsuario').value.trim(),
      clave: $k('trkClave').value,
      registra: $k('trkRegistra').checked,
      contexto: $k('trkContexto').value.trim(),
      identificador: $k('trkCid').value.trim(),
      codecs: $k('trkCodecs').value.trim(),
    };

    const btn = $k('btnTrkGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    $k('trkErr').innerHTML = '';

    try {
      if (editando) await servicio.guardarTroncal(editando.id, datos);
      else await servicio.crearTroncal(datos);

      aviso(editando ? 'Troncal actualizada.' : 'Troncal creada como borrador.', 'av-b');
      $k('trkEditor').style.display = 'none';
      editando = null;
      await cargarPropias();
    } catch (e) {
      /* El error se muestra en el formulario, donde está mirando la
         persona, y no como aviso que desaparece a los seis segundos. */
      $k('trkErr').innerHTML =
        `<div class="aviso av-r"><div>${seguro.texto(e.message)}</div></div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  });

  /* ── Activar, editar, eliminar ── */

  $k('trkPropias')?.addEventListener('click', async (e) => {
    const bEstado = e.target.closest('[data-estado]');
    const bEditar = e.target.closest('[data-editar]');
    const bBorrar = e.target.closest('[data-borrar]');

    if (bEditar) {
      const lista = await servicio.listarTroncalesPropias();
      abrirEditor(lista.find((x) => String(x.id) === bEditar.dataset.editar));
      return;
    }

    if (bBorrar) {
      if (!confirm('¿Eliminar esta troncal? Su configuración se pierde.')) return;
      try {
        await servicio.eliminarTroncal(bBorrar.dataset.borrar);
        aviso('Troncal eliminada.', 'av-b');
        await cargarPropias();
      } catch (err) { aviso(err.message, 'av-a'); }
      return;
    }

    if (!bEstado) return;

    const activar = bEstado.dataset.a === 'activa';

    /* Activar toca la central: conviene preguntar. Desactivar también,
       porque corta las llamadas que pasen por ahí. */
    if (!confirm(activar
      ? '¿Poner esta troncal en servicio?\n\nSe escribirá en la central y quedará activa.'
      : '¿Sacarla de servicio?\n\nLas llamadas que pasen por esta troncal dejarán de funcionar.')) return;

    bEstado.disabled = true;
    try {
      const r = await servicio.estadoTroncal(bEstado.dataset.estado, bEstado.dataset.a);
      aviso(r.aviso || (activar ? 'Troncal en servicio.' : 'Troncal fuera de servicio.'),
            r.aviso ? 'av-a' : 'av-b');
      await cargarPropias();
      await consultar();                  // la lista de la central también cambia
    } catch (err) {
      aviso(err.message, 'av-a');
      bEstado.disabled = false;
    }
  });

  return { abrir };
})();