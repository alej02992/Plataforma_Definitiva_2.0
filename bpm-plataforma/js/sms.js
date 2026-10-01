/* ═══════════════════════════════════════════════════════════════════
   ENVÍO DE SMS

   Lo ven supervisores y administradores; el supervisor solo trabaja
   sobre sus campañas. El supervisor prepara el mensaje y la lista, y el
   administrador aprueba y envía: miles de mensajes en nombre de la
   empresa no se pueden deshacer.

   El módulo se llama `mensajes` y no `sms` para no chocar con nada en
   la página, y porque el archivo del backend ya se llama sms.js.

   LO QUE MÁS IMPORTA AQUÍ
   Antes de enviar, el supervisor ve el mensaje exacto que va a recibir
   la gente, con sus datos ya reemplazados, y cuántos SMS cuesta cada
   uno. Un texto con tildes o eñes baja el límite de 160 a 70
   caracteres, así que un mensaje aparentemente corto puede cobrarse
   como dos o tres.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const mensajes = (() => {
  const $s = (id) => document.getElementById(id);

  let lista = [];
  let actual = null;
  let filasArchivo = [];

  const ESTADOS = {
    borrador:  ['o', 'Borrador'],
    listo:     ['b', 'Listo'],
    aprobado:  ['g', 'Aprobado'],
    enviando:  ['b', 'Enviando'],
    enviado:   ['g', 'Enviado'],
    cancelado: ['r', 'Cancelado'],
  };

  /** Cuántos SMS se cobran por un texto. Se calcula igual que en el
      servidor para que lo que se muestra coincida con lo que se cobra. */
  function partes(texto) {
    const t = String(texto || '');
    if (!t) return 0;
    const especial = /[^\x00-\x7F]/.test(t);
    const tope = especial ? 70 : 160;
    const porParte = especial ? 67 : 153;
    return t.length <= tope ? 1 : Math.ceil(t.length / porParte);
  }

  /* ═══════════ LISTA ═══════════ */

  async function abrir() {
    await llenarCampanas();
    await pintarLista();
  }

  async function llenarCampanas() {
    let r = { campanas: [] };
    try { r = await servicio.campanasDeEstados(); } catch { /* sin campañas */ }
    $s('smCampana').innerHTML = r.campanas
      .map((c) => `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('')
      || '<option value="">Sin campañas asignadas</option>';
  }

  async function pintarLista() {
    $s('listaSms').innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      lista = await servicio.listarSms();
    } catch (e) {
      $s('listaSms').innerHTML =
        `<div class="vacio">No se pudieron cargar: ${seguro.texto(e.message)}</div>`;
      return;
    }

    if (!lista.length) {
      $s('listaSms').innerHTML =
        '<div class="vacio">Todavía no hay envíos. Pulsa Crear para el primero.</div>';
      return;
    }

    $s('listaSms').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Nombre</th><th>Campaña</th><th>Destinatarios</th>
          <th>Enviados</th><th>Entregados</th><th>Estado</th></tr>
      ${lista.map((s) => {
        const [color, etiqueta] = ESTADOS[s.estado] || ['o', s.estado];
        return `<tr data-sm="${seguro.texto(s.id)}" style="cursor:pointer">
          <td><b>${seguro.texto(s.nombre)}</b></td>
          <td>${seguro.celda(s.campana)}</td>
          <td class="mono">${seguro.texto(s.destinos ?? 0)}</td>
          <td class="mono">${seguro.texto(s.enviados ?? 0)}</td>
          <td class="mono">${seguro.texto(s.entregados ?? 0)}</td>
          <td><span class="t ${color}">${seguro.texto(etiqueta)}</span></td>
        </tr>`;
      }).join('')}</table></div>`;
  }

  $s('listaSms').addEventListener('click', (e) => {
    const fila = e.target.closest('[data-sm]');
    if (fila) abrirEditor(Number(fila.dataset.sm));
  });

  /* ═══════════ EDITOR ═══════════ */

  $s('btnSmNuevo').addEventListener('click', () => {
    actual = null;
    $s('editorSms').style.display = '';
    $s('smTitulo').textContent = 'Nuevo envío';
    $s('smEstado').className = 't o';
    $s('smEstado').textContent = 'Borrador';
    $s('smNombre').value = '';
    $s('smTexto').value = '';
    $s('smRemitente').value = '';
    $s('smCentro').value = '';
    $s('smProgramado').checked = false;
    $s('smFecha').value = '';
    alternarFecha();
    revisarTexto();
    $s('btnSmBorrar').style.display = 'none';
    ['destinosSms', 'envioSms'].forEach((id) => { $s(id).style.display = 'none'; });
    $s('editorSms').querySelectorAll('input, select, textarea')
      .forEach((el) => { el.disabled = false; });
    $s('btnSmGuardar').disabled = false;
    $s('smNombre').focus();
  });

  async function abrirEditor(id) {
    try {
      actual = await servicio.leerSms(id);
    } catch (e) {
      aviso('No se pudo abrir: ' + e.message, 'av-a');
      return;
    }

    $s('editorSms').style.display = '';
    const [color, etiqueta] = ESTADOS[actual.estado] || ['o', actual.estado];
    $s('smTitulo').textContent = actual.nombre;
    $s('smEstado').className = 't ' + color;
    $s('smEstado').textContent = etiqueta;

    $s('smNombre').value = actual.nombre || '';
    $s('smCampana').value = actual.campana_id || '';
    $s('smTexto').value = actual.texto || '';
    $s('smRemitente').value = actual.remitente || '';
    $s('smCentro').value = actual.centro_costo || '';
    $s('smProgramado').checked = actual.envio === 'programado';
    $s('smFecha').value = actual.fecha_envio
      ? String(actual.fecha_envio).slice(0, 16).replace(' ', 'T') : '';
    alternarFecha();
    revisarTexto();
    $s('btnSmBorrar').style.display = '';

    /* Un envío aprobado ya no se edita */
    const bloqueado = ['aprobado', 'enviando', 'enviado', 'cancelado'].includes(actual.estado);
    $s('editorSms').querySelectorAll('input, select, textarea')
      .forEach((el) => { el.disabled = bloqueado; });
    $s('btnSmGuardar').disabled = bloqueado;

    $s('destinosSms').style.display = '';
    await pintarDestinos();
    pintarEnvio();
  }

  /** Avisa cuántos SMS cuesta el texto y qué variables usa. Es lo que
      evita la sorpresa en la factura. */
  function revisarTexto() {
    const t = $s('smTexto').value;
    const n = partes(t);
    const vs = [...new Set([...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];

    const costo = n === 0 ? 'Escribe el mensaje.'
      : n === 1 ? `${t.length} caracteres · se cobra como <b>1 SMS</b>.`
      : `${t.length} caracteres · se cobra como <b>${n} SMS por persona</b>.`;

    const tildes = /[^\x00-\x7F]/.test(t)
      ? ' Lleva tildes o eñes, así que el límite baja de 160 a 70 caracteres.' : '';

    const variables = vs.length
      ? ` Variables: <b>${vs.map(seguro.texto).join('</b>, <b>')}</b>. El archivo debe traer una columna con cada una.`
      : '';

    $s('smInfo').innerHTML = costo + tildes + variables;
  }
  $s('smTexto').addEventListener('input', revisarTexto);

  const alternarFecha = () => {
    $s('smFechaBox').style.display = $s('smProgramado').checked ? '' : 'none';
  };
  $s('smProgramado').addEventListener('change', alternarFecha);

  $s('btnSmGuardar').addEventListener('click', async () => {
    const datos = {
      nombre: $s('smNombre').value.trim(),
      campana_id: Number($s('smCampana').value) || null,
      texto: $s('smTexto').value.trim(),
      remitente: $s('smRemitente').value.trim() || null,
      centro_costo: Number($s('smCentro').value) || null,
      envio: $s('smProgramado').checked ? 'programado' : 'ahora',
      fecha_envio: $s('smProgramado').checked ? $s('smFecha').value : null,
    };

    if (datos.envio === 'programado' && !datos.fecha_envio) {
      aviso('Elige la fecha y hora del envío.', 'av-a');
      return;
    }

    const btn = $s('btnSmGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      if (actual) {
        await servicio.guardarSms(actual.id, datos);
        aviso('Envío guardado.', 'av-b');
        await pintarLista();
        await abrirEditor(actual.id);
      } else {
        const r = await servicio.crearSms(datos);
        aviso('Envío creado. Ahora carga la lista de destinatarios.', 'av-b');
        await pintarLista();
        await abrirEditor(r.id);
      }
    } catch (e) {
      aviso(e.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  });

  $s('btnSmCancelar').addEventListener('click', () => {
    actual = null;
    ['editorSms', 'destinosSms', 'envioSms'].forEach((id) => { $s(id).style.display = 'none'; });
  });

  $s('btnSmBorrar').addEventListener('click', async () => {
    if (!actual) return;
    if (!confirm(`¿Eliminar el envío "${actual.nombre}"?\n\nSe borra también su lista.`)) return;
    try {
      await servicio.eliminarSms(actual.id);
      actual = null;
      ['editorSms', 'destinosSms', 'envioSms'].forEach((id) => { $s(id).style.display = 'none'; });
      await pintarLista();
      aviso('Envío eliminado.', 'av-b');
    } catch (e) { aviso(e.message, 'av-a'); }
  });

  /* ═══════════ DESTINATARIOS ═══════════ */

  function leerCsv(texto) {
    const limpio = texto.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!limpio) return { error: 'El archivo está vacío' };

    const lineas = limpio.split('\n').filter((l) => l.trim());
    const sep = (lineas[0].match(/;/g) || []).length >= (lineas[0].match(/,/g) || []).length ? ';' : ',';

    const partir = (linea) => {
      const celdas = []; let txt = ''; let comillas = false;
      for (let i = 0; i < linea.length; i++) {
        const c = linea[i];
        if (c === '"') {
          if (comillas && linea[i + 1] === '"') { txt += '"'; i++; }
          else comillas = !comillas;
        } else if (c === sep && !comillas) { celdas.push(txt); txt = ''; }
        else txt += c;
      }
      celdas.push(txt);
      return celdas.map((x) => x.trim());
    };

    const cabecera = partir(lineas[0]).map((h) =>
      h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

    if (!cabecera.includes('numero') && !cabecera.includes('telefono')) {
      return { error: 'Al archivo le falta la columna "numero". Descarga la plantilla.' };
    }

    const filas = lineas.slice(1).map((l) => {
      const celdas = partir(l);
      const fila = {};
      cabecera.forEach((col, i) => { fila[col] = celdas[i] || ''; });
      return fila;
    }).filter((f) => f.numero || f.telefono);

    return filas.length ? { filas } : { error: 'El archivo no tiene filas con datos' };
  }

  const avisoCaja = (clase, texto) => `<div class="aviso ${clase}" style="margin:0 0 10px">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    <div>${seguro.texto(texto)}</div></div>`;

  $s('smArchivo').addEventListener('change', async (e) => {
    const archivo = e.target.files?.[0];
    if (!archivo || !actual) return;
    e.target.value = '';

    const { filas, error } = leerCsv(await archivo.text());
    if (error) {
      filasArchivo = [];
      $s('btnSmCargar').style.display = 'none';
      $s('smRevision').innerHTML = avisoCaja('av-r', error);
      return;
    }

    $s('smRevision').innerHTML = `<div class="vacio">Revisando ${filas.length} filas…</div>`;
    try {
      const r = await servicio.revisarDestinosSms(actual.id, filas);
      filasArchivo = filas;
      pintarRevision(r);
    } catch (err) {
      $s('smRevision').innerHTML = avisoCaja('av-r', err.message);
    }
  });

  function pintarRevision(r) {
    $s('btnSmCargar').style.display = r.correctas ? '' : 'none';
    $s('btnSmCargar').textContent = `Cargar ${r.correctas} destinatario(s)`;

    /* El costo total es lo primero que se quiere saber */
    const totalSms = (r.muestra || []).length
      ? r.correctas * (r.muestra[0].partes || 1) : 0;

    const costo = totalSms
      ? avisoCaja('av-b', `${r.correctas} destinatarios · aproximadamente ${totalSms} SMS en total.`)
      : '';

    const muestra = (r.muestra || []).length
      ? `<div class="campos-fijos" style="margin-bottom:10px">
           <div class="cf-tit">Así lo recibirán</div>
           ${r.muestra.map((m) => `<div class="cf-item" style="margin-bottom:6px">
             <b>${seguro.texto(m.numero)}</b>
             <span>${seguro.texto(m.texto)}</span>
             <span class="cf-op">${seguro.texto(m.partes)} SMS</span></div>`).join('')}
         </div>` : '';

    const resumen = r.conError
      ? avisoCaja('av-a', `${r.correctas} fila(s) listas y ${r.conError} con problemas. ` +
          'Solo se cargarán las correctas.')
      : avisoCaja('av-b', `Las ${r.correctas} filas están correctas.`);

    $s('smRevision').innerHTML = resumen + costo + muestra + `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Línea</th><th>Celular</th><th>Nombre</th><th>Revisión</th></tr>
      ${r.filas.map((f) => `<tr${f.errores.length ? ' style="background:var(--danger-l)"' : ''}>
        <td class="mono">${seguro.texto(f.linea)}</td>
        <td class="mono">${seguro.celda(f.numero)}</td>
        <td>${seguro.celda(f.nombre)}</td>
        <td>${f.errores.length
          ? `<span class="mas-error">${seguro.texto(f.errores.join('. '))}</span>`
          : '<span class="mas-ok">Lista</span>'}</td>
      </tr>`).join('')}</table></div>`;
  }

  $s('btnSmCargar').addEventListener('click', async () => {
    if (!actual || !filasArchivo.length) return;
    const btn = $s('btnSmCargar');
    btn.disabled = true; btn.textContent = 'Cargando…';
    try {
      const r = await servicio.cargarDestinosSms(actual.id, filasArchivo);
      filasArchivo = [];
      btn.style.display = 'none';
      await pintarDestinos();
      await pintarLista();
      pintarEnvio();
      aviso(`${r.cargados} destinatarios cargados.`, 'av-b');
    } catch (e) {
      aviso(e.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Cargar la lista';
    }
  });

  async function pintarDestinos() {
    if (!actual) return;
    let filas = [];
    try { filas = await servicio.listarDestinosSms(actual.id); } catch { /* ninguno */ }

    $s('smDestN').textContent = filas.length;
    if (!filas.length) {
      $s('smRevision').innerHTML = '<div class="vacio">Todavía no hay destinatarios.</div>';
      return;
    }

    const color = { entregado: 'g', enviado: 'b', fallido: 'r', pendiente: 'o' };

    $s('smRevision').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Celular</th><th>Nombre</th><th>Mensaje</th><th>Estado</th></tr>
      ${filas.slice(0, 200).map((f) => `<tr>
        <td class="mono">${seguro.texto(f.numero)}</td>
        <td>${seguro.celda(f.nombre)}</td>
        <td style="font-size:11.5px">${seguro.texto(String(f.texto_final || '').slice(0, 70))}</td>
        <td><span class="t ${color[f.estado] || 'o'}">${seguro.texto(f.estado)}</span>
            ${f.error ? `<br><span class="mas-error">${seguro.texto(f.error)}</span>` : ''}</td>
      </tr>`).join('')}</table>
      ${filas.length > 200 ? `<div class="hint">Se muestran los primeros 200 de ${filas.length}.</div>` : ''}
      </div>`;
  }

  $s('btnSmPlantilla').addEventListener('click', () => {
    const vs = [...new Set([...$s('smTexto').value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
    const cols = [...new Set(['numero', 'nombre', ...vs])];
    const ejemplo = [
      cols.join(';'),
      cols.map((c) => c === 'numero' ? '3102879726' : c === 'nombre' ? 'Juan Pérez' : 'valor').join(';'),
    ].join('\r\n');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + ejemplo], { type: 'text/csv;charset=utf-8' }));
    a.download = 'destinatarios_sms.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });

  /* ═══════════ APROBAR Y ENVIAR ═══════════ */

  function pintarEnvio() {
    if (!actual) return;
    $s('envioSms').style.display = '';

    const puede = (ui.sesion?.permisos || []).includes('sms_aprobar');
    const estado = actual.estado;
    let cuerpo = '';

    if (estado === 'borrador' || estado === 'listo') {
      cuerpo = puede
        ? avisoCaja('av-a', 'Revisa el mensaje y la lista antes de aprobar. ' +
            'Una vez enviado no se puede deshacer.') +
          '<div class="ctrls"><button class="b b-teal" data-sm-estado="aprobado">Aprobar</button></div>'
        : avisoCaja('av-b', 'Preparado. Un administrador debe aprobarlo para que salga.');
    } else if (estado === 'aprobado') {
      cuerpo = avisoCaja('av-b', 'Aprobado y listo para salir.') +
        (puede ? `<div class="ctrls">
          <button class="b b-teal" id="btnSmEnviar">Enviar ahora</button>
          <button class="b b-red b-sm" data-sm-estado="cancelado">Cancelar</button></div>` : '');
    } else if (estado === 'enviado') {
      cuerpo = avisoCaja('av-b', 'Enviado. Abajo puedes ver quién lo recibió.');
    } else {
      cuerpo = avisoCaja('av-a', `Este envío está ${estado}.`);
    }

    $s('smEnvio').innerHTML = cuerpo;
  }

  $s('smEnvio').addEventListener('click', async (e) => {
    if (!actual) return;

    const cambio = e.target.closest('[data-sm-estado]');
    if (cambio) {
      const destino = cambio.dataset.smEstado;
      if (destino === 'aprobado' &&
          !confirm(`¿Aprobar "${actual.nombre}"?\n\nQuedará listo para enviarse a todos los destinatarios.`)) return;
      if (destino === 'cancelado' && !confirm('¿Cancelar el envío?')) return;

      cambio.disabled = true;
      try {
        await servicio.cambiarEstadoSms(actual.id, destino);
        await pintarLista();
        await abrirEditor(actual.id);
      } catch (err) {
        aviso(err.message, 'av-a');
        cambio.disabled = false;
      }
      return;
    }

    if (e.target.closest('#btnSmEnviar')) {
      const n = $s('smDestN').textContent;
      if (!confirm(`¿Enviar ahora a ${n} destinatarios?\n\nEsta acción no se puede deshacer.`)) return;

      const btn = $s('btnSmEnviar');
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const r = await servicio.enviarSms(actual.id);
        await pintarLista();
        await abrirEditor(actual.id);
        aviso(r.fallos?.length
          ? `${r.enviados} de ${r.total} enviados. ${r.pendientes} quedaron pendientes.`
          : `${r.enviados} mensajes enviados.`, r.fallos?.length ? 'av-a' : 'av-b');
      } catch (err) {
        aviso(err.message, 'av-a');
        btn.disabled = false; btn.textContent = 'Enviar ahora';
      }
    }
  });

  return { abrir };
})();
