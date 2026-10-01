/* ═══════════════════════════════════════════════════════════════════
   BLASTER DE VOZ

   Llamar a una lista de personas y reproducir un mensaje. Lo ven
   supervisores y administradores; el supervisor solo trabaja sobre sus
   campañas.

   TRES TIPOS DE MENSAJE
   texto      el mismo para todos, leído por voz sintética
   variables  personalizado con los datos de cada contacto, {nombre}
   audio      una grabación hecha por una persona

   Los tres pueden pedirle algo al cliente: marcar una tecla o digitar
   un número. Lo que marque queda guardado.

   QUIÉN HACE QUÉ
   El supervisor prepara el blaster y carga la lista. Solo el
   administrador lo aprueba y lo lanza: son cientos de llamadas en
   nombre de la empresa y no se pueden deshacer.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const blaster = (() => {
  const $b = (id) => document.getElementById(id);

  let lista = [];
  let actual = null;        // el blaster abierto en el editor
  let tipo = 'texto';
  let respTipo = 'tecla';
  let filasArchivo = [];

  const AYUDA_TIPO = {
    texto: 'El mismo mensaje para todos, leído por voz sintética.',
    variables: 'Personalizado con los datos de cada contacto. Escribe las variables entre llaves: {nombre}, {valor}.',
    audio: 'Una grabación hecha por una persona. Suena mejor, pero es igual para todos.',
  };

  const ESTADOS = {
    borrador:  ['o', 'Borrador'],
    listo:     ['b', 'Listo'],
    aprobado:  ['g', 'Aprobado'],
    activo:    ['g', 'En curso'],
    pausado:   ['a', 'Pausado'],
    terminado: ['o', 'Terminado'],
    cancelado: ['r', 'Cancelado'],
  };

  /* ═══════════ LISTA ═══════════ */

  async function abrir() {
    await llenarCampanas();
    await pintarLista();
  }

  async function llenarCampanas() {
    let r = { campanas: [] };
    try { r = await servicio.campanasDeEstados(); } catch { /* sin campañas */ }
    $b('blCampana').innerHTML = r.campanas
      .map((c) => `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('')
      || '<option value="">Sin campañas asignadas</option>';
  }

  async function pintarLista() {
    $b('listaBlasters').innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      lista = await servicio.listarBlasters();
    } catch (e) {
      $b('listaBlasters').innerHTML =
        `<div class="vacio">No se pudieron cargar: ${seguro.texto(e.message)}</div>`;
      return;
    }

    if (!lista.length) {
      $b('listaBlasters').innerHTML =
        '<div class="vacio">Todavía no hay blasters. Pulsa Crear para el primero.</div>';
      return;
    }

    $b('listaBlasters').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Nombre</th><th>Campaña</th><th>Tipo</th><th>Destinatarios</th>
          <th>Respuestas</th><th>Estado</th></tr>
      ${lista.map((b) => {
        const [color, etiqueta] = ESTADOS[b.estado] || ['o', b.estado];
        return `<tr data-bl="${seguro.texto(b.id)}" style="cursor:pointer">
          <td><b>${seguro.texto(b.nombre)}</b></td>
          <td>${seguro.celda(b.campana)}</td>
          <td>${seguro.texto(etiquetaTipo(b.tipo))}</td>
          <td class="mono">${seguro.texto(b.destinos ?? 0)}</td>
          <td class="mono">${seguro.texto(b.respuestas ?? 0)}</td>
          <td><span class="t ${color}">${seguro.texto(etiqueta)}</span></td>
        </tr>`;
      }).join('')}</table></div>`;
  }

  const etiquetaTipo = (t) => ({ texto: 'Texto a voz', variables: 'Con variables',
                                 audio: 'Audio grabado' }[t] || t);

  $b('listaBlasters').addEventListener('click', (e) => {
    const fila = e.target.closest('[data-bl]');
    if (fila) abrirEditor(Number(fila.dataset.bl));
  });

  /* ═══════════ EDITOR ═══════════ */

  $b('btnBlNuevo').addEventListener('click', () => {
    actual = null;
    mostrar(true);
    $b('blTitulo').textContent = 'Nuevo blaster';
    $b('blEstado').textContent = 'Borrador';
    $b('blNombre').value = '';
    $b('blGuion').value = '';
    $b('blAudio').value = '';
    $b('blVoz').value = '';
    $b('blPideRespuesta').checked = false;
    $b('blRespGuion').value = '';
    $b('blTeclas').value = '1,2';
    $b('blDigitos').value = '10';
    $b('blDesde').value = '08:00';
    $b('blHasta').value = '19:00';
    $b('blDias').value = 'L,M,X,J,V';
    $b('blReintentos').value = '2';
    elegirTipo('texto');
    elegirRespTipo('tecla');
    alternarRespuesta();
    $b('btnBlBorrar').style.display = 'none';
    /* Hasta que no exista, no se puede cargar lista ni aprobar */
    $b('destinosBlaster').style.display = 'none';
    $b('aprobarBlaster').style.display = 'none';
    $b('respuestasBlaster').style.display = 'none';
    $b('blNombre').focus();
  });

  function mostrar(abierto) {
    $b('editorBlaster').style.display = abierto ? '' : 'none';
  }

  async function abrirEditor(id) {
    try {
      actual = await servicio.leerBlaster(id);
    } catch (e) {
      aviso('No se pudo abrir: ' + e.message, 'av-a');
      return;
    }

    mostrar(true);
    const [color, etiqueta] = ESTADOS[actual.estado] || ['o', actual.estado];
    $b('blTitulo').textContent = actual.nombre;
    $b('blEstado').className = 't ' + color;
    $b('blEstado').textContent = etiqueta;

    $b('blNombre').value = actual.nombre || '';
    $b('blCampana').value = actual.campana_id || '';
    $b('blGuion').value = actual.guion || '';
    $b('blAudio').value = actual.audio_archivo || '';
    $b('blVoz').value = actual.voz_id || '';
    $b('blPideRespuesta').checked = !!actual.respuesta;
    $b('blRespGuion').value = actual.respuesta_guion || '';
    $b('blTeclas').value = actual.respuesta_opciones || '1,2';
    $b('blDigitos').value = actual.respuesta_digitos || 10;
    $b('blDesde').value = (actual.hora_inicio || '08:00').slice(0, 5);
    $b('blHasta').value = (actual.hora_fin || '19:00').slice(0, 5);
    $b('blDias').value = actual.dias || 'L,M,X,J,V';
    $b('blReintentos').value = actual.reintentos ?? 2;

    elegirTipo(actual.tipo);
    elegirRespTipo(actual.respuesta_tipo || 'tecla');
    alternarRespuesta();
    $b('btnBlBorrar').style.display = '';

    /* Un blaster ya aprobado no se edita: se detiene primero */
    const bloqueado = ['aprobado', 'activo', 'terminado', 'cancelado'].includes(actual.estado);
    $b('editorBlaster').querySelectorAll('input, select, textarea, .tab')
      .forEach((el) => { el.disabled = bloqueado; });
    $b('btnBlGuardar').disabled = bloqueado;

    $b('destinosBlaster').style.display = '';
    await pintarDestinos();
    pintarAprobacion();
    await pintarRespuestas();
  }

  /* ── Tipo de mensaje ── */

  function elegirTipo(t) {
    tipo = t;
    document.querySelectorAll('#blTipo .tab')
      .forEach((x) => x.classList.toggle('on', x.dataset.t === t));
    $b('blTipoAyuda').textContent = AYUDA_TIPO[t] || '';
    $b('blGuionBox').style.display = t === 'audio' ? 'none' : '';
    $b('blAudioBox').style.display = t === 'audio' ? '' : 'none';
    $b('blVozBox').style.display = t === 'audio' ? 'none' : '';
    revisarVariables();
  }

  $b('blTipo').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t && !t.disabled) elegirTipo(t.dataset.t);
  });

  /** Avisa qué variables usa el mensaje, para que coincidan con las
      columnas del archivo que se va a subir. */
  function revisarVariables() {
    const vs = [...new Set([...$b('blGuion').value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
    const caja = $b('blVariables');

    if (tipo === 'variables') {
      caja.innerHTML = vs.length
        ? `Variables detectadas: <b>${vs.map(seguro.texto).join('</b>, <b>')}</b>. ` +
          'El archivo debe traer una columna con cada uno de esos nombres.'
        : 'Escribe al menos una variable entre llaves, por ejemplo {nombre}.';
    } else if (tipo === 'texto') {
      caja.innerHTML = vs.length
        ? '<b>Ese mensaje tiene variables.</b> Cambia el tipo a "Texto con variables".'
        : 'El mismo texto para todos. Se genera un solo audio y se reutiliza.';
    } else caja.innerHTML = '';
  }

  $b('blGuion').addEventListener('input', revisarVariables);

  /* ── Respuesta ── */

  function alternarRespuesta() {
    $b('blRespuestaBox').style.display = $b('blPideRespuesta').checked ? '' : 'none';
  }
  $b('blPideRespuesta').addEventListener('change', alternarRespuesta);

  function elegirRespTipo(t) {
    respTipo = t;
    document.querySelectorAll('#blRespTipo .tab')
      .forEach((x) => x.classList.toggle('on', x.dataset.t === t));
    $b('blTeclasBox').style.display = t === 'tecla' ? '' : 'none';
    $b('blDigitosBox').style.display = t === 'numero' ? '' : 'none';
  }
  $b('blRespTipo').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t && !t.disabled) elegirRespTipo(t.dataset.t);
  });

  /* ── Guardar ── */

  const datosDelFormulario = () => ({
    nombre: $b('blNombre').value.trim(),
    campana_id: Number($b('blCampana').value) || null,
    tipo,
    guion: tipo === 'audio' ? null : $b('blGuion').value.trim(),
    audio_archivo: tipo === 'audio' ? $b('blAudio').value.trim() : null,
    voz_id: tipo === 'audio' ? null : $b('blVoz').value.trim(),
    respuesta: $b('blPideRespuesta').checked,
    respuesta_tipo: respTipo,
    respuesta_guion: $b('blRespGuion').value.trim(),
    respuesta_opciones: $b('blTeclas').value.trim(),
    respuesta_digitos: Number($b('blDigitos').value) || 10,
    hora_inicio: $b('blDesde').value + ':00',
    hora_fin: $b('blHasta').value + ':00',
    dias: $b('blDias').value.trim(),
    reintentos: Number($b('blReintentos').value) || 0,
  });

  $b('btnBlGuardar').addEventListener('click', async () => {
    const datos = datosDelFormulario();
    const btn = $b('btnBlGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';

    try {
      if (actual) {
        await servicio.guardarBlaster(actual.id, datos);
        aviso('Blaster guardado.', 'av-b');
        await pintarLista();
        await abrirEditor(actual.id);
      } else {
        const r = await servicio.crearBlaster(datos);
        aviso('Blaster creado. Ahora carga la lista de destinatarios.', 'av-b');
        await pintarLista();
        await abrirEditor(r.id);
      }
    } catch (e) {
      aviso(e.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  });

  $b('btnBlCancelar').addEventListener('click', () => {
    mostrar(false);
    actual = null;
    ['destinosBlaster', 'aprobarBlaster', 'respuestasBlaster']
      .forEach((id) => { $b(id).style.display = 'none'; });
  });

  $b('btnBlBorrar').addEventListener('click', async () => {
    if (!actual) return;
    if (!confirm(`¿Eliminar el blaster "${actual.nombre}"?\n\n` +
                 'Se borran también su lista y sus respuestas.')) return;
    try {
      await servicio.eliminarBlaster(actual.id);
      mostrar(false);
      actual = null;
      await pintarLista();
      aviso('Blaster eliminado.', 'av-b');
    } catch (e) { aviso(e.message, 'av-a'); }
  });

  /* ═══════════ DESTINATARIOS ═══════════ */

  const COLUMNAS = ['numero', 'nombre'];

  function leerCsv(texto) {
    const limpio = texto.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!limpio) return { error: 'El archivo está vacío' };

    const lineas = limpio.split('\n').filter((l) => l.trim());
    const sep = (lineas[0].match(/;/g) || []).length >= (lineas[0].match(/,/g) || []).length ? ';' : ',';

    const partir = (linea) => {
      const celdas = []; let actualTxt = ''; let comillas = false;
      for (let i = 0; i < linea.length; i++) {
        const c = linea[i];
        if (c === '"') {
          if (comillas && linea[i + 1] === '"') { actualTxt += '"'; i++; }
          else comillas = !comillas;
        } else if (c === sep && !comillas) { celdas.push(actualTxt); actualTxt = ''; }
        else actualTxt += c;
      }
      celdas.push(actualTxt);
      return celdas.map((x) => x.trim());
    };

    const cabecera = partir(lineas[0]).map((h) =>
      h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

    if (!cabecera.includes('numero') && !cabecera.includes('telefono')) {
      return { error: 'Al archivo le falta la columna "numero". Descarga la plantilla.' };
    }

    /* Toda columna que no sea el número es una variable del mensaje */
    const filas = lineas.slice(1).map((l) => {
      const celdas = partir(l);
      const fila = {};
      cabecera.forEach((col, i) => { fila[col] = celdas[i] || ''; });
      return fila;
    }).filter((f) => f.numero || f.telefono);

    return filas.length ? { filas } : { error: 'El archivo no tiene filas con datos' };
  }

  $b('blArchivo').addEventListener('change', async (e) => {
    const archivo = e.target.files?.[0];
    if (!archivo || !actual) return;
    e.target.value = '';

    const { filas, error } = leerCsv(await archivo.text());
    if (error) {
      filasArchivo = [];
      $b('btnBlCargar').style.display = 'none';
      $b('blRevision').innerHTML = avisoCaja('av-r', error);
      return;
    }

    $b('blRevision').innerHTML = `<div class="vacio">Revisando ${filas.length} filas…</div>`;
    try {
      const r = await servicio.revisarDestinos(actual.id, filas);
      filasArchivo = filas;
      pintarRevision(r);
    } catch (err) {
      $b('blRevision').innerHTML = avisoCaja('av-r', err.message);
    }
  });

  const avisoCaja = (clase, texto) => `<div class="aviso ${clase}" style="margin:0">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    <div>${seguro.texto(texto)}</div></div>`;

  function pintarRevision(r) {
    $b('btnBlCargar').style.display = r.correctas ? '' : 'none';
    $b('btnBlCargar').textContent = `Cargar ${r.correctas} destinatario(s)`;

    /* La muestra es lo más útil de todo: el supervisor lee el mensaje
       exacto que va a escuchar la gente antes de que salga una llamada. */
    const muestra = (r.muestra || []).length
      ? `<div class="campos-fijos" style="margin-bottom:10px">
           <div class="cf-tit">Así se escuchará</div>
           ${r.muestra.map((m) => `<div class="cf-item" style="margin-bottom:6px">
             <b>${seguro.texto(m.numero)}</b><span>${seguro.texto(m.mensaje)}</span></div>`).join('')}
         </div>` : '';

    const resumen = r.conError
      ? avisoCaja('av-a', `${r.correctas} fila(s) listas y ${r.conError} con problemas. ` +
          'Solo se cargarán las correctas.')
      : avisoCaja('av-b', `Las ${r.correctas} filas están correctas.`);

    $b('blRevision').innerHTML = resumen + muestra + `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Línea</th><th>Número</th><th>Nombre</th><th>Revisión</th></tr>
      ${r.filas.map((f) => `<tr${f.errores.length ? ' style="background:var(--danger-l)"' : ''}>
        <td class="mono">${seguro.texto(f.linea)}</td>
        <td class="mono">${seguro.celda(f.numero)}</td>
        <td>${seguro.celda(f.nombre)}</td>
        <td>${f.errores.length
          ? `<span class="mas-error">${seguro.texto(f.errores.join('. '))}</span>`
          : '<span class="mas-ok">Lista</span>'}</td>
      </tr>`).join('')}</table></div>`;
  }

  $b('btnBlCargar').addEventListener('click', async () => {
    if (!actual || !filasArchivo.length) return;
    const btn = $b('btnBlCargar');
    btn.disabled = true; btn.textContent = 'Cargando…';
    try {
      const r = await servicio.cargarDestinos(actual.id, filasArchivo);
      filasArchivo = [];
      btn.style.display = 'none';
      await pintarDestinos();
      await pintarLista();
      pintarAprobacion();
      aviso(`${r.cargados} destinatarios cargados.`, 'av-b');
    } catch (e) {
      aviso(e.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Cargar la lista';
    }
  });

  async function pintarDestinos() {
    if (!actual) return;
    let d = [];
    try { d = await servicio.listarDestinos(actual.id); } catch { /* ninguno */ }
    const filas = Array.isArray(d) ? d : (d.destinos || []);

    $b('blDestN').textContent = filas.length;
    if (!filas.length) {
      $b('blRevision').innerHTML = '<div class="vacio">Todavía no hay destinatarios.</div>';
      return;
    }

    $b('blRevision').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Número</th><th>Nombre</th><th>Estado</th><th>Intentos</th></tr>
      ${filas.slice(0, 200).map((f) => `<tr>
        <td class="mono">${seguro.texto(f.numero)}</td>
        <td>${seguro.celda(f.nombre)}</td>
        <td><span class="t ${f.estado === 'contestada' ? 'g' : 'o'}">${seguro.texto(f.estado)}</span></td>
        <td class="mono">${seguro.texto(f.intentos ?? 0)}</td>
      </tr>`).join('')}</table>
      ${filas.length > 200 ? `<div class="hint">Se muestran los primeros 200 de ${filas.length}.</div>` : ''}
      </div>`;
  }

  $b('btnBlPlantilla').addEventListener('click', () => {
    /* La plantilla incluye las variables del mensaje, así el archivo
       sale con las columnas que este blaster necesita. */
    const vs = [...new Set([...$b('blGuion').value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
    const cols = [...new Set([...COLUMNAS, ...vs])];
    const ejemplo = [
      cols.join(';'),
      cols.map((c) => c === 'numero' ? '3102879726' : c === 'nombre' ? 'Juan Pérez' : 'valor').join(';'),
    ].join('\r\n');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + ejemplo], { type: 'text/csv;charset=utf-8' }));
    a.download = 'destinatarios.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });

  /* ═══════════ APROBACIÓN ═══════════ */

  function pintarAprobacion() {
    if (!actual) return;
    $b('aprobarBlaster').style.display = '';

    const puedeAprobar = (ui.sesion?.permisos || []).includes('blaster_aprobar');
    const estado = actual.estado;

    let cuerpo = '';

    if (estado === 'borrador' || estado === 'listo') {
      cuerpo = puedeAprobar
        ? avisoCaja('av-a', 'Al aprobarlo quedará listo para marcar. Revisa el mensaje y la lista antes.') +
          `<div class="ctrls"><button class="b b-teal" data-estado="aprobado">Aprobar y lanzar</button></div>`
        : avisoCaja('av-b', 'Preparado. Un administrador debe aprobarlo para que empiece a marcar.');
    } else if (estado === 'aprobado' || estado === 'activo') {
      cuerpo = avisoCaja('av-b',
        'Aprobado' + (actual.aprobado_en ? ' el ' + String(actual.aprobado_en).slice(0, 16).replace('T', ' ') : '') +
        '. La marcación empezará cuando la central esté conectada a la plataforma.') +
        (puedeAprobar ? `<div class="ctrls">
          <button class="b b-gh" data-estado="pausado">Pausar</button>
          <button class="b b-red b-sm" data-estado="cancelado">Cancelar</button></div>` : '');
    } else if (estado === 'pausado') {
      cuerpo = avisoCaja('av-a', 'Pausado. No se está llamando a nadie.') +
        (puedeAprobar ? `<div class="ctrls">
          <button class="b b-teal" data-estado="aprobado">Reanudar</button>
          <button class="b b-red b-sm" data-estado="cancelado">Cancelar</button></div>` : '');
    } else {
      cuerpo = avisoCaja('av-b', `Este blaster está ${estado}.`);
    }

    /* Mientras no exista el canal con Asterisk, conviene decirlo claro
       para que nadie espere llamadas que no van a salir. */
    $b('blAprobacion').innerHTML = cuerpo +
      `<div class="hint" style="margin-top:8px">La marcación automática todavía no está
       habilitada en el servidor: un blaster aprobado queda esperando.</div>`;
  }

  $b('blAprobacion').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-estado]');
    if (!b || !actual) return;

    const destino = b.dataset.estado;
    if (destino === 'aprobado' &&
        !confirm(`¿Aprobar "${actual.nombre}"?\n\n` +
                 'Quedará listo para llamar a todos los destinatarios cargados.')) return;
    if (destino === 'cancelado' &&
        !confirm('¿Cancelar el blaster? No se podrá reanudar.')) return;

    b.disabled = true;
    try {
      await servicio.cambiarEstadoBlaster(actual.id, destino);
      await pintarLista();
      await abrirEditor(actual.id);
      aviso('Estado actualizado.', 'av-b');
    } catch (err) {
      aviso(err.message, 'av-a');
      b.disabled = false;
    }
  });

  /* ═══════════ RESPUESTAS ═══════════ */

  async function pintarRespuestas() {
    if (!actual) return;
    let r;
    try { r = await servicio.respuestasBlaster(actual.id); } catch { return; }

    if (!r || !r.total) {
      $b('respuestasBlaster').style.display = 'none';
      return;
    }

    $b('respuestasBlaster').style.display = '';
    $b('blRespN').textContent = r.total;

    const conteo = Object.entries(r.conteo || {})
      .map(([valor, n]) => `<div class="cf-item"><b>${seguro.texto(valor)}</b>
        <span>${seguro.texto(n)} respuesta(s)</span></div>`).join('');

    $b('blRespuestas').innerHTML = `
      ${conteo ? `<div class="cf-rejilla" style="margin-bottom:10px">${conteo}</div>` : ''}
      <div style="overflow-x:auto"><table class="tb">
        <tr><th>Número</th><th>Nombre</th><th>Respondió</th><th>Cuándo</th></tr>
        ${(r.respuestas || []).map((x) => `<tr>
          <td class="mono">${seguro.texto(x.numero)}</td>
          <td>${seguro.celda(x.nombre)}</td>
          <td><b class="mono">${seguro.texto(x.valor)}</b></td>
          <td class="mono">${seguro.texto(String(x.creada || '').slice(0, 16).replace('T', ' '))}</td>
        </tr>`).join('')}</table></div>`;
  }

  return { abrir };
})();
