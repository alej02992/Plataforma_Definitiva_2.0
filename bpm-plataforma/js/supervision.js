/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — PANEL DE SUPERVISIÓN Y REPORTES

   Qué resuelve, de lo pedido en la reunión:
     · seguimiento a los agentes (estado, si tienen llamada, tiempos)
     · ver estado de campañas
     · cuántas llamadas hay y si hay llamadas en cola
     · bajar reportes
     · cerrar horarios

   Los datos salen de `servicio`. Cuando exista el backend, llegarán
   por WebSocket desde los eventos del AMI de Asterisk, y solo cambia
   de dónde se leen: las funciones de pintado quedan igual.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const supervision = (() => {

  let intervalo = null;
  let filtro = 'Todas';
  let ultimoReporte = null;

  /* ═══════════ ARRANQUE Y PARADA ═══════════ */

  /* Estado que se muestra. Se rellena con lo que responde el backend.
     Si no hay backend, queda vacío: no se inventan agentes. */
  let estado = { agentes: [], kpis: null, telefonia: null };
  let campanas = [];                 // del servidor, no de datos locales
  let consultando = false;

  async function iniciar() {
    await cargarCampanas();
    llenarFiltro();
    llenarReportes();
    refrescar();                       // primera consulta inmediata
    arrancarDia();                     // y los números del día
    detener();

    /* Se pregunta cada tres segundos. No es tan inmediato como
       escuchar los eventos de la central, pero en pantalla se ve igual
       y no requiere mantener un canal permanente abierto. */
    intervalo = setInterval(() => {
      const v = document.querySelector('.vista.on');
      if (v && v.dataset.v === 'supervision') refrescar();
    }, 3000);
  }

  function detener() {
    if (intervalo) clearInterval(intervalo);
    intervalo = null;
  }

  /** Las campañas se piden una vez al abrir la vista: cambian poco y
      no tiene sentido traerlas cada tres segundos. */
  async function cargarCampanas() {
    try { campanas = await servicio.listarCampanas(); } catch { campanas = []; }
  }

  /** Pide el estado al backend y repinta. */
  async function refrescar() {
    if (consultando) return;           // evita solapar consultas lentas
    consultando = true;

    try {
      const v = await servicio.estadoEnVivo();
      estado = v;
      avisoTelefonia(v.telefonia);
      pintar();
    } catch (e) {
      /* Aunque falle el estado en vivo, las campañas se siguen viendo:
         son datos distintos y el supervisor los necesita igual. */
      mostrarError(e.message);
      pintarCampanas();
    } finally {
      consultando = false;
    }
  }

  /** Si el backend no pudo consultar la central, se dice. Es mejor que
      el supervisor lo sepa a que crea que nadie está en llamada. */
  function avisoTelefonia(t) {
    const caja = $('avisoVivo');
    if (!caja) return;

    if (!t || t.ok) { caja.style.display = 'none'; return; }

    caja.style.display = '';
    caja.innerHTML = `<div class="aviso av-a" style="margin:0">
      <svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
      <div>Se muestran los agentes conectados, pero no se pudo consultar
      el estado de las llamadas en la central.</div></div>`;
  }

  function mostrarError(msg) {
    $('tablaAgentes').innerHTML = `<div class="aviso av-r" style="margin:0">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      <div>No se pudo obtener el estado de la operación: ${seguro.texto(msg)}</div></div>`;
  }

  /* ═══════════ INDICADORES ═══════════ */
  /* ── Cómo va el día ──

     Se consulta cada 30 segundos y no cada 3 como el estado de los
     agentes. Son cuentas sobre la tabla de llamadas, que crece todos
     los días: pedirlas tres veces por segundo cargaría la base sin
     que nadie note la diferencia, porque estos números no cambian
     tan rápido. */

  let relojDia = null;

  async function pintarDia() {
    if (!$('kpiDia')) return;

    let d;
    try { d = await servicio.indicadoresDelDia(); }
    catch { return; }

    const h = d.hoy || {};
    const ayer = d.ayer || {};

    $('diaHora').textContent = 'Acumulado hasta las ' +
      new Date().toTimeString().slice(0, 5);

    /* La comparación con ayer a la misma hora es lo que convierte un
       número suelto en información: 40 llamadas no dice nada; 40
       cuando ayer iban 60, sí. */
    const contra = (hoyV, ayerV) => {
      if (!ayerV) return '';
      const dif = Math.round(((hoyV - ayerV) / ayerV) * 100);
      if (Math.abs(dif) < 3) return '<span class="vs igual">igual que ayer</span>';
      return `<span class="vs ${dif > 0 ? 'sube' : 'baja'}">${
        dif > 0 ? '▲' : '▼'} ${Math.abs(dif)}% vs ayer</span>`;
    };

    const reloj = (s) => {
      const n = Number(s) || 0;
      const m = Math.floor(n / 60);
      return m ? `${m}m ${String(n % 60).padStart(2, '0')}s` : `${n}s`;
    };

    const tarjeta = (et, vl, sb, tono = '') => `
      <div class="kpi ${tono}"><div class="et">${et}</div>
        <div class="vl">${vl}</div><div class="sb">${sb}</div></div>`;

    const tarjetas = [
      tarjeta('Llamadas', h.llamadas ?? 0,
              contra(h.llamadas || 0, ayer.llamadas || 0) || 'hechas hoy'),
      tarjeta('Contactadas', h.contestadas ?? 0, 'llegaron a hablar', 'bien'),
      tarjeta('Efectividad', (h.efectividad ?? 0) + '%', 'de las llamadas hechas',
              (h.efectividad ?? 0) >= 30 ? 'bien' : 'alerta'),
      tarjeta('Tiempo hablado', reloj(h.segundosHablados), 'en total'),
      tarjeta('Promedio', reloj(h.promedio), 'por llamada contactada'),
    ];

    /* Solo si hay una base de marcación activa */
    if (d.base) {
      const quedan = d.base.pendientes;
      tarjetas.push(tarjeta('Base pendiente', quedan,
        `de ${d.base.total} contactos`, quedan ? '' : 'alerta'));
    }

    $('kpiDia').innerHTML = tarjetas.join('');
  }

  function pintar() {
    const ag = filtro === 'Todas'
      ? estado.agentes
      : estado.agentes.filter((a) => a.campana === filtro);

    pintarKpis(ag, estado.kpis);
    pintarAgentes(ag);
    pintarCampanas();
  }

  function arrancarDia() {
    pintarDia();
    clearInterval(relojDia);
    relojDia = setInterval(() => {
      const v = document.querySelector('.vista.on');
      if (v && v.dataset.v === 'supervision') pintarDia();
      else { clearInterval(relojDia); relojDia = null; }
    }, 30000);
  }

  function pintarKpis(agentes, kpis) {
    const enLlamada = agentes.filter((a) => a.estado === 'En llamada').length;
    const disponibles = agentes.filter((a) => a.estado === 'Disponible').length;
    const timbrando = agentes.filter((a) => a.estado === 'Timbrando').length;
    const enPausa = Math.max(0, agentes.length - enLlamada - disponibles - timbrando);

    /* Las clases et, vl y sb son las que da el diseño: etiqueta
       pequeña arriba, número grande, y aclaración debajo. */
    const kpi = (et, valor, sub, tono = '') => `
      <div class="kpi ${tono}">
        <div class="et">${et}</div>
        <div class="vl">${valor}</div>
        <div class="sb">${sub}</div>
      </div>`;

    const abandonadas = kpis ? Number(kpis.abandonadasHoy || 0) : null;

    $('kpis').innerHTML = [
      kpi('Conectados', agentes.length, 'con sesión abierta'),
      kpi('En llamada', enLlamada, 'hablando ahora', enLlamada ? 'bien' : ''),
      kpi('Disponibles', disponibles, 'esperando llamada'),
      kpi('En pausa', enPausa, 'no reciben', enPausa ? 'alerta' : ''),
      kpi('Llamadas hoy', kpis ? kpis.llamadasHoy : '—', 'del turno'),
      kpi('Abandonadas', abandonadas ?? '—', 'sin contestar',
          abandonadas ? 'alerta' : ''),
    ].join('');
  }

  /* Las llamadas en cola requieren los eventos de la central. Hasta
     que exista ese módulo, la tabla se deja con su aviso. */
  function pintarColas() {
    const t = $('tablaColas');
    if (t) t.innerHTML =
      '<div class="vacio">Las llamadas en cola requieren el módulo de eventos de la central.</div>';
  }

  function pintarAgentes(agentes) {
    $('agentesTag').className = 't o';
    $('agentesTag').textContent = agentes.length +
      (agentes.length === 1 ? ' agente' : ' agentes');

    if (!agentes.length) {
      $('tablaAgentes').innerHTML =
        '<div class="vacio">Ningún agente conectado en esta campaña.</div>';
      return;
    }

    const color = (e) => e === 'En llamada' ? 'b'
                       : e === 'Disponible' ? 'g'
                       : e === 'Timbrando' ? 'b' : 'a';

    /* Las columnas de llamadas atendidas y tiempo medio necesitan el
       registro automático de llamadas, que todavía no existe. Se
       omiten en lugar de mostrarlas vacías. */
    $('tablaAgentes').innerHTML = `<table class="tb">
      <tr><th>Ext.</th><th>Agente</th><th>Campaña</th><th>Estado</th>
          <th>Tiempo</th><th>Atendiendo</th></tr>
      ${agentes.map((a) => `<tr>
        <td class="mono">${seguro.celda(a.extension)}</td>
        <td><b>${seguro.texto(a.nombre)}</b></td>
        <td>${seguro.celda(a.campana)}</td>
        <td><span class="t ${color(a.estado)}"><span class="d"></span>${seguro.texto(a.estado)}</span></td>
        <td class="mono">${reloj(a.desde)}</td>
        <td class="mono">${seguro.celda(a.numero)}</td>
      </tr>`).join('')}</table>`;
  }

  /* Todas las campañas activas, estén o no recibiendo llamadas: si hay
     gente conectada a una, el supervisor necesita verla. */
  function pintarCampanas() {
    if (!campanas.length) {
      $('tablaCampanas').innerHTML =
        '<div class="vacio">No hay campañas activas.</div>';
      return;
    }

    /* Cuántos agentes conectados tiene cada una */
    const conectados = {};
    estado.agentes.forEach((a) => {
      const k = a.campana || '—';
      conectados[k] = (conectados[k] || 0) + 1;
    });

    const hora = (h) => (h || '').slice(0, 5) || '—';

    $('tablaCampanas').innerHTML = `<table class="tb">
      <tr><th>Campaña</th><th>Horario</th><th>Conectados</th><th>Estado</th><th></th></tr>
      ${campanas.map((c) => {
        const abierta = !!c.abierta;
        const n = conectados[c.nombre] || 0;
        return `<tr>
          <td><b>${seguro.texto(c.nombre)}</b><br>
              <span style="font-size:10.5px;color:var(--ink-3)">${seguro.texto(c.tipo)}${c.did ? ' · ' + seguro.texto(c.did) : ''}</span></td>
          <td class="mono">${hora(c.hora_apertura)} a ${hora(c.hora_cierre)}</td>
          <td class="mono">${n ? `<b>${n}</b> agente${n === 1 ? '' : 's'}` : '—'}</td>
          <td><span class="t ${abierta ? 'g' : 'o'}">${abierta ? 'Abierta' : 'Cerrada'}</span></td>
          <td><button class="b ${abierta ? 'b-gh' : 'b-teal'} b-sm" data-hor="${seguro.texto(c.id)}">
            ${abierta ? 'Cerrar' : 'Abrir'}</button></td>
        </tr>`;
      }).join('')}</table>`;
  }


  /** Abrir o cerrar el horario de una campaña. */
  function alternarHorario(id) {
    const lista = servicio.horarios();
    const h = lista.find((x) => x.id === id);
    if (!h) return null;
    h.abierto = !h.abierto;
    servicio.guardarHorarios(lista);
    pintarCampanas();
    return h;
  }

  /* ═══════════ FILTRO POR CAMPAÑA ═══════════ */
  function llenarFiltro() {
    const sel = $('filtroCampana');
    if (!sel) return;
    sel.innerHTML = '<option value="Todas">Todas las campañas</option>' +
      campanas.map((c) => `<option>${seguro.texto(c.nombre)}</option>`).join('');
  }


  function fijarFiltro(v) { filtro = v; pintar(); }

  /* ═══════════ REPORTES ═══════════ */
  function llenarReportes() {
    $('listaReportes').innerHTML = servicio.tiposReporte.map((r) =>
      `<button class="rep" data-rep="${r.id}"><b>${r.nombre}</b><span>${r.desc}</span></button>`).join('');
  }

  /**
   * Genera un reporte y lo pinta.
   * `extra` permite inyectar el detalle de llamadas, que vive en pantalla.js.
   */
  function generar(tipo, extra) {
    const meta = servicio.tiposReporte.find((r) => r.id === tipo);
    const datos = tipo === 'llamadas' && extra ? extra : servicio.generarReporte(tipo);
    ultimoReporte = { tipo, nombre: meta ? meta.nombre : tipo, ...datos };

    $('repResultado').style.display = '';
    $('repTitulo').textContent = ultimoReporte.nombre;
    $('repSub').textContent =
      `${datos.filas.length} fila(s) · generado ${new Date().toLocaleString('es-CO')}`;

    $('repTabla').innerHTML = !datos.filas.length
      ? '<div class="vacio">Este reporte no tiene datos todavía.</div>'
      : `<table class="tb">
          <tr>${datos.columnas.map((c) => `<th>${c}</th>`).join('')}</tr>
          ${datos.filas.slice(0, 100).map((f) =>
            `<tr>${f.map((v) => `<td class="mono">${v}</td>`).join('')}</tr>`).join('')}
        </table>` +
        (datos.filas.length > 100
          ? `<p class="hint" style="margin-top:8px">Se muestran las primeras 100 filas.
             El CSV trae las ${datos.filas.length}.</p>` : '');

    return ultimoReporte;
  }

  /** Descarga el último reporte en CSV, legible por Excel. */
  function descargarCsv() {
    if (!ultimoReporte || !ultimoReporte.filas.length) return false;

    const escapar = (v) => {
      const s = String(v ?? '');
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    // Punto y coma: es el separador que Excel espera en configuración es-CO
    const lineas = [ultimoReporte.columnas.map(escapar).join(';')]
      .concat(ultimoReporte.filas.map((f) => f.map(escapar).join(';')));

    // BOM para que Excel respete las tildes
    const blob = new Blob(['\uFEFF' + lineas.join('\r\n')],
      { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bpm-${ultimoReporte.tipo}-` +
      new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  }

  /* ═══════════ UTILIDAD ═══════════ */
  const reloj = (seg) => {
    const s = Math.max(0, Math.floor(seg || 0));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  return { iniciar, detener, pintar, fijarFiltro, alternarHorario,
           generar, descargarCsv, reloj };
})();
