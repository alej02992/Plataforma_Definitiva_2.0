/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING · Flujos IVR · el diseñador

   Un lienzo donde se dibuja el recorrido de una llamada que entra:
   bloques unidos con flechas. Cada bloque tiene una entrada (a la
   izquierda) y una o varias salidas (a la derecha); una flecha va de
   una salida a la entrada de otro bloque.

   Fase 1: dibujar, configurar, revisar y guardar. Asterisk todavía no
   usa estos flujos; eso llega en la fase 2.

   Cómo se maneja:
     · Arrastrar un bloque desde la paleta, o hacer clic en él.
     · Mover un bloque arrastrándolo por su título.
     · Unir: arrastrar desde el punto de una salida hasta otro bloque.
     · Mover el lienzo: arrastrar el fondo. Acercar: rueda del ratón.
     · Borrar: seleccionar y pulsar Supr, o el botón del panel.
   ═══════════════════════════════════════════════════════════════════ */

const flujos = (() => {
  const $f = (id) => document.getElementById(id);

  /* ═══════════ LOS BLOQUES ═══════════

     salidas(config) → [[clave, etiqueta], …]. Las del menú dependen de
     sus opciones. Las "opcionales" pueden quedar sin flecha: tienen un
     comportamiento por defecto (por ejemplo, si nadie atiende en la
     campaña y no hay salida, se cuelga).                              */

  const ICONOS = {
    inicio: '<path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"/>',
    reproducir: '<path d="M11 5l-6 4h-2v6h2l6 4z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
    menu: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7h.01M12 7h.01M16 7h.01M8 11h.01M12 11h.01M16 11h.01M12 15h.01"/>',
    campana: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0 -3 -3.85"/>',
    persona: '<circle cx="12" cy="7" r="4"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>',
    horario: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    colgar: '<path d="M3 15c3.5 -3.5 14.5 -3.5 18 0l-2 3l-4 -1v-2.5a9 9 0 0 0 -6 0v2.5l-4 1z"/>',
  };

  const TIPOS = {
    inicio: {
      nombre: 'Inicio', color: '#00A0D6', unico: true, sinEntrada: true,
      ayuda: 'Por aquí entra la llamada. Hay uno solo y no se borra.',
      salidas: () => [['siguiente', 'Siguiente']],
      config: () => ({}),
    },
    reproducir: {
      nombre: 'Reproducir', color: '#7C5CDB',
      ayuda: 'Hace sonar un audio: la bienvenida, un aviso.',
      salidas: () => [['siguiente', 'Después']],
      config: () => ({ audio: '' }),
    },
    menu: {
      nombre: 'Menú', color: '#E08A00',
      ayuda: 'Reproduce las opciones y espera una tecla. Cada opción tiene su salida.',
      salidas: (c) => [
        ...(c.opciones || []).map((o) => ['op' + o.tecla, `${o.tecla}${o.etiqueta ? ' · ' + o.etiqueta : ''}`]),
        ['sin_respuesta', 'No marcó'],
        ['invalida', 'Tecla equivocada'],
      ],
      opcionales: ['sin_respuesta', 'invalida'],
      config: () => ({ audio: '', opciones: [{ tecla: '1', etiqueta: '' }, { tecla: '2', etiqueta: '' }],
                       espera: 5, intentos: 3 }),
    },
    campana: {
      nombre: 'Pasar a campaña', color: '#1A9E5C',
      ayuda: 'La llamada entra a la cola de la campaña y la atiende un agente libre.',
      salidas: () => [['no_atendida', 'Nadie atendió']],
      opcionales: ['no_atendida'],
      config: () => ({ campana_id: '', espera: 300 }),
    },
    persona: {
      nombre: 'Pasar a una persona', color: '#1A9E5C',
      ayuda: 'Llama a la extensión de alguien en concreto: un supervisor, un agente.',
      salidas: () => [['no_contesta', 'No contesta']],
      opcionales: ['no_contesta'],
      config: () => ({ extension: '', timbre: 25 }),
    },
    horario: {
      nombre: 'Horario', color: '#2B7BB9',
      ayuda: 'Separa las llamadas que entran dentro y fuera del horario de atención.',
      salidas: () => [['dentro', 'Dentro del horario'], ['fuera', 'Fuera del horario']],
      config: () => ({ dias: ['L', 'M', 'X', 'J', 'V'], desde: '08:00', hasta: '18:00' }),
    },
    colgar: {
      nombre: 'Colgar', color: '#C62828',
      ayuda: 'Termina la llamada.',
      salidas: () => [],
      config: () => ({}),
    },
  };

  const ORDEN_PALETA = ['reproducir', 'menu', 'campana', 'persona', 'horario', 'colgar'];
  const DIAS = [['L', 'Lun'], ['M', 'Mar'], ['X', 'Mié'], ['J', 'Jue'], ['V', 'Vie'], ['S', 'Sáb'], ['D', 'Dom']];
  const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'];

  /* ═══════════ ESTADO ═══════════ */

  let lista = [];
  let actual = null;              // { id, nombre, descripcion, diseno: { nodos, flechas } }
  let sel = null;                 // { tipo: 'nodo', id } | { tipo: 'flecha', i }
  let cambios = false;
  let vista = { x: 40, y: 20, z: 1 };
  let recursos = { campanas: [], personas: [], audios: [] };
  let problemas = [];

  const nodo = (id) => actual.diseno.nodos.find((n) => n.id === id);
  const nuevoId = (tipo) => `${tipo}_${Math.random().toString(36).slice(2, 7)}`;
  const esc = (t) => seguro.texto(t ?? '');

  /* ═══════════ ENTRAR AL MÓDULO ═══════════ */

  async function abrir() {
    if (!$f('flLista')) return;
    mostrarLista();
    await cargarLista();
  }

  function mostrarLista() {
    $f('flLista').style.display = '';
    $f('flEditor').style.display = 'none';
  }

  async function cargarLista() {
    $f('flTabla').innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      lista = await servicio.listarFlujos();
    } catch (e) {
      $f('flTabla').innerHTML = `<div class="aviso av-r"><div>${esc(e.message)}</div></div>`;
      return;
    }
    if (!lista.length) {
      $f('flTabla').innerHTML = `<div class="vacio">Todavía no hay flujos. Crea el primero con
        <b>Nuevo flujo</b>: por ejemplo, una bienvenida con un menú de tres opciones.</div>`;
      return;
    }
    const cuando = (f) => String(f.modificado || '').replace('T', ' ').slice(0, 16);
    $f('flTabla').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Flujo</th><th>Bloques</th><th>Revisión</th><th>Estado</th><th>Última modificación</th><th></th></tr>
      ${lista.map((f) => `<tr>
        <td><b>${esc(f.nombre)}</b>${f.descripcion ? `<div class="hint">${esc(f.descripcion)}</div>` : ''}</td>
        <td class="mono">${esc(f.bloques)}</td>
        <td>${f.pendientes ? `<span class="t a">${esc(f.pendientes)} pendiente${f.pendientes === 1 ? '' : 's'}</span>`
                            : '<span class="t g">Completo</span>'}</td>
        <td><span class="t ${f.estado === 'activo' ? 'g' : 'o'}">${f.estado === 'activo' ? 'Activo' : 'Borrador'}</span></td>
        <td>${esc(cuando(f))}${f.modificado_por ? `<div class="hint">${esc(f.modificado_por)}</div>` : ''}</td>
        <td style="white-space:nowrap">
          <button class="b b-teal b-sm" data-abrir="${esc(f.id)}">Abrir</button>
          <button class="b b-gh b-sm" data-duplicar="${esc(f.id)}">Duplicar</button>
          <button class="b b-gh b-sm" data-eliminar="${esc(f.id)}">Eliminar</button></td>
      </tr>`).join('')}</table></div>`;
  }

  $f('flTabla')?.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.abrir) return abrirEditor(Number(b.dataset.abrir));

    if (b.dataset.duplicar) {
      try {
        const r = await servicio.duplicarFlujo(b.dataset.duplicar);
        aviso(`Se creó "${r.nombre}".`, 'av-b');
        await cargarLista();
      } catch (err) { aviso(err.message, 'av-a'); }
    }

    if (b.dataset.eliminar) {
      const f = lista.find((x) => String(x.id) === b.dataset.eliminar);
      if (!confirm(`¿Eliminar el flujo "${f?.nombre}"?\n\nEsto no se puede deshacer.`)) return;
      try {
        await servicio.eliminarFlujo(b.dataset.eliminar);
        aviso('Flujo eliminado.', 'av-b');
        await cargarLista();
      } catch (err) { aviso(err.message, 'av-a'); }
    }
  });

  $f('btnFlNuevo')?.addEventListener('click', async () => {
    const nombre = (prompt('Nombre del flujo nuevo:\n\nPor ejemplo: "Línea principal" o "Soporte fuera de horario".') || '').trim();
    if (!nombre) return;
    try {
      const r = await servicio.crearFlujo({ nombre });
      await abrirEditor(r.id);
    } catch (err) { aviso(err.message, 'av-a'); }
  });

  /* ═══════════ EL EDITOR ═══════════ */

  async function abrirEditor(id) {
    try {
      const [f, campanas, usuarios, audios] = await Promise.all([
        servicio.leerFlujo(id),
        servicio.listarCampanas().catch(() => []),
        servicio.listarUsuarios().catch(() => []),
        servicio.listarAudios().catch(() => ({ audios: [] })),
      ]);
      actual = f;
      recursos = {
        campanas: campanas || [],
        personas: (usuarios || []).filter((u) => u.extension && u.activo !== false),
        audios: (audios && audios.audios) || [],
      };
    } catch (e) {
      aviso(e.message, 'av-a');
      return;
    }

    sel = null;
    cambios = false;
    $f('flNombre').value = actual.nombre;
    $f('flLista').style.display = 'none';
    $f('flEditor').style.display = '';
    pintarPaleta();
    dibujar();
    centrar();
    pintarPropiedades();
  }

  function marcarCambio() {
    cambios = true;
    $f('flEstado').textContent = 'Sin guardar';
    $f('flEstado').className = 't a';
  }

  $f('btnFlVolver')?.addEventListener('click', async () => {
    if (cambios && !confirm('Hay cambios sin guardar. ¿Salir de todas formas?')) return;
    actual = null;
    mostrarLista();
    await cargarLista();
  });

  $f('flNombre')?.addEventListener('input', marcarCambio);

  $f('btnFlGuardar')?.addEventListener('click', async () => {
    const btn = $f('btnFlGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      revisar();
      await servicio.guardarFlujo(actual.id, {
        nombre: $f('flNombre').value.trim(),
        descripcion: actual.descripcion || '',
        diseno: actual.diseno,
        pendientes: problemas.length,
      });
      cambios = false;
      $f('flEstado').textContent = problemas.length ? `${problemas.length} pendiente${problemas.length === 1 ? '' : 's'}` : 'Guardado';
      $f('flEstado').className = problemas.length ? 't a' : 't g';
      aviso(problemas.length
        ? `Guardado. Le faltan ${problemas.length} cosa${problemas.length === 1 ? '' : 's'}: están marcadas en rojo.`
        : 'Guardado. El flujo está completo.', problemas.length ? 'av-a' : 'av-b');
    } catch (err) {
      aviso(err.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  });

  /* ═══════════ LA PALETA ═══════════ */

  function pintarPaleta() {
    $f('flPaleta').innerHTML = `<div class="fl-paleta-t">Bloques</div>` +
      ORDEN_PALETA.map((t) => `
        <div class="fl-bloque" draggable="true" data-tipo="${t}" title="${esc(TIPOS[t].ayuda)}">
          <span class="fl-ico" style="background:${TIPOS[t].color}">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round" aria-hidden="true">${ICONOS[t]}</svg></span>
          <span>${esc(TIPOS[t].nombre)}</span>
        </div>`).join('') +
      `<div class="fl-paleta-ayuda">Arrastra un bloque al lienzo, o haz clic para agregarlo.
        Une los bloques arrastrando desde el punto de una salida.</div>`;
  }

  function agregarBloque(tipo, x, y) {
    const n = { id: nuevoId(tipo), tipo, x: Math.round(x), y: Math.round(y), config: TIPOS[tipo].config() };
    actual.diseno.nodos.push(n);
    sel = { tipo: 'nodo', id: n.id };
    marcarCambio();
    dibujar();
    pintarPropiedades();
  }

  $f('flPaleta')?.addEventListener('dragstart', (e) => {
    const b = e.target.closest('.fl-bloque');
    if (b) e.dataTransfer.setData('text/plain', b.dataset.tipo);
  });

  $f('flPaleta')?.addEventListener('click', (e) => {
    const b = e.target.closest('.fl-bloque');
    if (!b) return;
    /* Al centro de lo que se está viendo, un poco corrido para que dos
       clics seguidos no dejen un bloque encima del otro. */
    const r = $f('flLienzo').getBoundingClientRect();
    const p = aMundo(r.left + r.width / 2, r.top + r.height / 2);
    const corrimiento = (actual.diseno.nodos.length % 5) * 24;
    agregarBloque(b.dataset.tipo, p.x - 100 + corrimiento, p.y - 40 + corrimiento);
  });

  $f('flLienzo')?.addEventListener('dragover', (e) => e.preventDefault());
  $f('flLienzo')?.addEventListener('drop', (e) => {
    e.preventDefault();
    const tipo = e.dataTransfer.getData('text/plain');
    if (!TIPOS[tipo] || TIPOS[tipo].unico) return;
    const p = aMundo(e.clientX, e.clientY);
    agregarBloque(tipo, p.x - 100, p.y - 20);
  });

  /* ═══════════ DIBUJAR ═══════════ */

  const aMundo = (cx, cy) => {
    const r = $f('flLienzo').getBoundingClientRect();
    return { x: (cx - r.left - vista.x) / vista.z, y: (cy - r.top - vista.y) / vista.z };
  };

  function aplicarVista() {
    $f('flMundo').style.transform = `translate(${vista.x}px, ${vista.y}px) scale(${vista.z})`;
    $f('flZoomTxt').textContent = Math.round(vista.z * 100) + '%';
  }

  /** El texto corto que se ve dentro de cada bloque. */
  function resumen(n) {
    const c = n.config || {};
    const audio = (a) => (a ? String(a).replace(/\.(ulaw|wav|gsm|mp3)$/i, '') : '');
    switch (n.tipo) {
      case 'inicio': return 'La llamada entra aquí';
      case 'reproducir': return c.audio ? `🔊 ${audio(c.audio)}` : 'Elige un audio';
      case 'menu': return c.audio ? `🔊 ${audio(c.audio)}` : 'Elige el audio del menú';
      case 'campana': {
        const cp = recursos.campanas.find((x) => String(x.id) === String(c.campana_id));
        return cp ? cp.nombre : 'Elige una campaña';
      }
      case 'persona': {
        const p = recursos.personas.find((x) => String(x.extension) === String(c.extension));
        return p ? `${p.nombre} · ext. ${p.extension}` : 'Elige a quién';
      }
      case 'horario': {
        const d = (c.dias || []);
        return `${d.length === 7 ? 'Todos los días' : d.join(' ') || 'Sin días'} · ${c.desde || '?'}–${c.hasta || '?'}`;
      }
      case 'colgar': return 'Termina la llamada';
      default: return '';
    }
  }

  function dibujar() {
    revisar();
    const conProblema = new Set(problemas.map((p) => p.nodo).filter(Boolean));

    $f('flNodos').innerHTML = actual.diseno.nodos.map((n) => {
      const t = TIPOS[n.tipo];
      const salidas = t.salidas(n.config || {});
      const elegido = sel?.tipo === 'nodo' && sel.id === n.id;
      return `
      <div class="fl-nodo${elegido ? ' on' : ''}${conProblema.has(n.id) ? ' fl-error' : ''}"
           data-id="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;--c:${t.color}">
        <div class="fl-nodo-h" data-mover="${esc(n.id)}">
          ${t.sinEntrada ? '' : `<span class="fl-entrada" data-entrada="${esc(n.id)}"></span>`}
          <span class="fl-ico" style="background:${t.color}">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"
                 stroke-linejoin="round" aria-hidden="true">${ICONOS[n.tipo]}</svg></span>
          <b>${esc(t.nombre)}</b>
        </div>
        <div class="fl-nodo-r">${esc(resumen(n))}</div>
        ${salidas.length ? `<div class="fl-salidas">${salidas.map(([clave, et]) => `
          <div class="fl-salida"><span>${esc(et)}</span>
            <span class="fl-puerto${tieneFlecha(n.id, clave) ? ' unido' : ''}" data-desde="${esc(n.id)}"
                  data-salida="${esc(clave)}" title="Arrastra hasta otro bloque"></span></div>`).join('')}</div>` : ''}
      </div>`;
    }).join('');

    /* El zoom va antes que las flechas: sus puntas se calculan con la
       posición en pantalla de cada punto, que depende del zoom. */
    aplicarVista();
    dibujarFlechas();
    pintarPendientes();
  }

  const tieneFlecha = (id, salida) => actual.diseno.flechas.some((f) => f.desde === id && f.salida === salida);

  /** El centro de un elemento, en coordenadas del lienzo. */
  function centro(el) {
    const r = el.getBoundingClientRect();
    return aMundo(r.left + r.width / 2, r.top + r.height / 2);
  }

  const curva = (a, b) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  function dibujarFlechas() {
    const svg = $f('flLineas');
    const partes = [];
    actual.diseno.flechas.forEach((f, i) => {
      const p = $f('flNodos').querySelector(`.fl-puerto[data-desde="${CSS.escape(f.desde)}"][data-salida="${CSS.escape(f.salida)}"]`);
      const e = $f('flNodos').querySelector(`.fl-entrada[data-entrada="${CSS.escape(f.hacia)}"]`);
      if (!p || !e) return;
      const d = curva(centro(p), centro(e));
      const elegida = sel?.tipo === 'flecha' && sel.i === i;
      partes.push(`<path d="${d}" class="fl-linea${elegida ? ' on' : ''}" marker-end="url(#flPunta${elegida ? 'On' : ''})"/>
                   <path d="${d}" class="fl-linea-toque" data-flecha="${i}"/>`);
    });
    svg.innerHTML = `<defs>
      <marker id="flPunta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0 L10 5 L0 10 z" fill="#8B979F"/></marker>
      <marker id="flPuntaOn" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0 L10 5 L0 10 z" fill="#00A0D6"/></marker></defs>
      ${partes.join('')}<path id="flTemporal" class="fl-linea temporal" d=""/>`;
  }

  /* ═══════════ ARRASTRAR: MOVER, UNIR, DESPLAZAR ═══════════ */

  let gesto = null;

  $f('flLienzo')?.addEventListener('pointerdown', (e) => {
    if (!actual || e.button !== 0) return;

    const puerto = e.target.closest('.fl-puerto');
    const cabeza = e.target.closest('[data-mover]');
    const flecha = e.target.closest('[data-flecha]');
    const caja = e.target.closest('.fl-nodo');

    if (puerto) {
      gesto = { tipo: 'unir', desde: puerto.dataset.desde, salida: puerto.dataset.salida, origen: centro(puerto) };
    } else if (cabeza) {
      const n = nodo(cabeza.dataset.mover);
      const p = aMundo(e.clientX, e.clientY);
      gesto = { tipo: 'mover', id: n.id, dx: p.x - n.x, dy: p.y - n.y, movio: false };
      seleccionar({ tipo: 'nodo', id: n.id }, false);
    } else if (flecha) {
      seleccionar({ tipo: 'flecha', i: Number(flecha.dataset.flecha) });
      return;
    } else if (caja) {
      seleccionar({ tipo: 'nodo', id: caja.dataset.id });
      return;
    } else {
      gesto = { tipo: 'desplazar', x: e.clientX - vista.x, y: e.clientY - vista.y, movio: false };
    }
    $f('flLienzo').setPointerCapture(e.pointerId);
  });

  $f('flLienzo')?.addEventListener('pointermove', (e) => {
    if (!gesto) return;
    if (gesto.tipo === 'desplazar') {
      vista.x = e.clientX - gesto.x;
      vista.y = e.clientY - gesto.y;
      gesto.movio = true;
      aplicarVista();
    } else if (gesto.tipo === 'mover') {
      const n = nodo(gesto.id);
      const p = aMundo(e.clientX, e.clientY);
      /* Se acomoda a una rejilla de 8 px: los flujos quedan alineados */
      n.x = Math.round((p.x - gesto.dx) / 8) * 8;
      n.y = Math.round((p.y - gesto.dy) / 8) * 8;
      const el = $f('flNodos').querySelector(`.fl-nodo[data-id="${CSS.escape(n.id)}"]`);
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      gesto.movio = true;
      dibujarFlechas();
    } else if (gesto.tipo === 'unir') {
      $f('flTemporal').setAttribute('d', curva(gesto.origen, aMundo(e.clientX, e.clientY)));
    }
  });

  $f('flLienzo')?.addEventListener('pointerup', (e) => {
    if (!gesto) return;
    const g = gesto;
    gesto = null;

    if (g.tipo === 'mover' && g.movio) marcarCambio();
    if (g.tipo === 'desplazar' && !g.movio) seleccionar(null);

    if (g.tipo === 'unir') {
      $f('flTemporal')?.setAttribute('d', '');
      const destino = document.elementFromPoint(e.clientX, e.clientY)?.closest('.fl-nodo');
      if (!destino) return;
      const hacia = destino.dataset.id;
      if (hacia === g.desde) return aviso('Un bloque no puede apuntar a sí mismo.', 'av-a');
      if (TIPOS[nodo(hacia).tipo].sinEntrada) return aviso('El inicio no recibe flechas: es por donde entra la llamada.', 'av-a');

      /* De cada salida sale una sola flecha: la nueva reemplaza a la anterior */
      actual.diseno.flechas = actual.diseno.flechas.filter((f) => !(f.desde === g.desde && f.salida === g.salida));
      actual.diseno.flechas.push({ desde: g.desde, salida: g.salida, hacia });
      marcarCambio();
      dibujar();
    }
  });

  /* Acercar y alejar con la rueda, alrededor del puntero */
  $f('flLienzo')?.addEventListener('wheel', (e) => {
    if (!actual) return;
    e.preventDefault();
    const antes = aMundo(e.clientX, e.clientY);
    vista.z = Math.min(1.6, Math.max(0.4, vista.z * (e.deltaY < 0 ? 1.1 : 0.9)));
    const r = $f('flLienzo').getBoundingClientRect();
    vista.x = e.clientX - r.left - antes.x * vista.z;
    vista.y = e.clientY - r.top - antes.y * vista.z;
    aplicarVista();
  }, { passive: false });

  function zoom(factor) {
    const r = $f('flLienzo').getBoundingClientRect();
    const c = aMundo(r.left + r.width / 2, r.top + r.height / 2);
    vista.z = Math.min(1.6, Math.max(0.4, vista.z * factor));
    vista.x = r.width / 2 - c.x * vista.z;
    vista.y = r.height / 2 - c.y * vista.z;
    aplicarVista();
  }

  /** Encuadra todo el flujo en la pantalla. */
  function centrar() {
    const ns = actual.diseno.nodos;
    if (!ns.length) return;
    const r = $f('flLienzo').getBoundingClientRect();
    const minX = Math.min(...ns.map((n) => n.x)), minY = Math.min(...ns.map((n) => n.y));
    const maxX = Math.max(...ns.map((n) => n.x + 220)), maxY = Math.max(...ns.map((n) => n.y + 160));
    vista.z = Math.min(1, Math.max(0.4, Math.min(r.width / (maxX - minX + 80), r.height / (maxY - minY + 80))));
    vista.x = (r.width - (maxX - minX) * vista.z) / 2 - minX * vista.z;
    vista.y = (r.height - (maxY - minY) * vista.z) / 2 - minY * vista.z;
    aplicarVista();
    dibujarFlechas();
  }

  $f('flZoomMas')?.addEventListener('click', () => zoom(1.15));
  $f('flZoomMenos')?.addEventListener('click', () => zoom(0.87));
  $f('flCentrar')?.addEventListener('click', centrar);

  /* ═══════════ SELECCIONAR Y BORRAR ═══════════ */

  function seleccionar(s, repintar = true) {
    sel = s;
    if (repintar) dibujar();
    else {
      $f('flNodos').querySelectorAll('.fl-nodo').forEach((el) =>
        el.classList.toggle('on', s?.tipo === 'nodo' && el.dataset.id === s.id));
    }
    pintarPropiedades();
  }

  function borrarSeleccion() {
    if (!sel) return;
    if (sel.tipo === 'flecha') {
      actual.diseno.flechas.splice(sel.i, 1);
    } else {
      const n = nodo(sel.id);
      if (!n || TIPOS[n.tipo].unico) return aviso('El inicio no se puede borrar.', 'av-a');
      actual.diseno.nodos = actual.diseno.nodos.filter((x) => x.id !== n.id);
      actual.diseno.flechas = actual.diseno.flechas.filter((f) => f.desde !== n.id && f.hacia !== n.id);
    }
    sel = null;
    marcarCambio();
    dibujar();
    pintarPropiedades();
  }

  document.addEventListener('keydown', (e) => {
    if (!actual || $f('flEditor')?.style.display === 'none') return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); borrarSeleccion(); }
  });

  /* ═══════════ EL PANEL DE OPCIONES ═══════════ */

  function opcionesAudio(elegido) {
    const lista2 = recursos.audios.map((a) => a.archivo);
    if (elegido && !lista2.includes(elegido)) lista2.unshift(elegido);
    return '<option value="">Elige un audio…</option>' + lista2.map((a) =>
      `<option value="${esc(a)}"${a === elegido ? ' selected' : ''}>${esc(a)}</option>`).join('');
  }

  function pintarPropiedades() {
    const p = $f('flProps');
    if (!actual) { p.innerHTML = ''; return; }

    if (sel?.tipo === 'flecha') {
      const f = actual.diseno.flechas[sel.i];
      const de = f && nodo(f.desde), a = f && nodo(f.hacia);
      p.innerHTML = `<div class="fl-props-t">Flecha</div>
        <p class="hint">De <b>${esc(de ? TIPOS[de.tipo].nombre : '')}</b> a <b>${esc(a ? TIPOS[a.tipo].nombre : '')}</b>.</p>
        <button class="b b-gh b-sm" data-accion="borrar">Quitar flecha</button>`;
      return;
    }

    if (sel?.tipo !== 'nodo' || !nodo(sel.id)) {
      p.innerHTML = `<div class="fl-props-t">Opciones</div>
        <p class="hint">Selecciona un bloque para configurarlo.</p>
        <p class="hint">Un flujo típico: <b>Inicio → Reproducir</b> la bienvenida → <b>Menú</b> con sus
          opciones → <b>Pasar a campaña</b> o <b>a una persona</b> en cada una.</p>`;
      return;
    }

    const n = nodo(sel.id);
    const t = TIPOS[n.tipo];
    const c = n.config;
    let campos = '';

    if (n.tipo === 'reproducir') {
      campos = `<div class="f"><label>Audio</label><select class="fi" data-c="audio">${opcionesAudio(c.audio)}</select>
        <div class="hint">Los audios son los mismos del blaster.</div></div>`;
    }

    if (n.tipo === 'menu') {
      campos = `
        <div class="f"><label>Audio del menú</label><select class="fi" data-c="audio">${opcionesAudio(c.audio)}</select>
          <div class="hint">El que dice las opciones: "marque 1 para…".</div></div>
        <div class="f"><label>Opciones</label>
          ${(c.opciones || []).map((o, i) => `
            <div class="fl-op">
              <select class="fi mono" data-op="${i}" data-campo="tecla">${TECLAS.map((k) =>
                `<option${k === o.tecla ? ' selected' : ''}>${k}</option>`).join('')}</select>
              <input class="fi" data-op="${i}" data-campo="etiqueta" value="${esc(o.etiqueta)}" placeholder="Para qué es (Ventas…)">
              <button class="b b-gh b-sm" data-quitar-op="${i}" title="Quitar">✕</button>
            </div>`).join('')}
          ${(c.opciones || []).length < 12 ? '<button class="b b-gh b-sm" data-accion="op">+ Agregar opción</button>' : ''}
        </div>
        <div class="rej rej-2">
          <div class="f"><label>Espera</label><input class="fi" type="number" min="2" max="30" data-c="espera" value="${esc(c.espera)}">
            <div class="hint">Segundos para marcar</div></div>
          <div class="f"><label>Intentos</label><input class="fi" type="number" min="1" max="5" data-c="intentos" value="${esc(c.intentos)}">
            <div class="hint">Veces que repite el menú</div></div>
        </div>
        <p class="hint">Si no marca o marca una tecla que no está, el menú se repite. Al acabarse los
          intentos sigue por <b>No marcó</b> o <b>Tecla equivocada</b>; sin flecha ahí, cuelga.</p>`;
    }

    if (n.tipo === 'campana') {
      campos = `
        <div class="f"><label>Campaña</label><select class="fi" data-c="campana_id">
          <option value="">Elige una campaña…</option>
          ${recursos.campanas.map((cp) => `<option value="${esc(cp.id)}"${String(cp.id) === String(c.campana_id) ? ' selected' : ''}>${esc(cp.nombre)}</option>`).join('')}
        </select></div>
        <div class="f"><label>Espera máxima en cola</label>
          <input class="fi" type="number" min="15" max="1800" data-c="espera" value="${esc(c.espera)}">
          <div class="hint">Segundos. Si nadie atiende, sigue por <b>Nadie atendió</b>; sin flecha ahí, cuelga.</div></div>`;
    }

    if (n.tipo === 'persona') {
      campos = `
        <div class="f"><label>Persona</label><select class="fi" data-c="extension">
          <option value="">Elige a quién…</option>
          ${recursos.personas.map((u) => `<option value="${esc(u.extension)}"${String(u.extension) === String(c.extension) ? ' selected' : ''}>${esc(u.nombre)} · ext. ${esc(u.extension)}${u.rol && u.rol !== 'agente' ? ` · ${esc(u.rol)}` : ''}</option>`).join('')}
        </select></div>
        <div class="f"><label>Timbrar durante</label>
          <input class="fi" type="number" min="5" max="120" data-c="timbre" value="${esc(c.timbre)}">
          <div class="hint">Segundos. Si no contesta, sigue por <b>No contesta</b>; sin flecha ahí, cuelga.</div></div>`;
    }

    if (n.tipo === 'horario') {
      campos = `
        <div class="f"><label>Días de atención</label><div class="fl-dias">
          ${DIAS.map(([k, et]) => `<label class="fl-dia"><input type="checkbox" data-dia="${k}"${(c.dias || []).includes(k) ? ' checked' : ''}>${et}</label>`).join('')}
        </div></div>
        <div class="rej rej-2">
          <div class="f"><label>Desde</label><input class="fi" type="time" data-c="desde" value="${esc(c.desde)}"></div>
          <div class="f"><label>Hasta</label><input class="fi" type="time" data-c="hasta" value="${esc(c.hasta)}"></div>
        </div>`;
    }

    const suyos = problemas.filter((x) => x.nodo === n.id);
    p.innerHTML = `
      <div class="fl-props-t"><span class="fl-ico" style="background:${t.color}">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"
             stroke-linejoin="round" aria-hidden="true">${ICONOS[n.tipo]}</svg></span>${esc(t.nombre)}</div>
      <p class="hint">${esc(t.ayuda)}</p>
      ${suyos.length ? `<div class="aviso av-a" style="margin:0 0 10px"><div>${suyos.map((x) => esc(x.texto)).join('<br>')}</div></div>` : ''}
      ${campos}
      ${t.unico ? '' : '<button class="b b-gh b-sm" data-accion="borrar" style="margin-top:6px">Borrar bloque</button>'}`;
  }

  /* Los cambios del panel van directo al bloque */
  $f('flProps')?.addEventListener('input', (e) => cambiarPropiedad(e, false));
  $f('flProps')?.addEventListener('change', (e) => cambiarPropiedad(e, true));

  function cambiarPropiedad(e, completo) {
    if (sel?.tipo !== 'nodo') return;
    const n = nodo(sel.id);
    const el = e.target;

    if (el.dataset.c) {
      n.config[el.dataset.c] = el.type === 'number' ? Number(el.value) : el.value;
    } else if (el.dataset.dia) {
      const dias = new Set(n.config.dias || []);
      el.checked ? dias.add(el.dataset.dia) : dias.delete(el.dataset.dia);
      n.config.dias = DIAS.map(([k]) => k).filter((k) => dias.has(k));
    } else if (el.dataset.op !== undefined) {
      const o = n.config.opciones[Number(el.dataset.op)];
      if (el.dataset.campo === 'tecla') {
        if (n.config.opciones.some((x) => x !== o && x.tecla === el.value)) {
          aviso(`La tecla ${el.value} ya está usada en este menú.`, 'av-a');
          el.value = o.tecla;
          return;
        }
        /* La flecha de esa opción se va con ella a la tecla nueva */
        actual.diseno.flechas.forEach((f) => {
          if (f.desde === n.id && f.salida === 'op' + o.tecla) f.salida = 'op' + el.value;
        });
        o.tecla = el.value;
      } else {
        o.etiqueta = el.value.slice(0, 30);
      }
    } else {
      return;
    }

    marcarCambio();
    /* Al escribir, se repinta el lienzo pero no el panel: así no se pierde
       el cursor. Al terminar el cambio, se repinta todo. */
    dibujar();
    if (completo) pintarPropiedades();
  }

  $f('flProps')?.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.accion === 'borrar') return borrarSeleccion();

    const n = sel?.tipo === 'nodo' && nodo(sel.id);
    if (!n) return;
    if (b.dataset.accion === 'op') {
      const libre = TECLAS.find((k) => !n.config.opciones.some((o) => o.tecla === k));
      if (!libre) return;
      n.config.opciones.push({ tecla: libre, etiqueta: '' });
    }
    if (b.dataset.quitarOp !== undefined) {
      const o = n.config.opciones[Number(b.dataset.quitarOp)];
      n.config.opciones.splice(Number(b.dataset.quitarOp), 1);
      actual.diseno.flechas = actual.diseno.flechas.filter((f) => !(f.desde === n.id && f.salida === 'op' + o.tecla));
    }
    marcarCambio();
    dibujar();
    pintarPropiedades();
  });

  /* ═══════════ REVISAR ═══════════

     Lo que le falta al flujo para poder funcionar. Se revisa con cada
     cambio y los bloques con problemas se marcan en rojo. Un flujo con
     pendientes se puede guardar —es un borrador—, pero en la fase 2 no
     se podrá activar.                                                  */

  function revisar() {
    const P = [];
    const { nodos, flechas } = actual.diseno;
    const salientes = (id) => flechas.filter((f) => f.desde === id);

    nodos.forEach((n) => {
      const t = TIPOS[n.tipo];
      const c = n.config || {};
      const nombre = t.nombre;

      /* Salidas obligatorias sin flecha */
      t.salidas(c).forEach(([clave, et]) => {
        if ((t.opcionales || []).includes(clave)) return;
        if (!salientes(n.id).some((f) => f.salida === clave)) {
          P.push({ nodo: n.id, texto: `${nombre}: la salida "${et}" no va a ningún lado` });
        }
      });

      /* Lo que cada bloque necesita tener configurado */
      if (n.tipo === 'reproducir' && !c.audio) P.push({ nodo: n.id, texto: 'Reproducir: falta elegir el audio' });
      if (n.tipo === 'menu') {
        if (!c.audio) P.push({ nodo: n.id, texto: 'Menú: falta el audio con las opciones' });
        if (!(c.opciones || []).length) P.push({ nodo: n.id, texto: 'Menú: no tiene opciones' });
      }
      if (n.tipo === 'campana' && !recursos.campanas.some((x) => String(x.id) === String(c.campana_id))) {
        P.push({ nodo: n.id, texto: c.campana_id ? 'Pasar a campaña: esa campaña ya no está activa'
                                                  : 'Pasar a campaña: falta elegir la campaña' });
      }
      if (n.tipo === 'persona' && !recursos.personas.some((x) => String(x.extension) === String(c.extension))) {
        P.push({ nodo: n.id, texto: c.extension ? 'Pasar a una persona: esa extensión ya no existe'
                                                 : 'Pasar a una persona: falta elegir a quién' });
      }
      if (n.tipo === 'horario') {
        if (!(c.dias || []).length) P.push({ nodo: n.id, texto: 'Horario: no tiene días de atención' });
        if (!c.desde || !c.hasta || c.desde >= c.hasta) P.push({ nodo: n.id, texto: 'Horario: la hora de inicio debe ser antes de la de fin' });
      }
    });

    /* Bloques a los que nunca llega la llamada */
    const inicio = nodos.find((n) => n.tipo === 'inicio');
    const alcanzados = new Set();
    const pila = inicio ? [inicio.id] : [];
    while (pila.length) {
      const id = pila.pop();
      if (alcanzados.has(id)) continue;
      alcanzados.add(id);
      salientes(id).forEach((f) => pila.push(f.hacia));
    }
    nodos.forEach((n) => {
      if (!alcanzados.has(n.id)) P.push({ nodo: n.id, texto: `${TIPOS[n.tipo].nombre}: la llamada nunca llega a este bloque` });
    });

    /* Vueltas sin salida: audios u horarios que se llaman entre sí para
       siempre, sin un menú ni una transferencia en medio. */
    const sinFin = new Set(['reproducir', 'horario']);
    const color = {};
    const visitar = (id, camino) => {
      color[id] = 1;
      for (const f of salientes(id)) {
        const h = nodo(f.hacia);
        if (!h || !sinFin.has(h.tipo)) continue;
        if (color[h.id] === 1) {
          camino.slice(camino.indexOf(h.id)).forEach((x) =>
            P.push({ nodo: x, texto: 'Este bloque forma una vuelta sin fin: la llamada nunca saldría de ahí' }));
        } else if (!color[h.id]) visitar(h.id, [...camino, h.id]);
      }
      color[id] = 2;
    };
    nodos.filter((n) => sinFin.has(n.tipo)).forEach((n) => { if (!color[n.id]) visitar(n.id, [n.id]); });

    /* Sin repetidos */
    const vistos = new Set();
    problemas = P.filter((x) => { const k = x.nodo + x.texto; if (vistos.has(k)) return false; vistos.add(k); return true; });
    return problemas;
  }

  function pintarPendientes() {
    const box = $f('flPendientes');
    if (!problemas.length) {
      box.innerHTML = '<span class="t g">Completo</span> El flujo no tiene pendientes.';
      return;
    }
    box.innerHTML = `<span class="t a">${problemas.length} pendiente${problemas.length === 1 ? '' : 's'}</span>
      ${problemas.slice(0, 6).map((x) => `<button class="fl-pend" data-ir="${esc(x.nodo)}">${esc(x.texto)}</button>`).join('')}
      ${problemas.length > 6 ? `<span class="hint">y ${problemas.length - 6} más</span>` : ''}`;
  }

  /* Clic en un pendiente: selecciona el bloque y lo trae a la vista */
  $f('flPendientes')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir]');
    if (!b) return;
    const n = nodo(b.dataset.ir);
    if (!n) return;
    const r = $f('flLienzo').getBoundingClientRect();
    vista.x = r.width / 2 - (n.x + 100) * vista.z;
    vista.y = r.height / 2 - (n.y + 50) * vista.z;
    seleccionar({ tipo: 'nodo', id: n.id });
  });

  /* Si se cambia el tamaño de la ventana, las flechas se recalculan */
  window.addEventListener('resize', () => { if (actual && $f('flEditor').style.display !== 'none') dibujarFlechas(); });

  return { abrir };
})();