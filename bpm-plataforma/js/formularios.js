/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — FORMULARIOS

   Dos caras del mismo módulo:

     LADO AGENTE      llena el formulario de su campaña. Si el servidor
                      no responde, la respuesta queda en una cola local
                      y se reintenta. Es el requisito de
                      "formularios offline".

     LADO SUPERVISOR  crea y edita formularios: nombre, campaña y campos.
                      Es el requisito de "un panel donde yo pueda crear
                      formularios".

   Los datos salen de servicio.js. Cuando exista el backend, cambia
   servicio.js y este archivo no se toca.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const formularios = (() => {

  let formActual = null;    // formulario que está llenando el agente
  let editando = null;      // formulario abierto en el diseñador

  /* ═══════════════════════════════════════════════════════════════
     LADO AGENTE

     El formulario de la campaña aparece en el escritorio, debajo de la
     tipificación. Se carga al iniciar sesión y se habilita cuando entra
     o sale una llamada: el Teléfono 1 llega puesto con el número de esa
     llamada.

     País, departamento y ciudad salen del catálogo de la base. Si el
     país es Colombia, la ciudad depende del departamento; para otros
     países se escriben a mano, porque no tenemos sus divisiones.
     ═══════════════════════════════════════════════════════════════ */

  let formAgente = null;      // formulario de la campaña del agente
  let paises = [];
  let departamentos = [];

  async function abrirAgente() {
    const caja = $('formCampos');
    if (!caja) return;

    $('formCampana').textContent = ui.sesion?.campana || 'Todas';

    try {
      const lista = await servicio.listarFormularios(ui.sesion?.campana_id || '');
      if (!lista.length) {
        caja.innerHTML = '<div class="vacio">Tu campaña todavía no tiene formulario.</div>';
        $('btnFormGuardar').style.display = 'none';
        return;
      }
      /* Si hay varios, se usa el de la campaña antes que el general. */
      const elegido = lista.find((f) => f.campana_id) || lista[0];
      formAgente = await servicio.leerFormulario(elegido.id);
      $('formTitulo').textContent = formAgente.nombre;

      [paises, departamentos] = await Promise.all([
        servicio.listarPaises(), servicio.listarDepartamentos('CO'),
      ]);
      pintarCampos();
    } catch (e) {
      caja.innerHTML = `<div class="vacio">No se pudo cargar el formulario: ${seguro.texto(e.message)}</div>`;
      $('btnFormGuardar').style.display = 'none';
    }
  }

  /** Dibuja los campos del formulario del agente. */
  function pintarCampos() {
    if (!formAgente) return;
    const caja = $('formCampos');

    caja.innerHTML = formAgente.campos.map((c) => {
      const id = 'fc' + c.id;
      const req = c.requerido ? ' <i>*</i>' : '';
      const ayuda = c.ayuda ? `<div class="hint">${seguro.texto(c.ayuda)}</div>` : '';
      let control;

      if (c.tipo === 'parrafo') {
        control = `<textarea class="fi" id="${id}" rows="3"></textarea>`;

      } else if (c.tipo === 'lista') {
        control = `<select class="fi" id="${id}"><option value="">Selecciona…</option>` +
          (c.opciones || []).map((o) => `<option>${seguro.texto(o)}</option>`).join('') + '</select>';

      } else if (c.tipo === 'si_no') {
        control = `<select class="fi" id="${id}"><option value="">Selecciona…</option>
          <option>Sí</option><option>No</option></select>`;

      } else if (c.tipo === 'pais') {
        control = `<select class="fi" id="${id}" data-ubi="pais">` +
          paises.map((p) => `<option value="${seguro.texto(p.nombre)}" data-cod="${seguro.texto(p.codigo)}"${p.codigo === 'CO' ? ' selected' : ''}>${seguro.texto(p.nombre)}</option>`).join('') +
          '</select>';

      } else if (c.tipo === 'departamento') {
        control = `<select class="fi" id="${id}" data-ubi="departamento"><option value="">Selecciona…</option>` +
          departamentos.map((d) => `<option value="${seguro.texto(d.nombre)}" data-cod="${seguro.texto(d.codigo)}">${seguro.texto(d.nombre)}</option>`).join('') +
          '</select>';

      } else if (c.tipo === 'ciudad') {
        control = `<select class="fi" id="${id}" data-ubi="ciudad">
          <option value="">Elige primero el departamento</option></select>`;

      } else {
        const tipoHtml = c.tipo === 'fecha' ? 'date'
                       : c.tipo === 'numero' ? 'number'
                       : c.tipo === 'correo' ? 'email' : 'text';
        const mono = (c.tipo === 'telefono' || c.tipo === 'numero') ? ' mono' : '';
        control = `<input class="fi${mono}" id="${id}" type="${tipoHtml}" autocomplete="off">`;
      }

      return `<div class="f"><label>${seguro.texto(c.etiqueta)}${req}</label>${control}${ayuda}</div>`;
    }).join('');

    $('btnFormGuardar').style.display = '';
    habilitar();
  }

  /* ── Ubicación encadenada ────────────────────────────────────────
     Cambiar el país recarga los departamentos; cambiar el departamento
     recarga las ciudades. Fuera de Colombia se escriben a mano. */

  $('formCampos')?.addEventListener('change', async (e) => {
    const ubi = e.target.dataset?.ubi;
    if (!ubi || !formAgente) return;

    const campoDe = (clave) => formAgente.campos.find((c) => c.clave === clave);
    const elDe = (clave) => { const c = campoDe(clave); return c ? $('fc' + c.id) : null; };

    if (ubi === 'pais') {
      const cod = e.target.selectedOptions[0]?.dataset.cod;
      const esColombia = cod === 'CO';
      const dep = elDe('departamento');
      const ciu = elDe('ciudad');

      if (esColombia) {
        if (dep) reemplazar(dep, 'select',
          '<option value="">Selecciona…</option>' +
          departamentos.map((d) => `<option value="${seguro.texto(d.nombre)}" data-cod="${seguro.texto(d.codigo)}">${seguro.texto(d.nombre)}</option>`).join(''),
          'departamento');
        if (ciu) reemplazar(ciu, 'select',
          '<option value="">Elige primero el departamento</option>', 'ciudad');
      } else {
        /* Otro país: campos de texto, porque no tenemos sus divisiones */
        if (dep) reemplazar(dep, 'input', '', 'departamento', 'Escribe el estado o provincia');
        if (ciu) reemplazar(ciu, 'input', '', 'ciudad', 'Escribe la ciudad');
      }
      return;
    }

    if (ubi === 'departamento') {
      const cod = e.target.selectedOptions?.[0]?.dataset.cod;
      const ciu = elDe('ciudad');
      if (!ciu || ciu.tagName !== 'SELECT') return;

      if (!cod) { ciu.innerHTML = '<option value="">Elige primero el departamento</option>'; return; }
      ciu.innerHTML = '<option value="">Cargando…</option>';
      try {
        const ms = await servicio.listarMunicipios(cod);
        ciu.innerHTML = '<option value="">Selecciona…</option>' +
          ms.map((m) => `<option>${seguro.texto(m.nombre)}</option>`).join('');
      } catch {
        ciu.innerHTML = '<option value="">No se pudieron cargar</option>';
      }
    }
  });

  /** Cambia un desplegable por un campo de texto, o al revés, sin
      perder su identificador. */
  function reemplazar(el, tag, contenido, ubi, marcador) {
    const nuevo = document.createElement(tag === 'select' ? 'select' : 'input');
    nuevo.className = 'fi';
    nuevo.id = el.id;
    nuevo.dataset.ubi = ubi;
    if (tag === 'select') nuevo.innerHTML = contenido;
    else { nuevo.type = 'text'; nuevo.placeholder = marcador || ''; nuevo.autocomplete = 'off'; }
    el.replaceWith(nuevo);
  }

  /* ── Plegado ─────────────────────────────────────────────────
     Ocupa mucho espacio, así que en reposo se muestra plegado: solo el
     nombre del formulario. Se abre solo cuando entra una llamada, y el
     agente puede abrirlo o cerrarlo a mano en cualquier momento. */

  let plegadoPorElAgente = false;    // respeta lo que el agente decidió

  function plegar(abrir, porElAgente = false) {
    const cuerpo = $('formCuerpo');
    const btn = $('btnFormPlegar');
    if (!cuerpo || !btn) return;

    cuerpo.style.display = abrir ? '' : 'none';
    btn.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    btn.classList.toggle('abierto', abrir);
    if (porElAgente) plegadoPorElAgente = !abrir;
  }

  $('btnFormPlegar')?.addEventListener('click', () => {
    /* Cerrarlo mientras no hay llamada es solo para ganar espacio: no
       debe impedir que se despliegue cuando entre la siguiente. Solo
       se respeta la decisión si la tomó durante una gestión. */
    const enGestion = telefonia.estado !== 'reposo' || !!ui.pendiente;
    plegar($('formCuerpo').style.display === 'none', enGestion);
  });

  /* ── Habilitar según la llamada ──────────────────────────────── */

  /** El formulario se llena durante la gestión, no en cualquier momento. */
  function habilitar() {
    if (!formAgente) return;
    const hayGestion = telefonia.estado !== 'reposo' || !!ui.pendiente;

    /* Al entrar la gestión se despliega solo, salvo que el agente lo
       haya cerrado a propósito. Al terminar, vuelve a plegarse. */
    if (hayGestion && !plegadoPorElAgente) plegar(true);
    if (!hayGestion) { plegar(false); plegadoPorElAgente = false; }

    $('formCampos').style.opacity = hayGestion ? '1' : '.5';
    $('formCampos').querySelectorAll('input, select, textarea')
      .forEach((el) => { el.disabled = !hayGestion; });
    $('btnFormGuardar').disabled = !hayGestion;
    $('formEspera').style.display = hayGestion ? 'none' : '';

    /* El Teléfono 1 llega puesto con el número de la llamada */
    const tel = formAgente.campos.find((c) => c.clave === 'telefono_1');
    if (hayGestion && tel) {
      const el = $('fc' + tel.id);
      if (el && !el.value && telefonia.numero) el.value = telefonia.numero;
    }
  }

  /* ── Guardar ─────────────────────────────────────────────────── */

  $('btnFormGuardar')?.addEventListener('click', async () => {
    if (!formAgente) return;

    const valores = {};
    formAgente.campos.forEach((c) => {
      const el = $('fc' + c.id);
      if (el) valores[c.id] = String(el.value || '').trim();
    });

    const btn = $('btnFormGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';

    try {
      await servicio.enviarRespuesta(formAgente.id, {
        valores,
        numero: telefonia.numero || ui.pendiente?.numero || null,
      });
      pintarCampos();                 // deja los campos en blanco
      aviso('Formulario guardado.', 'av-b');
    } catch (e) {
      /* El servidor devuelve qué campo falta o está mal */
      aviso(e.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar respuesta';
      habilitar();
    }
  });

  /* ── La cola de pendientes ─────────────────────────────────────── */

  function pintarPendientes() {
    const lista = servicio.pendientes();
    $('pendN').textContent = lista.length;
    $('pendN').className = 't ' + (lista.length ? 'a' : 'o');

    if (!lista.length) {
      $('listaPend').innerHTML = '<div class="vacio">No hay respuestas pendientes.</div>';
      return;
    }

    $('listaPend').innerHTML = lista.map((p) => `
      <div class="pend">
        <div class="pend-h">
          <b>${p.formulario}</b>
          <span class="t ${p.intentos ? 'r' : 'a'}">${p.intentos ? 'Falló ' + p.intentos + '×' : 'Pendiente'}</span>
        </div>
        <span class="pend-m">${p.numero} · ${new Date(p.creada).toLocaleTimeString('es-CO')}</span>
      </div>`).join('');
  }

  /* El servicio lanza una excepción cuando no hay conexión. Es el caso
     normal en un formulario offline, no un error: se captura y se
     informa sin romper nada. */
  /* Hay conexión si el backend está configurado en js/config.js.
     Mientras no lo esté, las respuestas se acumulan en la cola. */
  const hayServidor = () => !!CONFIG.api;

  async function intentarSincronizar() {
    try {
      const r = await servicio.sincronizar(hayServidor());
      pintarPendientes();
      return { ...r, fallidas: 0 };
    } catch (e) {
      pintarPendientes();
      return { enviadas: 0, fallidas: servicio.pendientes().length, motivo: e.message };
    }
  }

  $('btnSincronizar').addEventListener('click', async () => {
    const b = $('btnSincronizar');
    b.disabled = true; b.textContent = 'Enviando…';
    const r = await intentarSincronizar();
    b.disabled = false; b.textContent = 'Enviar pendientes';

    if (r.enviadas) aviso(`${r.enviadas} respuesta(s) enviada(s) al servidor.`, 'av-b');
    else if (r.fallidas) aviso(r.motivo || 'Sin conexión. Las respuestas siguen guardadas.', 'av-a');
    else aviso('No había nada pendiente.', 'av-b');
  });

  /* ═══════════════════════════════════════════════════════════════
     DISEÑADOR · solo el administrador

     Los formularios viven en la base de datos: el administrador los
     diseña desde cualquier equipo y los agentes los ven enseguida.

     Todo formulario nace con los diez datos del contacto —nombre,
     teléfonos, correo, tipo y número de documento, dirección, país,
     departamento y ciudad—. Se muestran de primeros y no se pueden
     borrar ni renombrar; el servidor también los protege, así que no
     basta con ocultar el botón.
     ═══════════════════════════════════════════════════════════════ */

  let listaForms = [];

  /* Tipos que el administrador puede elegir al añadir una pregunta. Los
     de ubicación no están: son propios de los campos fijos. */
  const TIPOS = [
    ['texto', 'Texto corto'], ['parrafo', 'Texto largo'], ['numero', 'Número'],
    ['fecha', 'Fecha'], ['lista', 'Lista desplegable'], ['si_no', 'Sí / No'],
    ['telefono', 'Teléfono'], ['correo', 'Correo'],
  ];
  const etiquetaTipo = (t) => (TIPOS.find((x) => x[0] === t) || [, t])[1];

  /* Los diez datos del contacto. Se muestran apenas se abre el editor,
     antes de guardar, para que el administrador vea de entrada qué va a
     llevar el formulario. Es una copia de lo que crea el servidor: el
     que manda es él, y al guardar se vuelven a leer de la base. */
  const CAMPOS_CONTACTO = [
    { clave:'nombre_contacto',  etiqueta:'Nombre del contacto',  tipo:'texto',    requerido:true,  opciones:[] },
    { clave:'telefono_1',       etiqueta:'Teléfono 1',           tipo:'telefono', requerido:true,  opciones:[] },
    { clave:'telefono_2',       etiqueta:'Teléfono 2',           tipo:'telefono', requerido:false, opciones:[] },
    { clave:'correo',           etiqueta:'Correo',               tipo:'correo',   requerido:false, opciones:[] },
    { clave:'tipo_documento',   etiqueta:'Tipo de documento',    tipo:'lista',    requerido:true,
      opciones:['CC','CE','TI','NIT','PA','PPT','RC'] },
    { clave:'numero_documento', etiqueta:'Número de documento',  tipo:'texto',    requerido:true,  opciones:[] },
    { clave:'direccion',        etiqueta:'Dirección',            tipo:'texto',    requerido:false, opciones:[] },
    { clave:'pais',             etiqueta:'País',                 tipo:'pais',     requerido:true,  opciones:[] },
    { clave:'departamento',     etiqueta:'Departamento',         tipo:'departamento', requerido:false, opciones:[] },
    { clave:'ciudad',           etiqueta:'Ciudad',               tipo:'ciudad',   requerido:true,  opciones:[] },
  ].map((c) => ({ ...c, fijo: true }));

  async function abrirDisenador() {
    await llenarCampanasEditor();
    await pintarLista();
  }

  async function llenarCampanasEditor() {
    let cs = [];
    try { cs = await servicio.listarCampanas(); } catch { /* queda solo "todas" */ }
    $('edCampana').innerHTML = '<option value="">Todas las campañas</option>' +
      cs.map((c) => `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('');
  }

  async function pintarLista() {
    $('listaForms').innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      listaForms = await servicio.listarFormularios();
    } catch (e) {
      $('listaForms').innerHTML =
        `<div class="vacio">No se pudieron cargar: ${seguro.texto(e.message)}</div>`;
      return;
    }

    $('listaForms').innerHTML = listaForms.length
      ? listaForms.map((f) => `
        <div class="fila-form" data-id="${seguro.texto(f.id)}">
          <div class="bd">
            <b>${seguro.texto(f.nombre)}</b>
            <span>${f.campana ? seguro.texto(f.campana) : 'Todas las campañas'} · ${seguro.texto(f.campos)} campos</span>
          </div>
          <span class="t g">Activo</span>
        </div>`).join('')
      : '<div class="vacio">Todavía no hay formularios.</div>';
  }

  $('listaForms').addEventListener('click', (e) => {
    const fila = e.target.closest('.fila-form');
    if (fila) abrirEditor(Number(fila.dataset.id));
  });

  $('btnFormNuevo').addEventListener('click', () => {
    /* El formulario aún no existe en la base: se arma en pantalla con
       los diez datos del contacto ya puestos, y se guarda completo. */
    editando = { id: null, nombre: '', campana_id: null, activo: true,
                 campos: CAMPOS_CONTACTO.map((c) => ({ ...c })) };

    $('editorForm').style.display = '';
    $('edTitulo').textContent = 'Nuevo formulario';
    $('edNombre').value = '';
    $('edCampana').value = '';
    $('edActivo').checked = true;
    $('edActivo').disabled = true;
    $('btnFormBorrar').style.display = 'none';
    pintarCamposEditor();
    $('edNombre').focus();
  });

  async function abrirEditor(id) {
    $('editorForm').style.display = '';
    $('edCampos').innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      editando = await servicio.leerFormulario(id);
    } catch (e) {
      aviso('No se pudo abrir el formulario: ' + e.message, 'av-a');
      $('editorForm').style.display = 'none';
      return;
    }
    $('edTitulo').textContent = editando.nombre;
    $('edNombre').value = editando.nombre;
    $('edCampana').value = editando.campana_id || '';
    $('edActivo').checked = !!editando.activo;
    $('edActivo').disabled = true;
    $('btnFormBorrar').style.display = '';
    pintarCamposEditor();
  }

  const propiosDe = () => editando.campos.filter((c) => !c.fijo);

  function pintarCamposEditor() {
    const fijos = editando.campos.filter((c) => c.fijo);
    const propios = propiosDe();

    const bloqueFijos = `
      <div class="campos-fijos">
        <div class="cf-tit">
          <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Datos del contacto · siempre presentes
        </div>
        <div class="cf-rejilla">
          ${fijos.map((c) => `
            <div class="cf-item">
              <b>${seguro.texto(c.etiqueta)}</b>
              <span>${seguro.texto(etiquetaTipo(c.tipo))} · ${c.requerido ? 'obligatorio' : 'opcional'}</span>
              ${(c.opciones || []).length ? `<span class="cf-op">${seguro.texto(c.opciones.join(' / '))}</span>` : ''}
            </div>`).join('')}
        </div>
      </div>`;

    const bloquePropios = propios.length
      ? propios.map((c, i) => `
        <div class="campo" data-i="${i}">
          <div class="campo-h">
            <input class="fi campo-et" data-k="etiqueta" value="${seguro.texto(c.etiqueta)}" placeholder="Pregunta">
            <button class="campo-b" data-a="subir" title="Subir">↑</button>
            <button class="campo-b" data-a="bajar" title="Bajar">↓</button>
            <button class="campo-b" data-a="quitar" title="Quitar">×</button>
          </div>
          <div class="campo-c">
            <select class="fi campo-tp" data-k="tipo">
              ${TIPOS.map(([v, et]) => `<option value="${v}"${c.tipo === v ? ' selected' : ''}>${et}</option>`).join('')}
            </select>
            <label class="chk"><input type="checkbox" data-k="requerido"${c.requerido ? ' checked' : ''}> Obligatorio</label>
            ${c.tipo === 'lista'
              ? `<input class="fi campo-op" data-k="opciones" value="${seguro.texto((c.opciones || []).join(', '))}" placeholder="Opciones separadas por coma">`
              : ''}
          </div>
        </div>`).join('')
      : '<div class="vacio">Sin preguntas propias. Añade la primera si la campaña las necesita.</div>';

    $('edCampos').innerHTML = bloqueFijos + bloquePropios;
  }

  $('edCampos').addEventListener('input', (e) => {
    const fila = e.target.closest('.campo');
    if (!fila || !editando) return;
    const c = propiosDe()[Number(fila.dataset.i)];
    const k = e.target.dataset.k;
    if (!c || !k) return;

    if (k === 'requerido') c.requerido = e.target.checked;
    else if (k === 'opciones') c.opciones = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
    else c[k] = e.target.value;

    if (k === 'tipo') pintarCamposEditor();
  });

  $('edCampos').addEventListener('change', (e) => {
    if (e.target.dataset.k !== 'requerido' || !editando) return;
    propiosDe()[Number(e.target.closest('.campo').dataset.i)].requerido = e.target.checked;
  });

  $('edCampos').addEventListener('click', (e) => {
    const b = e.target.closest('.campo-b');
    if (!b || !editando) return;
    const i = Number(b.closest('.campo').dataset.i);
    const fijos = editando.campos.filter((c) => c.fijo);
    const propios = propiosDe();

    if (b.dataset.a === 'quitar') propios.splice(i, 1);
    if (b.dataset.a === 'subir' && i > 0) [propios[i - 1], propios[i]] = [propios[i], propios[i - 1]];
    if (b.dataset.a === 'bajar' && i < propios.length - 1) [propios[i + 1], propios[i]] = [propios[i], propios[i + 1]];

    editando.campos = [...fijos, ...propios];
    pintarCamposEditor();
  });

  $('btnCampoNuevo').addEventListener('click', () => {
    if (!editando) {
      aviso('Pulsa Crear para empezar un formulario.', 'av-a');
      return;
    }
    editando.campos.push({ etiqueta: '', tipo: 'texto', requerido: false, fijo: false, opciones: [] });
    pintarCamposEditor();
  });

  $('btnFormSave').addEventListener('click', async () => {
    const nombre = $('edNombre').value.trim();
    if (nombre.length < 3) { aviso('El formulario necesita un nombre.', 'av-a'); return; }

    const campana_id = Number($('edCampana').value) || null;
    const btn = $('btnFormSave');
    btn.disabled = true; btn.textContent = 'Guardando…';

    try {
      if (!editando || !editando.id) {
        /* Nuevo: el servidor crea el formulario con sus campos fijos y
           después recibe las preguntas propias, si el administrador ya
           alcanzó a escribirlas. */
        const propios = propiosDe();
        const sinNombre = propios.findIndex((c) => !String(c.etiqueta).trim());
        if (sinNombre >= 0) { aviso(`La pregunta ${sinNombre + 1} no tiene texto.`, 'av-a'); return; }

        const r = await servicio.crearFormulario({ nombre, campana_id });
        if (propios.length) {
          await servicio.guardarFormulario(r.id, { nombre, campana_id, campos: propios });
        }
        await pintarLista();
        await abrirEditor(r.id);
        aviso(propios.length
          ? `Formulario creado con ${r.campos} datos del contacto y ${propios.length} pregunta(s) propia(s).`
          : `Formulario creado con los ${r.campos} datos del contacto.`, 'av-b');
      } else {
        const propios = propiosDe();
        const sinNombre = propios.findIndex((c) => !String(c.etiqueta).trim());
        if (sinNombre >= 0) { aviso(`La pregunta ${sinNombre + 1} no tiene texto.`, 'av-a'); return; }
        await servicio.guardarFormulario(editando.id, { nombre, campana_id, campos: propios });
        await pintarLista();
        aviso('Formulario guardado. Los agentes lo ven al recargar.', 'av-b');
      }
    } catch (e) {
      aviso('No se pudo guardar: ' + e.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar formulario';
    }
  });

  $('btnFormCancel').addEventListener('click', () => {
    $('editorForm').style.display = 'none';
    editando = null;
  });

  $('btnFormBorrar').addEventListener('click', async () => {
    if (!editando) return;
    if (!confirm(`¿Desactivar el formulario "${editando.nombre}"?\n\n` +
                 'Dejará de aparecer a los agentes. Las respuestas ya guardadas se conservan.')) return;
    try {
      await servicio.eliminarFormulario(editando.id);
      await pintarLista();
      $('editorForm').style.display = 'none';
      editando = null;
      aviso('Formulario desactivado.', 'av-b');
    } catch (e) {
      aviso('No se pudo desactivar: ' + e.message, 'av-a');
    }
  });

  return { abrirAgente, abrirDisenador, pintarPendientes,
           alCambiarLlamada: habilitar };
})();
