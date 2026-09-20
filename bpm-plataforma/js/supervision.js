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
  let consultando = false;

  function iniciar() {
    llenarFiltro();
    llenarReportes();
    refrescar();                       // primera consulta inmediata
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
      mostrarError(e.message);
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
      <div>No se pudo obtener el estado de la operación: ${msg}</div></div>`;
  }

  /* ═══════════ INDICADORES ═══════════ */
  function pintar() {
    const ag = filtro === 'Todas'
      ? estado.agentes
      : estado.agentes.filter((a) => a.campana === filtro);

    pintarKpis(ag, estado.kpis);
    pintarAgentes(ag);
    pintarCampanas();
  }

  function pintarKpis(agentes, kpis) {
    const enLlamada = agentes.filter((a) => a.estado === 'En llamada').length;
    const disponibles = agentes.filter((a) => a.estado === 'Disponible').length;
    const enPausa = agentes.length - enLlamada - disponibles
                  - agentes.filter((a) => a.estado === 'Timbrando').length;

    const tarjeta = (et, valor, sub) => `
      <div class="kpi"><span class="kpi-et">${et}</span>
        <b>${valor}</b><span class="kpi-sub">${sub || ''}</span></div>`;

    $('kpis').innerHTML = [
      tarjeta('Conectados', agentes.length, 'con sesión abierta'),
      tarjeta('En llamada', enLlamada, 'hablando ahora'),
      tarjeta('Disponibles', disponibles, 'esperando llamada'),
      tarjeta('En pausa', enPausa < 0 ? 0 : enPausa, 'no reciben'),
      tarjeta('Llamadas hoy', kpis ? kpis.llamadasHoy : '—', 'del turno'),
      tarjeta('Abandonadas', kpis ? kpis.abandonadasHoy : '—', 'sin contestar'),
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
    $('agentesTag').textContent = agentes.length + ' agentes';

    if (!agentes.length) {
      $('tablaAgentes').innerHTML = '<div class="vacio">Ningún agente en esta campaña.</div>';
      return;
    }

    const color = (e) => e === 'En llamada' ? 'b'
                       : e === 'Disponible' ? 'g'
                       : e === 'Cierre' ? 'b' : 'a';

    $('tablaAgentes').innerHTML = `<table class="tb">
      <tr><th>Ext.</th><th>Agente</th><th>Campaña</th><th>Estado</th><th>Tiempo</th>
          <th>Atendiendo</th><th>Llamadas</th><th>TMO</th></tr>
      ${agentes.map((a) => `<tr>
        <td class="mono">${a.ext}</td>
        <td><b>${a.nombre}</b></td>
        <td>${a.campana}</td>
        <td><span class="t ${color(a.estado)}"><span class="d"></span>${a.estado}</span></td>
        <td class="mono">${reloj(a.desde)}</td>
        <td class="mono">${a.numero || '—'}</td>
        <td class="mono">${a.llamadas}</td>
        <td class="mono">${reloj(a.tmo)}</td>
      </tr>`).join('')}</table>`;
  }

  /* ═══════════ CAMPAÑAS Y HORARIOS ═══════════ */
  function pintarCampanas() {
    const hor = servicio.horarios();
    $('tablaCampanas').innerHTML = `<table class="tb">
      <tr><th>Campaña</th><th>Horario</th><th>Días</th><th>Estado</th><th></th></tr>
      ${servicio.campanas.map((c) => {
        const h = hor.find((x) => x.campana === c.nombre) || {};
        const abierto = !!h.abierto;
        return `<tr>
          <td><b>${c.nombre}</b><br><span style="font-size:10.5px;color:var(--ink-3)">${c.tipo}</span></td>
          <td class="mono">${h.inicio || '—'} a ${h.fin || '—'}</td>
          <td>${h.dias || '—'}</td>
          <td><span class="t ${abierto ? 'g' : 'o'}">${abierto ? 'Abierto' : 'Cerrado'}</span></td>
          <td><button class="b ${abierto ? 'b-gh' : 'b-teal'} b-sm" data-hor="${h.id || ''}">
            ${abierto ? 'Cerrar' : 'Abrir'}</button></td>
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
    const s = $('filtroCampana');
    s.innerHTML = '<option value="Todas">Todas las campañas</option>' +
      servicio.campanas.map((c) => `<option>${c.nombre}</option>`).join('');
    s.value = filtro;
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
