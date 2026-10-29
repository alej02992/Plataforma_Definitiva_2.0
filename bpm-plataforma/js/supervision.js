/* ═══════════════════════════════════════════════════════════════════
   BPM CONSULTING — PANEL DE SUPERVISIÓN Y REPORTES

   Qué resuelve, de lo pedido en la reunión:
     · seguimiento a los agentes (estado, si tienen llamada, tiempos)
     · ver estado de campañas
     · cuántas llamadas hay y si hay llamadas en cola
     · bajar reportes
     · cerrar horarios

   Los datos salen de /api/vivo cada tres segundos. Entre consulta y
   consulta, los relojes de cada agente siguen avanzando solos en la
   pantalla, segundo a segundo.
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
  let recibido = Date.now();         // cuándo llegó el último estado
  let vistaAg = 'tarjetas';          // tarjetas o tabla
  let orden = 'estado';              // cómo se ordenan los agentes

  /* Cuándo algo merece una alerta */
  const LLAMADA_LARGA = 20 * 60;     // una llamada de más de 20 minutos
  const COLA_LARGA = 60;             // alguien esperando más de un minuto

  async function iniciar() {
    await cargarCampanas();
    llenarFiltro();
    refrescar();                       // primera consulta inmediata
    arrancarDia();                     // y los números del día
    arrancarSegundero();               // los relojes, cada segundo
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
      recibido = Date.now();
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

  const filtrados = () => (filtro === 'Todas'
    ? estado.agentes
    : estado.agentes.filter((a) => a.campana === filtro));

  function pintar() {
    const ag = filtrados();
    pintarAlertas(ag);
    pintarReparto(ag);
    pintarKpis(ag, estado.kpis);
    pintarColas();
    pintarAgentes(ag);
    pintarCampanas();
  }

  function arrancarDia() {
    pintarDia();
    pintarHoras();
    clearInterval(relojDia);
    relojDia = setInterval(() => {
      const v = document.querySelector('.vista.on');
      if (v && v.dataset.v === 'supervision') { pintarDia(); pintarHoras(); }
      else { clearInterval(relojDia); relojDia = null; }
    }, 30000);
  }

  /** Cuántos segundos lleva un agente en su estado, contando lo que
      pasó desde la última consulta: así el reloj avanza solo. */
  const lleva = (a) => (a.desde || 0) + Math.floor((Date.now() - recibido) / 1000);
  const excedida = (a) => a.tipo === 'pausa' && a.limite && lleva(a) > a.limite;

  /* El tono de cada estado: lo usan las tarjetas, la tabla y el reparto */
  const TONO = { disponible: 'g', llamada: 'b', timbrando: 'b', pausa: 'a' };
  const tonoDe = (a) => (excedida(a) ? 'r' : TONO[a.tipo] || 'a');

  function pintarKpis(agentes, kpis) {
    const enLlamada = agentes.filter((a) => a.tipo === 'llamada').length;
    const disponibles = agentes.filter((a) => a.tipo === 'disponible').length;
    const enPausa = agentes.filter((a) => a.tipo === 'pausa').length;

    /* Las clases et, vl y sb son las que da el diseño: etiqueta
       pequeña arriba, número grande, y aclaración debajo. */
    const kpi = (et, valor, sub, tono = '') => `
      <div class="kpi ${tono}">
        <div class="et">${et}</div>
        <div class="vl">${valor}</div>
        <div class="sb">${sub}</div>
      </div>`;

    const abandonadas = kpis ? Number(kpis.abandonadasHoy || 0) : null;
    const enCola = estado.cola?.ok ? estado.cola.total : null;

    $('kpis').innerHTML = [
      kpi('Conectados', agentes.length, 'con sesión abierta'),
      kpi('En llamada', enLlamada, 'hablando ahora', enLlamada ? 'bien' : ''),
      kpi('Disponibles', disponibles, 'esperando llamada'),
      kpi('En pausa', enPausa, 'no reciben', enPausa ? 'alerta' : ''),
      kpi('En cola', enCola ?? '—', 'esperando un agente', enCola ? 'alerta' : ''),
      kpi('Abandonadas', abandonadas ?? '—', 'sin contestar hoy', abandonadas ? 'alerta' : ''),
    ].join('');
  }

  /* ═══════════ EL REPARTO, EN UNA BARRA ═══════════
     Cuántos agentes hay en cada estado ahora mismo, en una sola barra
     de colores: se entiende de un vistazo, sin leer números. */
  function pintarReparto(agentes) {
    const caja = $('segReparto');
    if (!caja) return;
    if (!agentes.length) { caja.innerHTML = ''; return; }

    const partes = [
      ['Disponibles', 'sg-disp', agentes.filter((a) => a.tipo === 'disponible').length],
      ['En llamada', 'sg-llam', agentes.filter((a) => a.tipo === 'llamada').length],
      ['Timbrando', 'sg-timb', agentes.filter((a) => a.tipo === 'timbrando').length],
      ['En pausa', 'sg-paus', agentes.filter((a) => a.tipo === 'pausa' && !excedida(a)).length],
      ['Pasados de tiempo', 'sg-exce', agentes.filter(excedida).length],
    ].filter(([, , n]) => n);

    caja.innerHTML = `
      <div class="seg-barra">${partes.map(([et, c, n]) =>
        `<i class="${c}" style="flex:${n}" title="${et}: ${n}"></i>`).join('')}</div>
      <div class="seg-leyenda">${partes.map(([et, c, n]) =>
        `<span><i class="${c}"></i>${et} <b>${n}</b></span>`).join('')}</div>`;
  }

  /* ═══════════ ALERTAS ═══════════
     Solo aparecen cuando hay algo que atender. Cada una lleva a su
     agente o a su campaña con un clic. */
  function pintarAlertas(agentes) {
    const caja = $('segAlertas');
    if (!caja) return;
    const alertas = [];

    agentes.filter(excedida).forEach((a) => alertas.push({
      tono: 'r', ir: 'ag-' + a.id,
      texto: `<b>${seguro.texto(a.nombre)}</b> se pasó de su pausa de ${seguro.texto(a.estado)}:
              lleva ${reloj(lleva(a))}, el máximo es ${reloj(a.limite)}`,
    }));

    agentes.filter((a) => a.tipo === 'llamada' && lleva(a) > LLAMADA_LARGA).forEach((a) => alertas.push({
      tono: 'a', ir: 'ag-' + a.id,
      texto: `<b>${seguro.texto(a.nombre)}</b> lleva ${reloj(lleva(a))} en una llamada.
              Si es más de lo normal, puede ser una línea trabada.`,
    }));

    (estado.cola?.colas || []).filter((c) => c.maxEspera > COLA_LARGA).forEach((c) => alertas.push({
      tono: 'r', ir: 'segColaBox',
      texto: `<b>${c.total} llamada${c.total === 1 ? '' : 's'} esperando</b> en ${seguro.texto(c.campana)}:
              la primera lleva ${reloj(c.maxEspera)}`,
    }));

    /* Campañas abiertas sin nadie conectado: sus llamadas no las atiende nadie */
    const conectados = new Set(estado.agentes.map((a) => a.campana));
    campanas.filter((c) => c.abierta && !conectados.has(c.nombre)).forEach((c) => alertas.push({
      tono: 'a', ir: 'tablaCampanas',
      texto: `La campaña <b>${seguro.texto(c.nombre)}</b> está abierta y no tiene ningún agente conectado`,
    }));

    caja.innerHTML = alertas.length ? `<div class="seg-alertas">${alertas.map((x) => `
      <button class="seg-alerta ${x.tono}" data-ir="${x.ir}">
        <span class="seg-alerta-ico">${x.tono === 'r' ? '!' : '•'}</span><span>${x.texto}</span>
      </button>`).join('')}</div>` : '';
  }

  /* Clic en una alerta: lleva al agente o a la tarjeta, y la resalta */
  $('segAlertas')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir]');
    const el = b && document.getElementById(b.dataset.ir);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('seg-resalta');
    void el.offsetWidth;                               // reinicia la animación
    el.classList.add('seg-resalta');
  });

  /* ═══════════ LLAMADAS EN COLA ═══════════ */
  function pintarColas() {
    const t = $('tablaColas');
    if (!t) return;
    const c = estado.cola;

    if (!c || !c.ok) {
      $('colaTag').className = 't o';
      $('colaTag').textContent = '—';
      t.innerHTML = `<div class="vacio">${seguro.texto(c?.motivo || 'Sin datos de la central')}</div>`;
      return;
    }

    $('colaTag').className = c.total ? 't r' : 't g';
    $('colaTag').textContent = c.total ? `${c.total} esperando` : 'Sin espera';

    if (!c.total) {
      t.innerHTML = '<div class="vacio">Nadie está esperando ahora mismo.</div>';
      return;
    }

    t.innerHTML = c.colas.map((q) => `
      <div class="seg-cola">
        <div class="seg-cola-h"><b>${seguro.texto(q.campana)}</b>
          <span class="t ${q.maxEspera > COLA_LARGA ? 'r' : 'a'}">${q.total} · la primera, ${reloj(q.maxEspera)}</span></div>
        ${q.llamadas.map((l) => `
          <div class="cola-fila"><span class="cola-pos">${seguro.texto(l.posicion)}</span>
            <span class="cola-dato"><b>${seguro.celda(l.numero)}</b></span>
            <span class="cola-espera mono">${reloj(l.esperando)}</span></div>`).join('')}
      </div>`).join('');
  }

  /* ═══════════ AGENTES ═══════════ */
  const ORDEN_TIPO = { timbrando: 0, llamada: 1, pausa: 2, disponible: 3 };
  function ordenar(agentes) {
    const l = [...agentes];
    if (orden === 'nombre') return l.sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (orden === 'llamadas') return l.sort((a, b) => (b.hoy?.llamadas || 0) - (a.hoy?.llamadas || 0));
    if (orden === 'tiempo') return l.sort((a, b) => lleva(b) - lleva(a));
    /* Por estado: primero lo que más importa mirar —pausas pasadas de
       tiempo—, después llamadas, pausas y disponibles. */
    return l.sort((a, b) => (excedida(b) - excedida(a)) ||
      (ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo]) || (lleva(b) - lleva(a)));
  }

  /* Debajo del reloj: con quién habla, o cuánto le queda de pausa */
  const detalle = (a) => {
    if (a.tipo === 'llamada' || a.tipo === 'timbrando') return a.numero ? `con ${seguro.texto(a.numero)}` : '&nbsp;';
    if (a.tipo === 'pausa' && a.limite) {
      return excedida(a) ? `se pasó por ${reloj(lleva(a) - a.limite)}` : `de ${reloj(a.limite)} permitidos`;
    }
    return a.tipo === 'disponible' ? 'esperando llamada' : '&nbsp;';
  };

  const botonLiberar = (a) => (a.tipo === 'llamada' && a.extension
    ? `<button class="b b-gh b-sm" data-liberar="${seguro.texto(a.extension)}"
               data-nombre="${seguro.texto(a.nombre)}"
               title="Colgar sus canales si quedó trancado">Liberar</button>` : '');

  function pintarAgentes(agentes) {
    $('agentesTag').className = 't o';
    $('agentesTag').textContent = agentes.length +
      (agentes.length === 1 ? ' agente' : ' agentes');

    if (!agentes.length) {
      $('tablaAgentes').innerHTML =
        '<div class="vacio">Ningún agente conectado en esta campaña.</div>';
      return;
    }

    const lista = ordenar(agentes);

    if (vistaAg === 'tabla') {
      $('tablaAgentes').innerHTML = `<div style="overflow-x:auto"><table class="tb">
        <tr><th>Ext.</th><th>Agente</th><th>Campaña</th><th>Estado</th>
            <th>Tiempo</th><th>Atendiendo</th><th>Llamadas hoy</th><th>Hablado</th><th></th></tr>
        ${lista.map((a) => `<tr id="ag-${seguro.texto(a.id)}">
          <td class="mono">${seguro.celda(a.extension)}</td>
          <td><b>${seguro.texto(a.nombre)}</b></td>
          <td>${seguro.celda(a.campana)}</td>
          <td><span class="t ${tonoDe(a)}"><span class="d"></span>${seguro.texto(a.estado)}</span></td>
          <td class="mono" data-reloj="${seguro.texto(a.id)}">${reloj(lleva(a))}</td>
          <td class="mono">${seguro.celda(a.numero)}</td>
          <td class="mono">${a.hoy?.llamadas || 0} <span class="hint">· ${a.hoy?.contestadas || 0} contest.</span></td>
          <td class="mono">${hablado(a.hoy?.segundos)}</td>
          <td style="text-align:right;white-space:nowrap">${botonLiberar(a)}</td>
        </tr>`).join('')}</table></div>`;
      return;
    }

    const iniciales = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

    $('tablaAgentes').innerHTML = `<div class="seg-cards">${lista.map((a) => `
      <div class="seg-card ${tonoDe(a)}" id="ag-${seguro.texto(a.id)}">
        <div class="seg-card-h">
          <span class="seg-av">${seguro.texto(iniciales(a.nombre))}</span>
          <span class="seg-quien"><b>${seguro.texto(a.nombre)}</b>
            <small>${a.extension ? 'Ext. ' + seguro.texto(a.extension) + ' · ' : ''}${seguro.texto(a.campana)}</small></span>
        </div>
        <div class="seg-estado"><span class="t ${tonoDe(a)}"><span class="d"></span>${seguro.texto(a.estado)}</span></div>
        <div class="seg-reloj mono" data-reloj="${seguro.texto(a.id)}">${reloj(lleva(a))}</div>
        <div class="seg-det" data-det="${seguro.texto(a.id)}">${detalle(a)}</div>
        <div class="seg-hoy">
          <span><b>${a.hoy?.llamadas || 0}</b> llamadas</span>
          <span><b>${a.hoy?.contestadas || 0}</b> contestadas</span>
          <span><b>${hablado(a.hoy?.segundos)}</b> hablado</span>
        </div>
        ${botonLiberar(a) ? `<div class="seg-acc">${botonLiberar(a)}</div>` : ''}
      </div>`).join('')}</div>`;
  }

  /* ═══════════ EL RELOJ DE CADA SEGUNDO ═══════════
     Entre una consulta y otra pasan tres segundos. Para que los tiempos
     no salten de tres en tres, se actualizan aquí cada segundo, sin
     volver a dibujar las tarjetas: solo el texto de cada reloj. */
  let relojSegundo = null;
  function arrancarSegundero() {
    clearInterval(relojSegundo);
    relojSegundo = setInterval(() => {
      const v = document.querySelector('.vista.on');
      if (!v || v.dataset.v !== 'supervision') { clearInterval(relojSegundo); relojSegundo = null; return; }

      const porId = new Map(estado.agentes.map((a) => [String(a.id), a]));
      let cambioDeTono = false;
      document.querySelectorAll('[data-reloj]').forEach((el) => {
        const a = porId.get(el.dataset.reloj);
        if (!a) return;
        el.textContent = reloj(lleva(a));
        const det = document.querySelector(`[data-det="${CSS.escape(el.dataset.reloj)}"]`);
        if (det) det.innerHTML = detalle(a);
        /* Si una pausa acaba de pasarse del tiempo, cambia de color ya */
        const card = el.closest('.seg-card');
        if (card && !card.classList.contains(tonoDe(a))) cambioDeTono = true;
      });
      if (cambioDeTono) pintar();
      else pintarAlertas(filtrados());
    }, 1000);
  }

  /* ═══════════ LLAMADAS POR HORA ═══════════
     Hoy contra ayer, hora por hora. Se dibuja desde la primera hora con
     actividad, para no gastar el ancho en la madrugada. */
  async function pintarHoras() {
    const caja = $('segHoras');
    if (!caja) return;
    let d;
    try { d = await servicio.llamadasPorHora(); } catch { return; }

    const hay = (h) => d.hoy[h].llamadas || d.ayer[h].llamadas;
    let desde = d.hoy.findIndex((_, h) => hay(h));
    let hasta = 23 - [...d.hoy].reverse().findIndex((_, i) => hay(23 - i));
    if (desde < 0) {
      caja.innerHTML = '<div class="vacio">Todavía no hay llamadas hoy ni ayer.</div>';
      return;
    }
    desde = Math.min(desde, 8);
    hasta = Math.max(hasta, Math.min(18, 23));
    const horas = [];
    for (let h = desde; h <= hasta; h++) horas.push(h);
    const max = Math.max(1, ...horas.map((h) => Math.max(d.hoy[h].llamadas, d.ayer[h].llamadas)));
    /* Alto en píxeles, no en porcentaje: dentro de una caja flexible,
       algunos navegadores no calculan bien los porcentajes. */
    const ALTO = 100;

    caja.innerHTML = `
      <div class="seg-horas">${horas.map((h) => `
        <div class="seg-hora${h === d.horaActual ? ' ahora' : ''}"
             title="${h}:00 · hoy ${d.hoy[h].llamadas}, ayer ${d.ayer[h].llamadas}">
          <div class="seg-hora-barras">
            <i class="sg-ayer" style="height:${Math.round((d.ayer[h].llamadas / max) * ALTO)}px"></i>
            <i class="sg-hoy" style="height:${Math.round((d.hoy[h].llamadas / max) * ALTO)}px"></i>
          </div>
          <span>${h}</span>
        </div>`).join('')}</div>
      <div class="seg-leyenda"><span><i class="sg-hoy"></i>Hoy</span><span><i class="sg-ayer"></i>Ayer</span>
        <span class="hint">Pasa el ratón por una hora para ver los números</span></div>`;
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


  /** Abrir o cerrar el horario de una campaña.

      Lo decide el servidor: antes se guardaba en el navegador, así que
      lo que abría un supervisor no lo veía otro y se perdía al limpiar
      el navegador. */
  async function alternarHorario(id) {
    const r = await servicio.alternarHorario(id);
    if (!r.ok) {
      aviso(r.error || 'No se pudo cambiar el horario.', 'av-a');
      return null;
    }
    await refrescar();
    return r;
  }

  /* ═══════════ FILTRO POR CAMPAÑA ═══════════ */
  function llenarFiltro() {
    const sel = $('filtroCampana');
    if (!sel) return;
    sel.innerHTML = '<option value="Todas">Todas las campañas</option>' +
      campanas.map((c) => `<option>${seguro.texto(c.nombre)}</option>`).join('');
  }


  /* ── Liberar un agente trancado ──
     Si la central cree que sigue en una llamada que ya terminó, el
     agente deja de recibir y no hay forma de saberlo desde la pantalla.
     Esto cuelga SOLO sus canales. */
  $('tablaAgentes').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-liberar]');
    if (!b) return;

    if (!confirm(`¿Liberar a ${b.dataset.nombre}?\n\n` +
                 'Se cuelgan sus llamadas en curso. Úsalo solo si quedó trancado: ' +
                 'si está hablando de verdad, se le corta la llamada.')) return;

    b.disabled = true;
    try {
      const r = await servicio.liberarAgente(b.dataset.liberar);
      aviso(r.colgados
        ? `${r.agente} liberado. Se colgaron ${r.colgados} canal(es).`
        : `${r.agente} no tenía ningún canal abierto.`, 'av-b');
      refrescar();
    } catch (err) {
      aviso(err.message, 'av-a');
      b.disabled = false;
    }
  });

  function fijarFiltro(v) { filtro = v; pintar(); }

  $('segVistaAg')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-vista]');
    if (!b) return;
    vistaAg = b.dataset.vista;
    $('segVistaAg').querySelectorAll('[data-vista]').forEach((x) => x.classList.toggle('on', x === b));
    pintar();
  });
  $('segOrden')?.addEventListener('change', (e) => { orden = e.target.value; pintar(); });

  /* Los reportes viejos del supervisor se quitaron: devolvían tablas
     vacías porque su fuente de datos local nunca se llenó. Lo que de
     verdad sirve está en Reportería, con sus cuatro reportes y sus
     descargas. Los elementos que quedan en la página están ocultos. */

  /** Segundos a mm:ss, o h:mm:ss pasada una hora: 1:15:03, no 75:03. */
  const reloj = (seg) => {
    const s = Math.max(0, Math.floor(seg || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const dos = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${dos(m)}:${dos(x)}` : `${dos(m)}:${dos(x)}`;
  };

  /** Tiempo hablado del día, en palabras cortas: "1h 05m", "12m". */
  const hablado = (seg) => {
    const s = Math.max(0, Math.floor(seg || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  };

  return { iniciar, detener, pintar, fijarFiltro, alternarHorario, reloj };
})();