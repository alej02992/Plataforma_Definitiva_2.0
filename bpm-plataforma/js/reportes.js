/* ═══════════════════════════════════════════════════════════════════
   REPORTERÍA

   Tres reportes en la misma pantalla:

   LLAMADAS       cada llamada: quién, a quién, cuánto duró, cómo acabó
   TIPIFICACIÓN   qué resultado tuvo cada gestión y cómo se reparten
   INICIO SESIÓN  a qué hora entró cada agente, cuánto estuvo conectado
                  y cuánto tiempo pasó en break

   Comparten filtros y descargas; lo que cambia es qué se consulta y qué
   columnas se muestran. Por eso hay una sola tabla de definiciones y
   no tres pantallas casi iguales.

   Los archivos los arma el servidor. Podría hacerlo el navegador, pero
   entonces el resultado dependería de lo que tenga instalado cada
   computador, y el PDF no se podría hacer bien.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const reportes = (() => {
  const $r = (id) => document.getElementById(id);

  let tipo = 'llamadas';
  let filas = [];
  let columnasVistas = [];

  /* Qué pide y qué muestra cada reporte */
  const REPORTES = {
    llamadas: {
      ayuda: 'Cada llamada gestionada en la plataforma: quién la hizo, a qué número, ' +
             'cuánto duró y cómo se tipificó.',
      filtros: ['estado', 'numero'],
      pedir: (f) => servicio.reporteLlamadas(f),
      lista: (d) => d.llamadas,
      columnas: [
        ['fecha', 'Fecha'], ['hora', 'Hora'], ['agente', 'Agente'],
        ['extension', 'Ext.'], ['direccion', 'Dirección'], ['numero', 'Número'],
        ['estado', 'Estado'], ['duracion', 'Duración'], ['tipificacion', 'Tipificación'],
      ],
      resumen: (r) => [
        ['Llamadas', r.total, 'en el periodo'],
        ['Contestadas', r.contestadas, 'llegaron a hablar', 'bien'],
        ['No contestadas', r.noContestadas, 'sin respuesta', 'alerta'],
        ['Tiempo hablado', reloj(r.segundosHablados), 'en total'],
        ['Promedio', reloj(r.promedio), 'por llamada contestada'],
      ],
    },

    tipificaciones: {
      ayuda: 'Cómo se cerró cada gestión. El reparto de abajo es lo que más dice: ' +
             'si la mayoría son "no contesta", el problema está en la base, no en los agentes.',
      filtros: ['resultado'],
      pedir: (f) => servicio.reporteTipificaciones(f),
      lista: (d) => d.tipificaciones,
      columnas: [
        ['fecha', 'Fecha'], ['hora', 'Hora'], ['agente', 'Agente'],
        ['campana', 'Campaña'], ['numero', 'Número'], ['duracion', 'Duración'],
        ['resultado', 'Resultado'], ['observaciones', 'Observaciones'],
      ],
      resumen: (r) => [
        ['Gestiones', r.total, 'tipificadas'],
        ['Resultados', r.distintos, 'distintos'],
        ['Agentes', r.agentes, 'participaron'],
        ['Tiempo hablado', reloj(r.segundosHablados), 'en total'],
        ['Promedio', reloj(r.promedio), 'por gestión'],
      ],
    },

    sesiones: {
      ayuda: 'A qué hora entró y salió cada agente, cuánto estuvo conectado y cuánto ' +
             'tiempo pasó en break.',
      filtros: [],
      pedir: (f) => servicio.reporteSesiones(f),
      lista: (d) => d.sesiones,
      columnas: [
        ['fecha', 'Fecha'], ['agente', 'Agente'], ['extension', 'Ext.'],
        ['campana', 'Campaña'], ['entrada', 'Entrada'], ['salida', 'Salida'],
        ['conectado', 'Conectado'], ['disponible', 'Disponible'],
        ['enPausa', 'En pausa'], ['pausas', 'Breaks'],
      ],
      resumen: (r) => [
        ['Sesiones', r.sesiones, 'en el periodo'],
        ['Agentes', r.agentes, 'distintos'],
        ['Conectado', r.conectado, 'en total'],
        ['Disponible', r.disponible, 'descontando pausas', 'bien'],
        ['En pausa', r.enPausa, `${r.porcentajePausa ?? 0}% del tiempo`, 'alerta'],
      ],
    },
    formularios: {
      ayuda: 'Lo que respondieron los clientes. Cada formulario tiene sus propias ' +
             'preguntas, así que primero elige cuál quieres ver.',
      filtros: ['formulario'],
      /* Las columnas no están escritas aquí: vienen del formulario
         elegido, porque cada uno pregunta cosas distintas. */
      pedir: (f) => servicio.reporteFormulario(f.formulario_id, f),
      lista: (d) => d.respuestas,
      columnas: null,
      resumen: (r) => [
        ['Respuestas', r.respuestas ?? 0, 'en el periodo'],
        ['Preguntas', r.campos ?? 0, 'tiene el formulario'],
      ],
    },
  };

  const reloj = (s) => {
    const n = Number(s) || 0;
    const m = Math.floor(n / 60);
    return m ? `${m}m ${String(n % 60).padStart(2, '0')}s` : `${n}s`;
  };

  /* ═══════════ ABRIR ═══════════ */

  async function abrir() {
    if (!$r('rpDesde').value) {
      const hoy = new Date().toISOString().slice(0, 10);
      $r('rpDesde').value = hoy;
      $r('rpHasta').value = hoy;
    }
    await llenarAgentes();
  }

  /* El desplegable sale del servidor, no de una lista local: así
     incluye a quien se creó hace cinco minutos. */
  let agentesCargados = false;

  async function llenarAgentes() {
    if (agentesCargados) return;
    try {
      const us = await servicio.listarUsuarios();
      $r('rpAgente').innerHTML = '<option value="">Todos</option>' +
        us.filter((u) => u.extension)
          .map((u) => `<option value="${seguro.texto(u.extension)}">${
            seguro.texto(u.nombre)} · ${seguro.texto(u.extension)}</option>`).join('');
      agentesCargados = true;
    } catch { /* queda "Todos" */ }
  }

  /* ═══════════ CAMBIAR DE REPORTE ═══════════ */

  function elegir(nuevo) {
    tipo = nuevo;
    filas = [];

    document.querySelectorAll('#rpTipo .tab')
      .forEach((t) => t.classList.toggle('on', t.dataset.r === nuevo));

    const def = REPORTES[nuevo];
    $r('rpAyuda').textContent = def.ayuda;

    /* Cada reporte muestra solo los filtros que puede usar */
    $r('rpEstadoBox').style.display = def.filtros.includes('estado') ? '' : 'none';
    $r('rpNumeroBox').style.display = def.filtros.includes('numero') ? '' : 'none';
    $r('rpResultadoBox').style.display = def.filtros.includes('resultado') ? '' : 'none';
    $r('rpFormBox').style.display = def.filtros.includes('formulario') ? '' : 'none';

    if (def.filtros.includes('formulario')) llenarFormularios();

    $r('rpRepartoBox').style.display = 'none';
    $r('rpResumen').innerHTML = '';
    $r('rpTabla').innerHTML = '<div class="vacio">Pulsa Consultar para ver el reporte.</div>';
    $r('rpTag').className = 't o';
    $r('rpTag').textContent = '—';
  }

  $r('rpTipo').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (t) elegir(t.dataset.r);
  });

  /** Los formularios que puede consultar, con cuántas respuestas
      tiene cada uno: así se ve de entrada cuál tiene datos. */
  async function llenarFormularios() {
    let lista = [];
    try { lista = await servicio.listarFormulariosReporte(); } catch { /* ninguno */ }

    $r('rpFormulario').innerHTML = lista.length
      ? lista.map((f) => `<option value="${seguro.texto(f.id)}">${seguro.texto(f.nombre)}${
          f.campana ? ' · ' + seguro.texto(f.campana) : ''} (${seguro.texto(f.respuestas)})</option>`).join('')
      : '<option value="">No hay formularios en tus campañas</option>';
  }

  /* ═══════════ CONSULTAR ═══════════ */

  $r('btnRpConsultar').addEventListener('click', consultar);

  async function consultar() {
    const def = REPORTES[tipo];
    const btn = $r('btnRpConsultar');
    btn.disabled = true; btn.textContent = 'Consultando…';

    const filtros = {
      desde: $r('rpDesde').value,
      hasta: $r('rpHasta').value,
      extension: $r('rpAgente').value,
    };

    /* La franja horaria solo se manda si no es el día completo: así la
       consulta no lleva condiciones que no filtran nada. */
    const hd = $r('rpHoraD').value, hh = $r('rpHoraH').value;
    if (hd && hd !== '00:00') filtros.desdeHora = hd;
    if (hh && hh !== '23:59') filtros.hastaHora = hh;

    if (def.filtros.includes('formulario')) {
      filtros.formulario_id = $r('rpFormulario').value;
      if (!filtros.formulario_id) {
        aviso('Elige primero un formulario.', 'av-a');
        btn.disabled = false; btn.textContent = 'Consultar';
        return;
      }
    }
    if (def.filtros.includes('estado')) filtros.estado = $r('rpEstado').value;
    if (def.filtros.includes('numero')) filtros.numero = $r('rpNumero').value.trim();
    if (def.filtros.includes('resultado')) filtros.resultado = $r('rpResultado').value.trim();

    try {
      const d = await def.pedir(filtros);
      filas = def.lista(d) || [];

      /* El de formularios trae sus columnas; los demás las tienen
         definidas aquí. */
      columnasVistas = def.columnas || d.columnas || [];

      pintarResumen(def.resumen(d.resumen || {}));
      pintarReparto(d.reparto, tipo === 'formularios');
      pintarTabla(columnasVistas);

      $r('rpTag').className = 't ' + (filas.length ? 'g' : 'o');
      $r('rpTag').textContent = filas.length ? `${filas.length} registros` : 'Sin datos';
    } catch (e) {
      aviso(e.message, 'av-a');
      $r('rpTabla').innerHTML = `<div class="vacio">${seguro.texto(e.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Consultar';
    }
  }

  function pintarResumen(tarjetas) {
    $r('rpResumen').innerHTML = tarjetas.map(([et, vl, sb, tono]) =>
      `<div class="kpi ${tono || ''}"><div class="et">${seguro.texto(et)}</div>
        <div class="vl">${seguro.texto(vl ?? 0)}</div>
        <div class="sb">${seguro.texto(sb)}</div></div>`).join('');
  }

  /** El reparto por resultado, con barra. Es lo que de verdad se mira
      en el reporte de tipificación. */
  /**
   * El reparto de resultados. En tipificación es una sola lista; en
   * formularios es una por cada pregunta de opciones, porque interesa
   * saber cómo se repartieron las respuestas de cada una.
   */
  function pintarReparto(reparto, porPregunta = false) {
    if (!reparto?.length) { $r('rpRepartoBox').style.display = 'none'; return; }

    $r('rpRepartoBox').style.display = '';

    const barras = (lista) => lista.map((x) => `
      <div class="rep-fila">
        <span class="rep-nom">${seguro.texto(x.resultado ?? x.valor)}</span>
        <span class="rep-barra"><i style="width:${Math.max(2, x.porcentaje)}%"></i></span>
        <span class="rep-num mono">${seguro.texto(x.cantidad)}</span>
        <span class="rep-pct mono">${seguro.texto(x.porcentaje)}%</span>
      </div>`).join('');

    $r('rpReparto').innerHTML = porPregunta
      ? reparto.map((p) => `
          <div style="margin-bottom:14px">
            <div class="dia-h"><h3>${seguro.texto(p.etiqueta)}</h3>
              <span class="dia-sub">${seguro.texto(p.total)} respuestas</span></div>
            ${barras(p.opciones)}
          </div>`).join('')
      : barras(reparto);
  }

  function pintarTabla(columnas) {
    if (!filas.length) {
      $r('rpTabla').innerHTML = '<div class="vacio">No hay datos en ese periodo.</div>';
      return;
    }

    $r('rpTabla').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr>${columnas.map((c) => `<th>${seguro.texto(c[1])}</th>`).join('')}</tr>
      ${filas.slice(0, 500).map((f) => `<tr>${
        columnas.map(([clave]) => {
          const v = f[clave];
          const mono = ['numero', 'extension', 'hora', 'entrada', 'salida',
                        'duracion', 'conectado', 'disponible', 'enPausa'].includes(clave);
          return `<td${mono ? ' class="mono"' : ''}>${seguro.celda(v)}</td>`;
        }).join('')}</tr>`).join('')}
      </table>
      ${filas.length > 500
        ? `<div class="hint">Se muestran los primeros 500 de ${filas.length}. ` +
          'La descarga los trae todos.</div>' : ''}
      </div>`;
  }

  /* ═══════════ DESCARGAS ═══════════ */

  document.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-bajar]');
      if (!b) return;

      if (!filas.length) {
        aviso('Primero consulta el reporte.', 'av-a');
        return;
      }

      const formato = b.dataset.bajar;
      b.disabled = true;
      const texto = b.textContent;
      b.textContent = 'Generando…';

      try {
        const periodo = `${$r('rpDesde').value} a ${$r('rpHasta').value}`;
        const r = await servicio.exportarReporte(tipo, formato, filas, periodo,
          tipo === 'formularios' ? columnasVistas : null);

        /* El servidor manda el archivo como texto; aquí se vuelve a
           convertir en archivo para descargarlo. */
        const bytes = Uint8Array.from(atob(r.contenido), (c) => c.charCodeAt(0));
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([bytes], { type: r.tipo }));
        a.download = r.nombre;
        document.body.appendChild(a); a.click(); a.remove();

        aviso(`Descargado ${r.nombre}`, 'av-b');
      } catch (err) {
        aviso('No se pudo generar: ' + err.message, 'av-a');
      } finally {
        b.disabled = false; b.textContent = texto;
      }
    });

  return { abrir, elegir };
})();