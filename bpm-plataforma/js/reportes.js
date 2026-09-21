/* ═══════════════════════════════════════════════════════════════════
   REPORTE DE LLAMADAS

   Consulta las llamadas guardadas en la base, con filtros, resumen y
   descarga en CSV. Lo usa la vista de Reportería del administrador.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const reporteLlamadas = (() => {
  const $r = (id) => document.getElementById(id);
  let ultimo = null;
  let agentesCargados = false;

  const dos = (n) => String(n).padStart(2, '0');
  const hoy = () => {
    const d = new Date();
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  };
  const reloj = (s) => {
    s = Number(s) || 0;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' : '') + dos(m) + ':' + dos(x);
  };

  async function abrir() {
    if (!$r('rlDesde')) return;
    if (!$r('rlDesde').value) $r('rlDesde').value = hoy();
    if (!$r('rlHasta').value) $r('rlHasta').value = hoy();

    if (!agentesCargados) {
      try {
        const us = await servicio.listarUsuarios();
        $r('rlAgente').innerHTML = '<option value="">Todos</option>' +
          us.filter((u) => u.extension)
            .map((u) => `<option value="${u.extension}">${u.nombre} · ${u.extension}</option>`).join('');
        agentesCargados = true;
      } catch { /* queda "Todos" */ }
    }

    /* Al entrar se muestra directamente lo de hoy: lo primero que se
       quiere ver es la llamada que se acaba de hacer. */
    await consultar();
  }

  async function consultar() {
    $r('rlTabla').innerHTML = '<div class="vacio">Consultando…</div>';

    let d;
    try {
      d = await servicio.reporteLlamadas({
        desde: $r('rlDesde').value,
        hasta: $r('rlHasta').value,
        extension: $r('rlAgente').value,
        estado: $r('rlEstado').value,
        numero: $r('rlNumero').value.trim(),
      });
    } catch (e) {
      $r('rlTabla').innerHTML = `<div class="vacio">No se pudo consultar: ${e.message}</div>`;
      return;
    }

    ultimo = d;
    const s = d.resumen;
    $r('rlTag').textContent = `${s.total} llamadas`;

    const kpi = (et, vl, sb, tono = '') =>
      `<div class="kpi ${tono}"><div class="et">${et}</div><div class="vl">${vl}</div><div class="sb">${sb}</div></div>`;
    $r('rlResumen').innerHTML = [
      kpi('Llamadas', s.total, 'en el periodo'),
      kpi('Contestadas', s.contestadas, 'con conversación', s.contestadas ? 'bien' : ''),
      kpi('No contestadas', s.noContestadas, 'sin conversación', s.noContestadas ? 'alerta' : ''),
      kpi('Tiempo hablado', reloj(s.segundosHablados), 'total'),
      kpi('Duración media', reloj(s.promedio), 'por llamada contestada'),
    ].join('');

    if (!d.llamadas.length) {
      $r('rlTabla').innerHTML = '<div class="vacio">No hay llamadas con esos filtros.</div>';
      return;
    }

    $r('rlTabla').innerHTML = `<div style="overflow-x:auto"><table class="tb">
      <tr><th>Fecha</th><th>Hora</th><th>Agente</th><th>Tipo</th><th>Número</th>
          <th>Estado</th><th>Duración</th><th>Tipificación</th><th>ID de la llamada</th></tr>
      ${d.llamadas.map((l) => `<tr>
        <td class="mono">${l.fecha}</td>
        <td class="mono">${l.hora}</td>
        <td>${l.agente}<span class="cred">ext. ${l.extension}</span></td>
        <td>${l.direccion === 'entrante' ? 'Entrante' : 'Saliente'}</td>
        <td class="mono">${l.numero}</td>
        <td><span class="t ${l.estado === 'Contestada' ? 'g' : 'a'}">${l.estado}</span></td>
        <td class="mono">${reloj(l.segundos)}</td>
        <td>${l.resultado}</td>
        <td class="mono" style="font-size:10.5px;color:var(--ink-3)" title="${l.llamada}">${corto(l.llamada)}</td>
      </tr>`).join('')}</table></div>`;
  }

  /* El Call-ID de SIP es largo; en la tabla se muestra recortado y
     completo al pasar el ratón y en el CSV. */
  const corto = (id) => (id && id.length > 18 ? id.slice(0, 16) + '…' : id || '—');

  function csv() {
    if (!ultimo || !ultimo.llamadas.length) {
      aviso('Primero consulta un periodo con llamadas.', 'av-a');
      return;
    }
    const cols = ['Fecha', 'Hora', 'Agente', 'Extensión', 'Campaña', 'Tipo', 'Número',
                  'Estado', 'Duración (s)', 'Tipificación', 'Observaciones', 'ID de la llamada'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const filas = ultimo.llamadas.map((l) => [l.fecha, l.hora, l.agente, l.extension, l.campana,
      l.direccion, l.numero, l.estado, l.segundos, l.resultado, l.observaciones, l.llamada]);

    /* BOM al inicio para que Excel respete las tildes */
    const texto = '\ufeff' + [cols, ...filas].map((f) => f.map(esc).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    a.download = `llamadas_${$r('rlDesde').value}_a_${$r('rlHasta').value}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  document.addEventListener('click', (ev) => {
    if (ev.target.closest('#btnRlConsultar')) consultar();
    if (ev.target.closest('#btnRlCsv')) csv();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'rlNumero') consultar();
  });

  return { abrir, consultar };
})();
