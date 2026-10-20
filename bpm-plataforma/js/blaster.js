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

  /* Los días se guardan como "L,M,X,J,V" para que la central los lea
     igual que siempre; en pantalla son casillas. */
  const diasMarcados = () =>
    [...$b('blDias').querySelectorAll('input:checked')].map((i) => i.value).join(',');

  function marcarDias(texto) {
    const puestos = String(texto || '').split(',').map((d) => d.trim());
    $b('blDias').querySelectorAll('input')
      .forEach((i) => { i.checked = puestos.includes(i.value); });
  }

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

  /** Los audios ya subidos, para elegir uno sin volver a subirlo. */
  async function llenarAudios(seleccionado) {
    let r = { audios: [] };
    try { r = await servicio.listarAudios(); } catch { /* ninguno */ }

    const tam = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB'
                      : Math.round(b / 1024) + ' KB');

    $b('blAudio').innerHTML = '<option value="">Elige un audio…</option>' +
      r.audios.map((a) => `<option value="${seguro.texto(a.archivo)}"${
        a.archivo === seleccionado ? ' selected' : ''}>${seguro.texto(a.archivo)} · ${tam(a.bytes)}</option>`).join('');

    if (seleccionado && !r.audios.some((a) => a.archivo === seleccionado)) {
      /* El audio guardado ya no está en el servidor: se avisa en lugar
         de dejar el campo vacío sin explicación. */
      $b('blAudio').innerHTML +=
        `<option value="${seguro.texto(seleccionado)}" selected>${seguro.texto(seleccionado)} · no se encuentra</option>`;
    }
  }

  $b('blSubirAudio').addEventListener('change', async (e) => {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    e.target.value = '';

    $b('blSubiendo').textContent = `Subiendo ${archivo.name}…`;
    try {
      const r = await servicio.subirAudio(archivo);
      await llenarAudios(r.archivo);
      $b('blSubiendo').textContent = '';
      aviso(r.nota ? `Audio subido. ${r.nota}` : 'Audio subido y listo para usar.',
            r.nota ? 'av-a' : 'av-b');
    } catch (err) {
      $b('blSubiendo').textContent = '';
      aviso('No se pudo subir: ' + err.message, 'av-a');
    }
  });

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

    /* Los campos se vuelven a habilitar. Si antes se abrió un blaster
       cancelado o en curso, quedaban bloqueados —correcto para ese—,
       y el formulario nuevo heredaba el bloqueo: no se podía escribir
       nada ni elegir el tipo de mensaje. */
    $b('editorBlaster').querySelectorAll('input, select, textarea, .tab')
      .forEach((el) => { el.disabled = false; });
    $b('btnBlGuardar').disabled = false;
    $b('blTitulo').textContent = 'Nuevo blaster';
    $b('blEstado').textContent = 'Borrador';
    $b('blNombre').value = '';
    $b('blGuion').value = '';
    $b('blAudio').value = '';
    $b('blVoz').value = '';
    $b('blPideRespuesta').checked = false;
    $b('blRespGuion').value = '';
    marcarTeclas('1,2');
    $b('blDigitos').value = '10';
    $b('blDesde').value = '08:00';
    $b('blHasta').value = '19:00';
    marcarDias('L,M,X,J,V');
    $b('blReintentos').value = '2';
    llenarAudios();
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

    if (!abierto) {
      /* Al cerrar, se ocultan también los paneles de abajo: destinatarios,
         lanzamiento y respuestas. Están fuera del editor, y al eliminar
         un blaster se quedaban a la vista con los datos de sus clientes. */
      ['destinosBlaster', 'aprobarBlaster', 'respuestasBlaster']
        .forEach((id) => { if ($b(id)) $b(id).style.display = 'none'; });

      /* Y se desbloquean los campos, por cualquier camino que se cierre.
         Si el último abierto estaba cancelado o en curso, sus campos
         quedaban bloqueados y el siguiente formulario los heredaba. */
      $b('editorBlaster').querySelectorAll('input, select, textarea, .tab')
        .forEach((el) => { el.disabled = false; });
      $b('btnBlGuardar').disabled = false;
    }
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
    await llenarAudios(actual.audio_archivo || '');
    $b('blVoz').value = actual.voz_id || '';
    $b('blPideRespuesta').checked = !!actual.respuesta;
    $b('blRespGuion').value = actual.respuesta_guion || '';
    marcarTeclas(actual.respuesta_opciones || '1,2', actual.respuesta_etiquetas);
    $b('blDigitos').value = actual.respuesta_digitos || 10;
    $b('blDesde').value = (actual.hora_inicio || '08:00').slice(0, 5);
    $b('blHasta').value = (actual.hora_fin || '19:00').slice(0, 5);
    marcarDias(actual.dias || 'L,M,X,J,V');
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

    /* Con audio grabado, la pregunta va dentro de la grabación: el campo
       de texto sobra, y se reemplaza por una explicación. */
    $b('blRespGuionBox').style.display = t === 'audio' ? 'none' : '';
    $b('blRespAudioHint').style.display = t === 'audio' ? '' : 'none';

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

  /* ── Teclas con casillas ──
     Antes había que escribirlas separadas por comas. Las casillas
     escriben en el mismo campo oculto, así que el guardado no cambia. */

  /* Lo escrito para cada tecla, para no perderlo al marcar y desmarcar */
  let etiquetas = {};

  function marcarTeclas(lista, conEtiquetas) {
    const sel = String(lista || '').split(',').map((x) => x.trim());
    document.querySelectorAll('#blTeclasSel input')
      .forEach((c) => { c.checked = sel.includes(c.value); });
    $b('blTeclas').value = sel.filter(Boolean).join(',');

    etiquetas = {};
    if (conEtiquetas) {
      try {
        etiquetas = typeof conEtiquetas === 'string' ? JSON.parse(conEtiquetas) : conEtiquetas;
      } catch { etiquetas = {}; }
    }
    pintarEtiquetas();
  }

  /** Un campo por cada tecla marcada, para escribir qué significa. */
  function pintarEtiquetas() {
    const marcadas = [...document.querySelectorAll('#blTeclasSel input:checked')]
      .map((c) => c.value);

    $b('blEtiquetas').innerHTML = marcadas.length
      ? marcadas.map((t) => `
          <div class="bl-etq">
            <span class="bl-etq-n">${seguro.texto(t)}</span>
            <input class="fi" data-tecla="${seguro.texto(t)}" maxlength="60"
                   value="${seguro.texto(etiquetas[t] || '')}"
                   placeholder="${t === '1' ? 'Por ejemplo: Quiere que lo llamen'
                                : t === '2' ? 'Por ejemplo: No le interesa' : 'Qué significa'}">
          </div>`).join('')
      : '<div class="hint">Marca primero las teclas que se aceptan.</div>';
  }

  $b('blTeclasSel').addEventListener('change', () => {
    $b('blTeclas').value = [...document.querySelectorAll('#blTeclasSel input:checked')]
      .map((c) => c.value).join(',');
    pintarEtiquetas();
  });

  /* Lo que se escribe se guarda al momento, para que marcar otra tecla
     —que vuelve a pintar los campos— no borre lo ya escrito. */
  $b('blEtiquetas').addEventListener('input', (e) => {
    const c = e.target.closest('[data-tecla]');
    if (c) etiquetas[c.dataset.tecla] = c.value;
  });

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
    $b('blEtiquetasBox').style.display = t === 'tecla' ? '' : 'none';
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
    respuesta_etiquetas: etiquetas,
    respuesta_digitos: Number($b('blDigitos').value) || 10,
    hora_inicio: $b('blDesde').value + ':00',
    hora_fin: $b('blHasta').value + ':00',
    dias: diasMarcados(),
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

  /* ═══════════ GENERAR EL AUDIO CON VOZ SINTÉTICA ═══════════ */

  /** Reproduce en la pantalla el audio que devolvió el servidor. */
  function reproductor(base64, texto) {
    if (!base64) {
      return '<div class="hint">El audio se generó, pero no se pudo preparar para ' +
             'escucharlo aquí. La llamada lo reproducirá igual.</div>';
    }
    return `<div class="bl-oir">
        <audio controls autoplay src="data:audio/wav;base64,${base64}"></audio>
        ${texto ? `<div class="hint">"${seguro.texto(texto)}"</div>` : ''}
      </div>`;
  }

  $b('blAprobacion').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-generar]');
    if (!btn || !actual) return;

    const muestra = btn.dataset.generar === 'muestra';
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = muestra ? 'Generando la muestra…' : 'Generando…';
    $b('blAudioRes').innerHTML = '';

    try {
      const r = await servicio.generarAudioBlaster(actual.id, muestra);

      if (muestra || actual.tipo === 'texto') {
        $b('blAudioRes').innerHTML = reproductor(r.escuchar, r.texto);
      } else {
        /* Con variables: cuántos salieron y cuáles fallaron, para que se
           pueda corregir la lista antes de lanzar. */
        const fallos = r.fallidos || [];
        $b('blAudioRes').innerHTML =
          `<div class="hint" style="margin-top:6px">Se generaron <b>${seguro.texto(r.generados || 0)}</b> audios.${
            fallos.length ? ` <b>${fallos.length} no se pudieron generar:</b> ${
              seguro.texto(fallos.slice(0, 3).map((f) => f.error).join(' · '))}` : ''}</div>`;
      }

      /* El estado cambió: se vuelve a leer para que el panel lo refleje,
         y la tabla de destinatarios, para que aparezcan los botones de
         escuchar de cada persona. */
      if (!muestra) {
        actual = await servicio.leerBlaster(actual.id);
        const res = $b('blAudioRes').innerHTML;
        pintarAprobacion();
        $b('blAudioRes').innerHTML = res;
        await pintarDestinos();
      }
    } catch (err) {
      $b('blAudioRes').innerHTML =
        `<div class="aviso av-r" style="margin-top:8px"><div>${seguro.texto(err.message)}</div></div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  /* ═══════════ DESTINATARIOS ═══════════ */

  const COLUMNAS = ['numero', 'nombre'];

  /* El archivo lo interpreta el servidor: Excel y CSV por el mismo
     camino. */

  $b('blArchivo').addEventListener('change', async (e) => {
    const archivo = e.target.files?.[0];
    if (!archivo || !actual) return;
    e.target.value = '';

    $b('blRevision').innerHTML = '<div class="vacio">Leyendo el archivo…</div>';

    let filas;
    try {
      ({ filas } = await servicio.leerTabla(archivo));
    } catch (err) {
      filasArchivo = [];
      $b('btnBlCargar').style.display = 'none';
      $b('blRevision').innerHTML = avisoCaja('av-r', err.message);
      return;
    }

    if (!filas.some((f) => f.numero || f.telefono)) {
      $b('btnBlCargar').style.display = 'none';
      $b('blRevision').innerHTML = avisoCaja('av-r',
        'Al archivo le falta la columna "numero". Descarga la plantilla para ver el formato.');
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

  /* Mientras el blaster está activo y abierto, la lista se refresca sola
     cada cinco segundos. Antes mostraba lo que había al abrirla: una
     llamada que ya había contestado seguía diciendo "pendiente". */
  let relojDestinos = null;

  function vigilarDestinos() {
    clearInterval(relojDestinos);
    relojDestinos = setInterval(async () => {
      const abierto = $b('editorBlaster').style.display !== 'none';
      const enVista = document.querySelector('.vista.on')?.dataset.v === 'blaster';
      if (!actual || actual.estado !== 'activo' || !abierto || !enVista) {
        clearInterval(relojDestinos); relojDestinos = null; return;
      }
      await pintarDestinos();

      /* Si terminó mientras se miraba, el panel de lanzamiento cambia */
      try {
        const fresco = await servicio.leerBlaster(actual.id);
        if (fresco.estado !== actual.estado) { actual = fresco; pintarAprobacion(); }
      } catch { /* sigue con lo que tiene */ }
    }, 5000);
  }

  async function pintarDestinos() {
    if (!actual) return;
    if (actual.estado === 'activo' && !relojDestinos) vigilarDestinos();
    let d = [];
    try { d = await servicio.listarDestinos(actual.id); } catch { /* ninguno */ }
    const filas = Array.isArray(d) ? d : (d.destinos || []);

    $b('blDestN').textContent = filas.length;
    if (!filas.length) {
      $b('blRevision').innerHTML = '<div class="vacio">Todavía no hay destinatarios.</div>';
      return;
    }

    /* El estado en palabras, y si ya se intentó, cuándo se reintenta.
       Antes un "pendiente" no decía si se había llamado o no. */
    const NOMBRES = {
      pendiente: 'Por llamar', llamando: 'Llamando', contestada: 'Contestó',
      sin_respuesta: 'No contestó', fallida: 'Falló', buzon: 'Buzón', excluido: 'Excluido',
    };
    const estadoDe = (f) => {
      if (f.estado === 'pendiente' && f.intentos > 0) {
        const h = f.proximo_intento ? String(f.proximo_intento).slice(11, 16) : '';
        return h ? `Reintento ${h}` : 'Reintento';
      }
      return NOMBRES[f.estado] || f.estado;
    };
    const tono = (f) => f.estado === 'contestada' ? 'g'
      : f.estado === 'llamando' ? 'b'
      : (f.estado === 'pendiente' && !f.intentos) ? 'o' : 'a';

    /* Con variables, cada persona escucha un mensaje distinto: se
       muestra el texto armado con sus datos y un botón para oírlo.
       Leyendo la columna se detecta un nombre mal escrito en el Excel
       sin tener que escuchar los audios uno a uno. */
    const conVariables = actual.tipo === 'variables';

    $b('blRevision').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Número</th><th>Nombre</th><th>Estado</th><th>Intentos</th><th>Motivo</th>${
        conVariables ? '<th>Lo que escucha</th><th>Audio</th>' : ''}</tr>
      ${filas.slice(0, 200).map((f) => `<tr>
        <td class="mono">${seguro.texto(f.numero)}</td>
        <td>${seguro.celda(f.nombre)}</td>
        <td><span class="t ${tono(f)}">${seguro.texto(estadoDe(f))}</span></td>
        <td class="mono">${seguro.texto(f.intentos ?? 0)}</td>
        <td>${seguro.celda(f.ultimo_motivo)}</td>${conVariables ? `
        <td class="bl-msj">${seguro.celda(f.mensaje)}</td>
        <td class="bl-oir-celda">${f.tieneAudio
          ? `<button class="b b-gh b-sm" data-oir="${seguro.texto(f.id)}">▶ Escuchar</button>`
          : '<span class="hint">Sin generar</span>'}</td>` : ''}
      </tr>`).join('')}</table>
      ${filas.length > 200 ? `<div class="hint">Se muestran los primeros 200 de ${filas.length}.</div>` : ''}
      </div>`;
  }

  /* Escuchar el audio de una persona. Se pide solo al pulsar, y no gasta
     créditos: es el audio ya generado. Al terminar de cargarlo, el botón
     se reemplaza por el reproductor. */
  $b('blRevision').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-oir]');
    if (!btn || !actual) return;

    btn.disabled = true;
    btn.textContent = 'Cargando…';
    try {
      const r = await servicio.escucharDestino(actual.id, btn.dataset.oir);
      const celda = btn.closest('td');
      celda.innerHTML = `<audio controls autoplay src="data:audio/wav;base64,${r.escuchar}"></audio>`;
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '▶ Escuchar';
      aviso(err.message, 'av-a');
    }
  });

  $b('btnBlPlantilla').addEventListener('click', () => {
    /* La plantilla incluye las variables del mensaje, así el archivo
       sale con las columnas que este blaster necesita. */
    const vs = [...new Set([...$b('blGuion').value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
    const cols = [...new Set([...COLUMNAS, ...vs])];
    /* La primera línea le dice a Excel cómo separar. Sin ella, según
       la configuración del equipo, todo aparece en una sola columna. */
    const ejemplo = [
      'sep=;',
      cols.join(';'),
      cols.map((c) => c === 'numero' ? '3102879726' : c === 'nombre' ? 'Juan Pérez' : 'valor').join(';'),
      cols.map((c) => c === 'numero' ? '3004432187' : c === 'nombre' ? 'María Gómez' : 'valor').join(';'),
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

    /* Lanza quien prepara el blaster: el supervisor. Antes hacía falta
       que un administrador lo aprobara, y la operación no puede esperar
       a eso. El servidor sigue comprobando que sea de sus campañas. */
    const puedeAprobar = (ui.sesion?.permisos || []).includes('blaster');
    const estado = actual.estado;

    let cuerpo = '';

    /* "aprobado" se trata igual que listo: es un estado que dejaban las
       versiones anteriores, donde aprobar y lanzar eran pasos separados.
       Un blaster que quedó ahí tiene que poder lanzarse. */
    if (estado === 'borrador' || estado === 'listo' || estado === 'aprobado') {
      /* Con texto a voz hay un paso antes de lanzar: generar el audio.
         El servidor no deja lanzar sin él, y antes no había botón para
         hacerlo: los blasters de texto no se podían lanzar nunca. */
      const conVoz = actual.tipo === 'texto' || actual.tipo === 'variables';

      const pasoAudio = !conVoz ? '' : `
        <div class="bl-audio">
          <div class="bl-audio-t"><b>1 · El audio del mensaje</b>
            <span class="t ${actual.audio_archivo || actual.tipo === 'variables' ? 'g' : 'a'}">${
              actual.tipo === 'variables' ? 'Uno por persona'
                : actual.audio_archivo ? 'Generado' : 'Sin generar'}</span></div>
          <p class="hint" style="margin:4px 0 8px">${
            actual.tipo === 'variables'
              ? 'Escucha una muestra con los datos del primer destinatario y, si suena bien, genera los de todos.'
              : 'Genéralo y escúchalo antes de lanzar: así sabes exactamente qué va a oír el cliente.'}</p>
          <div class="ctrls">
            <button class="b b-gh b-sm" data-generar="muestra">Escuchar una muestra</button>
            <button class="b b-teal b-sm" data-generar="todo">${
              actual.tipo === 'variables' ? 'Generar los audios de todos' : 'Generar el audio'}</button>
          </div>
          <div id="blAudioRes"></div>
        </div>`;

      cuerpo = puedeAprobar
        ? pasoAudio +
          /* Texto plano: este cuadro no interpreta HTML, por seguridad.
             Antes llevaba una negrita y se veían las etiquetas. */
          avisoCaja('av-a',
            'Al lanzarlo, la plataforma empezará a llamar. Revisa el mensaje y la lista antes.') +
          `<div class="ctrls"><button class="b b-teal" data-estado="activo">Lanzar</button></div>`
        : pasoAudio + avisoCaja('av-b', 'Preparado para lanzar.');
    } else if (estado === 'activo') {
      cuerpo = avisoCaja('av-b',
        'En curso: la plataforma está llamando a los destinatarios. ' +
        'Solo marca dentro del horario y los días configurados.') +
        (puedeAprobar ? `<div class="ctrls">
          <button class="b b-gh" data-estado="pausado">Pausar</button>
          <button class="b b-red b-sm" data-estado="cancelado">Cancelar</button></div>` : '');
    } else if (estado === 'pausado') {
      cuerpo = avisoCaja('av-a', 'Pausado. No se está llamando a nadie.') +
        (puedeAprobar ? `<div class="ctrls">
          <button class="b b-teal" data-estado="activo">Reanudar</button>
          <button class="b b-red b-sm" data-estado="cancelado">Cancelar</button></div>` : '');
    } else {
      cuerpo = avisoCaja('av-b', `Este blaster está ${estado}.`);
    }

    $b('blAprobacion').innerHTML = cuerpo;
  }

  $b('blAprobacion').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-estado]');
    if (!b || !actual) return;

    const destino = b.dataset.estado;
    /* Aprobar y lanzar es lo mismo: al confirmarlo, la plataforma empieza
       a llamar. Antes este botón solo lo aprobaba, y el motor —que marca
       los blasters activos— nunca lo tomaba. */
    if (destino === 'activo' && actual.estado !== 'pausado' &&
        !confirm(`¿Lanzar "${actual.nombre}"?\n\n` +
                 'La plataforma empezará a llamar a todos los destinatarios cargados.')) return;
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

    /* Lo que significa cada tecla, igual que en el reporte: "1 · De
       acuerdo" se entiende sin tener que acordarse del mensaje. */
    let etiquetas = {};
    try {
      etiquetas = typeof actual.respuesta_etiquetas === 'string'
        ? JSON.parse(actual.respuesta_etiquetas || '{}') : (actual.respuesta_etiquetas || {});
    } catch { etiquetas = {}; }

    const esNumero = actual.respuesta_tipo === 'numero';
    const nombreDe = (valor) => {
      const v = String(valor ?? '');
      if (/^invalida:/.test(v)) return `Inválida (${v.split(':')[1]})`;
      return etiquetas[v] ? `${v} · ${etiquetas[v]}` : v;
    };

    /* El conteo solo tiene sentido con teclas. Al digitar un número,
       cada respuesta es distinta: saldría un recuadro por documento. */
    const conteo = esNumero ? '' : Object.entries(r.conteo || {})
      .filter(([valor]) => !/^invalida:/.test(valor))
      .map(([valor, n]) => `<div class="cf-item"><b>${seguro.texto(nombreDe(valor))}</b>
        <span>${seguro.texto(n)} respuesta(s)</span></div>`).join('');

    $b('blRespuestas').innerHTML = `
      ${conteo ? `<div class="cf-rejilla" style="margin-bottom:10px">${conteo}</div>` : ''}
      <div style="overflow-x:auto"><table class="tb">
        <tr><th>Número</th><th>Nombre</th><th>Respondió</th><th>Cuándo</th></tr>
        ${(r.respuestas || []).map((x) => `<tr>
          <td class="mono">${seguro.texto(x.numero)}</td>
          <td>${seguro.celda(x.nombre)}</td>
          <td><b>${seguro.texto(nombreDe(x.valor))}</b></td>
          <td class="mono">${seguro.texto(String(x.creada || '').slice(0, 16).replace('T', ' '))}</td>
        </tr>`).join('')}</table></div>`;
  }

  return { abrir };
})();