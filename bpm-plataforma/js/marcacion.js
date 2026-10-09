/* ═══════════════════════════════════════════════════════════════════
   MARCACIÓN

   Dos lados en el mismo archivo porque comparten los mismos datos:

   EL SUPERVISOR carga una base de contactos, define las reglas
   —reintentos, horario, días— y la activa. Desde ese momento ve cómo
   avanza: cuántos quedan, cuántos se gestionaron, cuántos no
   contestaron.

   EL AGENTE recibe un contacto a la vez. Ve sus datos, llama, y al
   terminar dice qué pasó: gestionado, no contestó, lo agenda para
   después, o lo excluye. Entonces aparece el siguiente.

   POR QUÉ EL AGENTE PIDE Y NO LE EMPUJAN
   La plataforma pregunta al servidor "¿hay algo para mí?" cuando el
   agente queda libre, en vez de que el servidor le mande el contacto.
   Así, si el agente cierra el navegador o se va a pausa, simplemente
   deja de preguntar y su contacto vuelve a la cola. Cuando conectemos
   la central, la llamada saldrá sola en este mismo punto.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const marcacion = (() => {
  const $m = (id) => document.getElementById(id);

  /* ── Lado supervisor ── */
  let bases = [];
  let base = null;
  let filasArchivo = [];
  let contactosVistos = [];

  /* ── Lado agente ── */
  let contacto = null;
  let baseAgente = null;
  let buscando = false;

  const ESTADOS = {
    borrador:  ['o', 'Borrador'],
    activa:    ['g', 'Activa'],
    pausada:   ['a', 'Pausada'],
    terminada: ['o', 'Terminada'],
  };

  const avisoCaja = (clase, texto) => `<div class="aviso ${clase}" style="margin:0 0 10px">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
    <div>${seguro.texto(texto)}</div></div>`;

  /* ═══════════════════════════════════════════════════════════════
     LADO SUPERVISOR
     ═══════════════════════════════════════════════════════════════ */

  async function abrir() {
    await pintarCanal();
    await llenarCampanas();
    await pintarLista();
  }

  /* ── Estado del canal con la central ──
     Si está caído, una base automática no marca a nadie. Conviene que
     se vea de entrada y no haya que averiguarlo. */
  async function pintarCanal() {
    if (!$m('canalMarcacion')) return;

    let r;
    try { r = await servicio.estadoMotor(); }
    catch { r = null; }

    if (!r) {
      $m('caEstado').className = 't o';
      $m('caEstado').textContent = 'Sin información';
      $m('caDetalle').innerHTML = '<div class="vacio">No se pudo consultar el estado.</div>';
      return;
    }

    const canal = r.canal || {};

    if (!canal.habilitado) {
      $m('caEstado').className = 't o';
      $m('caEstado').textContent = 'Desactivado';
      $m('caDetalle').innerHTML = avisoCaja('av-a',
        'El canal con la central no está configurado en el servidor. ' +
        'Las bases pueden usarse en marcación manual.');
      return;
    }

    if (canal.conectado) {
      $m('caEstado').className = 't g';
      $m('caEstado').textContent = 'Conectado';

      const ultimas = (r.ultimas || []).slice(0, 6).map((x) =>
        `<div class="cf-item"><b>${seguro.texto(String(x.cuando).slice(11, 19))}</b>
          <span>${seguro.texto(x.texto)}</span></div>`).join('');

      $m('caDetalle').innerHTML = avisoCaja('av-b',
        `La central responde. El motor ${r.andando ? 'está activo' : 'no está activo'}.`) +
        (ultimas ? `<div class="cf-rejilla">${ultimas}</div>` : '');
      return;
    }

    $m('caEstado').className = 't r';
    $m('caEstado').textContent = 'Desconectado';
    $m('caDetalle').innerHTML = avisoCaja('av-r',
      'No hay conexión con la central: las bases automáticas no están marcando. ' +
      (canal.ultimoError || '')) +
      `<div class="hint">Reintentos: ${seguro.texto(canal.intentos ?? 0)}. ` +
      'Se reconecta sola; si no vuelve, avisa al área de tecnología.</div>';
  }

  async function llenarCampanas() {
    let r = { campanas: [] };
    try { r = await servicio.campanasDeEstados(); } catch { /* sin campañas */ }
    $m('baCampana').innerHTML = r.campanas
      .map((c) => `<option value="${seguro.texto(c.id)}">${seguro.texto(c.nombre)}</option>`).join('')
      || '<option value="">Sin campañas asignadas</option>';
  }

  async function pintarLista() {
    $m('listaBases').innerHTML = '<div class="vacio">Cargando…</div>';
    try {
      bases = await servicio.listarBases();
    } catch (e) {
      $m('listaBases').innerHTML =
        `<div class="vacio">No se pudieron cargar: ${seguro.texto(e.message)}</div>`;
      return;
    }

    if (!bases.length) {
      $m('listaBases').innerHTML =
        '<div class="vacio">Todavía no hay bases. Pulsa Crear para la primera.</div>';
      return;
    }

    $m('listaBases').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Base</th><th>Campaña</th><th>Total</th><th>Pendientes</th>
          <th>Gestionados</th><th>Sin contacto</th><th>Agendados</th><th>Estado</th></tr>
      ${bases.map((b) => {
        const [color, etiqueta] = ESTADOS[b.estado] || ['o', b.estado];
        return `<tr data-ba="${seguro.texto(b.id)}" style="cursor:pointer">
          <td><b>${seguro.texto(b.nombre)}</b></td>
          <td>${seguro.celda(b.campana)}</td>
          <td class="mono">${seguro.texto(b.total ?? 0)}</td>
          <td class="mono">${seguro.texto(b.pendientes ?? 0)}</td>
          <td class="mono">${seguro.texto(b.gestionados ?? 0)}</td>
          <td class="mono">${seguro.texto(b.sin_contacto ?? 0)}</td>
          <td class="mono">${seguro.texto(b.agendados ?? 0)}</td>
          <td><span class="t ${color}">${seguro.texto(etiqueta)}</span></td>
        </tr>`;
      }).join('')}</table></div>`;
  }

  $m('listaBases').addEventListener('click', (e) => {
    const fila = e.target.closest('[data-ba]');
    if (fila) abrirBase(Number(fila.dataset.ba));
  });

  const diasMarcados = () =>
    [...$m('baDias').querySelectorAll('input:checked')].map((i) => i.value).join(',');

  function marcarDias(texto) {
    const puestos = String(texto || '').split(',').map((d) => d.trim());
    $m('baDias').querySelectorAll('input')
      .forEach((i) => { i.checked = puestos.includes(i.value); });
  }

  const alternarAuto = () => {
    const auto = $m('baAuto').checked;
    $m('baSimulBox').style.display = auto ? '' : 'none';
    $m('baCierreBox').style.display = auto ? '' : 'none';
  };
  $m('baAuto').addEventListener('change', alternarAuto);

  $m('btnBaNueva').addEventListener('click', () => {
    base = null;
    $m('editorBase').style.display = '';
    $m('baTitulo').textContent = 'Nueva base';
    $m('baEstado').className = 't o';
    $m('baEstado').textContent = 'Borrador';
    $m('baNombre').value = '';
    $m('baReintentos').value = '2';
    $m('baIntervalo').value = '60';
    $m('baDesde').value = '08:00';
    $m('baHasta').value = '19:00';
    marcarDias('L,M,X,J,V');
    $m('baAuto').checked = false;
    $m('baSimultaneas').value = '1';
    $m('baCierre').value = '30';
    alternarAuto();
    $m('btnBaBorrar').style.display = 'none';
    ['contactosBase', 'seguimientoBase', 'lanzarBase']
      .forEach((id) => { $m(id).style.display = 'none'; });
    $m('baNombre').focus();
  });

  async function abrirBase(id) {
    try {
      base = await servicio.leerBase(id);
    } catch (e) {
      aviso('No se pudo abrir: ' + e.message, 'av-a');
      return;
    }

    $m('editorBase').style.display = '';
    const [color, etiqueta] = ESTADOS[base.estado] || ['o', base.estado];
    $m('baTitulo').textContent = base.nombre;
    $m('baEstado').className = 't ' + color;
    $m('baEstado').textContent = etiqueta;

    $m('baNombre').value = base.nombre || '';
    $m('baCampana').value = base.campana_id || '';
    $m('baReintentos').value = base.reintentos ?? 2;
    $m('baIntervalo').value = base.intervalo_min ?? 60;
    $m('baDesde').value = (base.hora_inicio || '08:00').slice(0, 5);
    $m('baHasta').value = (base.hora_fin || '19:00').slice(0, 5);
    marcarDias(base.dias || 'L,M,X,J,V');
    $m('baAuto').checked = !!base.marcacion_auto;
    $m('baSimultaneas').value = Number(base.simultaneas) || 1;
    $m('baCierre').value = base.cierre_seg ?? 30;
    alternarAuto();
    $m('btnBaBorrar').style.display = '';

    /* Con la base activa no se cambian las reglas a mitad de camino */
    const activa = base.estado === 'activa';
    $m('editorBase').querySelectorAll('input, select')
      .forEach((el) => { el.disabled = activa; });
    $m('btnBaGuardar').disabled = activa;

    $m('contactosBase').style.display = '';
    $m('baRevision').innerHTML = '<div class="vacio">Sube un archivo para agregar contactos.</div>';
    await pintarSeguimiento();
    pintarLanzar();
  }

  $m('btnBaGuardar').addEventListener('click', async () => {
    const datos = {
      nombre: $m('baNombre').value.trim(),
      campana_id: Number($m('baCampana').value) || null,
      reintentos: Number($m('baReintentos').value),
      intervalo_min: Number($m('baIntervalo').value),
      hora_inicio: $m('baDesde').value + ':00',
      hora_fin: $m('baHasta').value + ':00',
      dias: diasMarcados(),
      marcacion_auto: $m('baAuto').checked,
      simultaneas: Number($m('baSimultaneas').value) || 1,
      cierre_seg: Number($m('baCierre').value) || 0,
    };
    if (!datos.dias) { aviso('Marca al menos un día.', 'av-a'); return; }

    const btn = $m('btnBaGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      if (base) {
        await servicio.guardarBase(base.id, datos);
        aviso('Base guardada.', 'av-b');
        await pintarLista();
        await abrirBase(base.id);
      } else {
        const r = await servicio.crearBase(datos);
        aviso('Base creada. Ahora carga los contactos.', 'av-b');
        await pintarLista();
        await abrirBase(r.id);
      }
    } catch (e) {
      aviso(e.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar';
    }
  });

  $m('btnBaCerrar').addEventListener('click', () => {
    base = null;
    ['editorBase', 'contactosBase', 'seguimientoBase', 'lanzarBase']
      .forEach((id) => { $m(id).style.display = 'none'; });
  });

  $m('btnBaBorrar').addEventListener('click', async () => {
    if (!base) return;
    if (!confirm(`¿Eliminar la base "${base.nombre}"?\n\nSe borran también sus contactos.`)) return;
    try {
      await servicio.eliminarBase(base.id);
      base = null;
      ['editorBase', 'contactosBase', 'seguimientoBase', 'lanzarBase']
        .forEach((id) => { $m(id).style.display = 'none'; });
      await pintarLista();
      aviso('Base eliminada.', 'av-b');
    } catch (e) { aviso(e.message, 'av-a'); }
  });

  /* ── Cargar contactos ── */

  $m('baArchivo').addEventListener('change', async (e) => {
    const archivo = e.target.files?.[0];
    if (!archivo || !base) return;
    e.target.value = '';

    $m('baRevision').innerHTML = '<div class="vacio">Leyendo el archivo…</div>';
    let filas;
    try {
      ({ filas } = await servicio.leerTabla(archivo));
    } catch (err) {
      filasArchivo = [];
      $m('btnBaCargar').style.display = 'none';
      $m('baRevision').innerHTML = avisoCaja('av-r', err.message);
      return;
    }

    $m('baRevision').innerHTML = `<div class="vacio">Revisando ${filas.length} filas…</div>`;
    try {
      const r = await servicio.revisarContactos(base.id, filas);
      filasArchivo = filas;
      pintarRevision(r);
    } catch (err) {
      $m('baRevision').innerHTML = avisoCaja('av-r', err.message);
    }
  });

  function pintarRevision(r) {
    $m('btnBaCargar').style.display = r.correctas ? '' : 'none';
    $m('btnBaCargar').textContent = `Cargar ${r.correctas} contacto(s)`;

    const resumen = r.conError
      ? avisoCaja('av-a', `${r.correctas} fila(s) listas y ${r.conError} con problemas. ` +
          'Solo se cargarán las correctas.')
      : avisoCaja('av-b', `Las ${r.correctas} filas están correctas.`);

    const extra = [];
    if (r.conSegundo) extra.push(`${r.conSegundo} traen segundo teléfono`);
    if (r.columnas?.length) {
      extra.push(`datos adicionales: ${r.columnas.join(', ')}`);
    }
    const nota = extra.length
      ? `<div class="hint" style="margin-bottom:8px">El agente verá ${extra.join(' · ')}.</div>` : '';

    $m('baRevision').innerHTML = resumen + nota + `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Línea</th><th>Teléfono</th><th>Segundo</th><th>Nombre</th>
          <th>Correo</th><th>Revisión</th></tr>
      ${r.filas.map((f) => `<tr${f.errores.length ? ' style="background:var(--danger-l)"' : ''}>
        <td class="mono">${seguro.texto(f.linea)}</td>
        <td class="mono">${seguro.celda(f.telefono_1)}</td>
        <td class="mono">${seguro.celda(f.telefono_2)}</td>
        <td>${seguro.celda(f.nombre)}</td>
        <td>${seguro.celda(f.correo)}</td>
        <td>${f.errores.length
          ? `<span class="mas-error">${seguro.texto(f.errores.join('. '))}</span>`
          : '<span class="mas-ok">Listo</span>'}</td>
      </tr>`).join('')}</table></div>`;
  }

  $m('btnBaCargar').addEventListener('click', async () => {
    if (!base || !filasArchivo.length) return;
    const btn = $m('btnBaCargar');
    btn.disabled = true; btn.textContent = 'Cargando…';
    try {
      const r = await servicio.cargarContactos(base.id, filasArchivo);
      filasArchivo = [];
      btn.style.display = 'none';
      $m('baRevision').innerHTML = avisoCaja('av-b', `${r.cargados} contactos cargados.`);
      await pintarLista();
      await pintarSeguimiento();
      pintarLanzar();
    } catch (e) {
      aviso(e.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Cargar contactos';
    }
  });

  $m('btnBaPlantilla').addEventListener('click', () => {
    /* La primera línea le dice a Excel cómo separar las columnas. */
    /* Solo el teléfono es obligatorio. El segundo teléfono se usa si el
       primero no contesta; el resto es información para el agente.
       Cualquier columna que agregues aparecerá también en su pantalla. */
    const ejemplo = [
      'sep=;',
      'telefono_1;telefono_2;nombre;documento;correo;observaciones',
      '3102879726;3151112233;Juan Pérez;79123456;juan.perez@correo.com;Cliente antiguo',
      '3004432187;;María Gómez;52984112;;',
    ].join('\r\n');

    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + ejemplo], { type: 'text/csv;charset=utf-8' }));
    a.download = 'contactos.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });

  /* ── Seguimiento ── */

  async function pintarSeguimiento() {
    if (!base) return;
    $m('seguimientoBase').style.display = '';

    let r;
    try { r = await servicio.seguimientoBase(base.id, $m('baFiltro').value); }
    catch { return; }

    contactosVistos = r.contactos || [];
    const s = r.resumen || {};
    $m('baContN').textContent = s.total || 0;

    const kpi = (et, vl, sb, tono = '') =>
      `<div class="kpi ${tono}"><div class="et">${et}</div><div class="vl">${vl ?? 0}</div><div class="sb">${sb}</div></div>`;

    $m('baResumen').innerHTML = [
      kpi('Total', s.total, 'contactos cargados'),
      kpi('Pendientes', s.pendientes, 'por llamar'),
      kpi('En gestión', s.en_gestion, 'con un agente'),
      kpi('Gestionados', s.gestionados, 'se habló con ellos', 'bien'),
      kpi('Sin contacto', s.sin_contacto, 'agotados los intentos', 'alerta'),
      kpi('Agendados', s.agendados, 'para después'),
    ].join('');

    const color = { gestionado: 'g', sin_contacto: 'r', agendado: 'b', asignado: 'a', excluido: 'o' };
    const fecha = (f) => (f ? String(f).slice(0, 16).replace('T', ' ') : '—');

    $m('baTabla').innerHTML = contactosVistos.length
      ? `<div style="overflow-x:auto"><table class="tb">
          <tr><th>Teléfono</th><th>Nombre</th><th>Estado</th><th>Intentos</th>
              <th>Agente</th><th>Resultado</th><th>Próximo</th></tr>
          ${contactosVistos.slice(0, 300).map((c) => `<tr>
            <td class="mono">${seguro.texto(c.telefono_1)}${
              c.telefono_2 ? `<br><span class="cred">${seguro.texto(c.telefono_2)}</span>` : ''}</td>
            <td>${seguro.celda(c.nombre)}</td>
            <td><span class="t ${color[c.estado] || 'o'}">${seguro.texto(c.estado)}</span></td>
            <td class="mono">${seguro.texto(c.intentos ?? 0)}</td>
            <td>${seguro.celda(c.agente)}</td>
            <td>${seguro.celda(c.resultado)}</td>
            <td class="mono">${seguro.texto(fecha(c.agendado_para || c.proximo_intento))}</td>
          </tr>`).join('')}</table>
          ${contactosVistos.length > 300
            ? `<div class="hint">Se muestran los primeros 300 de ${contactosVistos.length}.</div>` : ''}
         </div>`
      : '<div class="vacio">No hay contactos con ese filtro.</div>';
  }

  $m('btnBaRefrescar').addEventListener('click', pintarSeguimiento);
  $m('baFiltro').addEventListener('change', pintarSeguimiento);

  $m('btnBaCsv').addEventListener('click', () => {
    if (!contactosVistos.length) { aviso('No hay contactos que descargar.', 'av-a'); return; }

    const cols = ['Teléfono', 'Segundo', 'Nombre', 'Documento', 'Estado', 'Intentos',
                  'Agente', 'Resultado', 'Observaciones', 'Último intento', 'Próximo'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = contactosVistos.map((c) => [c.telefono_1, c.telefono_2, c.nombre, c.documento,
      c.estado, c.intentos, c.agente, c.resultado, c.observaciones,
      c.ultimo_intento, c.agendado_para || c.proximo_intento]);

    const texto = '\ufeff' + [cols, ...filas].map((f) => f.map(esc).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    a.download = `contactos_${(base?.nombre || 'base').replace(/\s+/g, '_')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  });

  /* ── Activar y pausar ── */

  function pintarLanzar() {
    if (!base) return;
    $m('lanzarBase').style.display = '';

    const estado = base.estado;
    let cuerpo;

    if (estado === 'activa') {
      cuerpo = avisoCaja('av-b',
        'La base está activa: los agentes de esta campaña están recibiendo contactos.') +
        `<div class="ctrls">
          <button class="b b-gh" data-ba-estado="pausada">Pausar</button>
          <button class="b b-red b-sm" data-ba-estado="terminada">Terminar</button></div>`;
    } else if (estado === 'pausada') {
      cuerpo = avisoCaja('av-a', 'Pausada. No se está entregando ningún contacto.') +
        `<div class="ctrls">
          <button class="b b-teal" data-ba-estado="activa">Reanudar</button>
          <button class="b b-red b-sm" data-ba-estado="terminada">Terminar</button></div>`;
    } else if (estado === 'terminada') {
      cuerpo = avisoCaja('av-b', 'Base terminada. Sus resultados quedan en el seguimiento.');
    } else {
      cuerpo = avisoCaja('av-a',
        'Al activarla, los agentes libres de esta campaña empezarán a recibir contactos.') +
        '<div class="ctrls"><button class="b b-teal" data-ba-estado="activa">Activar</button></div>';
    }

    const modo = base.marcacion_auto
      ? 'Marcación automática: el sistema llama solo cuando un agente queda libre.'
      : 'Marcación manual: el agente recibe el contacto y pulsa Llamar.';

    $m('baLanzar').innerHTML = cuerpo +
      `<div class="hint" style="margin-top:8px">${seguro.texto(modo)}</div>`;
  }

  $m('baLanzar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ba-estado]');
    if (!b || !base) return;

    const destino = b.dataset.baEstado;
    if (destino === 'terminada' &&
        !confirm('¿Terminar la base?\n\nDeja de entregar contactos y no se puede reanudar.')) return;

    b.disabled = true;
    try {
      await servicio.cambiarEstadoBase(base.id, destino);
      await pintarLista();
      await abrirBase(base.id);
      aviso('Estado actualizado.', 'av-b');
    } catch (err) {
      aviso(err.message, 'av-a');
      b.disabled = false;
    }
  });

  /* ═══════════════════════════════════════════════════════════════
     LADO AGENTE
     ═══════════════════════════════════════════════════════════════ */

  /** Pide el siguiente contacto. Se llama al entrar y cada vez que el
      agente termina una gestión o vuelve de pausa. */
  async function pedirSiguiente() {
    if (!$m('tarjetaMarcador') || buscando) return;
    if (!(ui.sesion?.permisos || []).includes('softphone')) return;

    buscando = true;
    let r;
    try { r = await servicio.siguienteContacto(); }
    catch { buscando = false; return; }
    buscando = false;

    if (!r.hay) {
      contacto = null;
      /* Si no hay base activa, la tarjeta ni se muestra: no tiene
         sentido ocupar espacio en campañas que no marcan. */
      const mostrar = r.motivo && !/No hay ninguna base activa/.test(r.motivo);
      $m('tarjetaMarcador').style.display = mostrar ? '' : 'none';
      if (mostrar) {
        $m('maEstado').className = 't o';
        $m('maEstado').textContent = 'Sin contactos';
        $m('maCuerpo').innerHTML = `<div class="vacio">${seguro.texto(r.motivo)}</div>`;
      }
      return;
    }

    contacto = r.contacto;
    baseAgente = r.base;
    pintarContacto();
  }

  function pintarContacto() {
    $m('tarjetaMarcador').style.display = '';
    $m('maEstado').className = 't b';
    $m('maEstado').textContent = contacto.intentos
      ? `Intento ${contacto.intentos + 1}` : 'Nuevo';

    /* Los datos adicionales del archivo: saldo, producto, lo que traiga */
    const extra = Object.entries(contacto.datos || {})
      .map(([k, v]) => `<div class="cf-item"><b>${seguro.texto(k)}</b><span>${seguro.texto(v)}</span></div>`)
      .join('');

    const agendado = contacto.agendado_para
      ? avisoCaja('av-b', 'Este contacto estaba agendado para ' +
          String(contacto.agendado_para).slice(0, 16).replace('T', ' ')) : '';

    const segundo = contacto.usandoSegundo
      ? '<span class="cred">segundo teléfono</span>' : '';

    $m('maCuerpo').innerHTML = agendado + `
      <div class="ficha-marcador">
        <div class="fm-nombre">${seguro.celda(contacto.nombre)}</div>
        <div class="fm-tel mono">${seguro.texto(contacto.telefono)} ${segundo}</div>
        ${contacto.documento ? `<div class="fm-doc">Documento ${seguro.texto(contacto.documento)}</div>` : ''}
      </div>
      ${extra ? `<div class="cf-rejilla" style="margin:10px 0">${extra}</div>` : ''}

      ${baseAgente?.automatica
        ? `<div class="aviso av-b" style="margin:0 0 10px">
             <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
             <div>La llamada entra sola: no tienes que marcar. Al colgar tendrás
             ${seguro.texto(baseAgente.cierre_seg ?? 30)} segundos para escribir el resultado.</div></div>`
        : `<div class="ctrls">
             <button class="b b-teal b-w" id="maLlamar">Llamar a ${seguro.texto(contacto.telefono)}</button>
           </div>`}

      <div class="f" style="margin-top:10px">
        <label>Resultado de la gestión</label>
        <input class="fi" id="maResultado" maxlength="160" placeholder="Ej. Acuerdo de pago">
      </div>
      <div class="f">
        <label>Observaciones</label>
        <textarea class="fi" id="maObs" rows="2"></textarea>
      </div>

      <div class="ctrls">
        <button class="b b-teal b-sm" data-ma="gestionado">Gestionado</button>
        <button class="b b-gh b-sm" data-ma="no_contesta">No contestó</button>
        <button class="b b-gh b-sm" data-ma="agendar">Agendar</button>
        <button class="b b-red b-sm" data-ma="excluir">Excluir</button>
      </div>

      <div id="maAgenda" style="display:none;margin-top:8px">
        <div class="f"><label>Llamar el</label>
          <input class="fi" id="maFecha" type="datetime-local"></div>
        <div class="ctrls">
          <button class="b b-teal b-sm" id="maAgendarOk">Confirmar agendamiento</button>
          <button class="b b-gh b-sm" id="maAgendarNo">Cancelar</button></div>
      </div>`;
  }

  /* Llamar desde el softphone, con el número ya puesto */
  $m('maCuerpo').addEventListener('click', async (e) => {
    if (!contacto) return;

    if (e.target.closest('#maLlamar')) {
      if (telefonia.estado !== 'reposo') {
        aviso('Ya tienes una llamada en curso.', 'av-a');
        return;
      }
      $('dest').value = contacto.telefono;
      $('btnCall').click();
      return;
    }

    if (e.target.closest('#maAgendarNo')) {
      $m('maAgenda').style.display = 'none';
      return;
    }

    if (e.target.closest('#maAgendarOk')) {
      const cuando = $m('maFecha').value;
      if (!cuando) { aviso('Elige la fecha y la hora.', 'av-a'); return; }
      await cerrar('agendado', { agendado_para: cuando });
      return;
    }

    const b = e.target.closest('[data-ma]');
    if (!b) return;

    if (b.dataset.ma === 'agendar') {
      $m('maAgenda').style.display = '';
      return;
    }
    if (b.dataset.ma === 'excluir') {
      const noLlamar = confirm(
        '¿Agregar este número a la lista de NO LLAMAR?\n\n' +
        'Aceptar: no se le vuelve a llamar en ninguna campaña.\n' +
        'Cancelar: solo se excluye de esta base.');
      await cerrar('excluir', { no_llamar: noLlamar });
      return;
    }
    await cerrar(b.dataset.ma, {});
  });

  /** Cierra la gestión y pide el siguiente contacto. */
  async function cerrar(tipo, extra) {
    if (!contacto) return;

    const datos = {
      tipo,
      resultado: $m('maResultado')?.value.trim() || null,
      observaciones: $m('maObs')?.value.trim() || null,
      ...extra,
    };

    try {
      const r = await servicio.resultadoContacto(contacto.id, datos);

      const mensajes = {
        gestionado: 'Gestión registrada.',
        pendiente: `Sin contacto. Se reintentará${r.proximoTelefono ? ' al segundo teléfono' : ''}.`,
        sin_contacto: 'Se agotaron los intentos con este contacto.',
        agendado: 'Contacto agendado.',
        excluido: 'Contacto excluido.',
      };
      aviso(mensajes[r.estado] || 'Registrado.', 'av-b');

      contacto = null;
      await pedirSiguiente();
    } catch (e) {
      aviso(e.message, 'av-a');
    }
  }

  /* En marcación automática la plataforma pregunta sola cada pocos
     segundos si ya le entró otra llamada, igual que el motor pregunta
     quién está libre. Así el agente no tiene que hacer nada. */
  setInterval(() => {
    if (!contacto && baseAgente && baseAgente.automatica) pedirSiguiente();
  }, 5000);

  /** Devuelve el contacto a la cola: el agente se va a pausa o sale. */
  async function soltar() {
    if (!contacto) return;
    contacto = null;
    try { await servicio.soltarContacto(); } catch { /* el servidor lo recupera solo */ }
    $m('tarjetaMarcador').style.display = 'none';
  }

  return { abrir, pedirSiguiente, soltar, pintarCanal };
})();
