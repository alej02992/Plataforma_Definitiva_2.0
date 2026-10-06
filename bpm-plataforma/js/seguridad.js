/* ═══════════════════════════════════════════════════════════════════
   SEGURIDAD

   El administrador define las reglas de contraseñas y libera las
   cuentas bloqueadas.

   Las reglas viven en la base, no en el código: si mañana la empresa
   decide que son diez caracteres y no ocho, se cambia aquí y nadie
   tiene que entrar al servidor.
   ═══════════════════════════════════════════════════════════════════ */
'use strict';

const seguridad = (() => {
  const $g = (id) => document.getElementById(id);

  async function abrir() {
    await pintarPolitica();
    await pintarBloqueados();
  }

  /* ── Las reglas ── */

  async function pintarPolitica() {
    let p;
    try { p = await servicio.leerPolitica(); }
    catch (e) { aviso('No se pudo cargar la política: ' + e.message, 'av-a'); return; }

    $g('segExpira').value = p.dias_expiracion ?? 0;
    $g('segIntentos').value = p.intentos_maximos ?? 5;
    $g('segBloqueo').value = p.minutos_bloqueo ?? 0;
    $g('segHistorial').value = p.claves_recordadas ?? 10;
    $g('segInactivo').value = p.dias_inactividad ?? 0;
    $g('segLargo').value = p.largo_minimo ?? 8;
    $g('segMinus').checked = !!p.exige_minusculas;
    $g('segMayus').checked = !!p.exige_mayusculas;
    $g('segNum').checked = !!p.exige_numeros;
    $g('segEsp').checked = !!p.exige_especiales;
  }

  $g('btnSegGuardar').addEventListener('click', async () => {
    const datos = {
      dias_expiracion: Number($g('segExpira').value) || 0,
      intentos_maximos: Number($g('segIntentos').value) || 0,
      minutos_bloqueo: Number($g('segBloqueo').value) || 0,
      claves_recordadas: Number($g('segHistorial').value) || 0,
      dias_inactividad: Number($g('segInactivo').value) || 0,
      largo_minimo: Number($g('segLargo').value) || 8,
      exige_minusculas: $g('segMinus').checked ? 1 : 0,
      exige_mayusculas: $g('segMayus').checked ? 1 : 0,
      exige_numeros: $g('segNum').checked ? 1 : 0,
      exige_especiales: $g('segEsp').checked ? 1 : 0,
    };

    const btn = $g('btnSegGuardar');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const r = await servicio.guardarPolitica(datos);

      /* El servidor avisa de las reglas que suelen traer consecuencias
         que nadie previó. No impiden guardar: solo se dicen. */
      $g('segAvisos').innerHTML = (r.avisos || []).map((a) =>
        `<div class="aviso av-a" style="margin:0 0 8px">
          <svg viewBox="0 0 24 24"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>
          <div>${seguro.texto(a)}</div></div>`).join('');

      aviso('Política guardada.', 'av-b');
    } catch (e) {
      aviso(e.message, 'av-a');
    } finally {
      btn.disabled = false; btn.textContent = 'Guardar política';
    }
  });

  /* ── Cuentas bloqueadas ──
     Sin esta lista, el administrador no se entera de que alguien no
     puede entrar hasta que lo llamen por teléfono. */

  async function pintarBloqueados() {
    let lista = [];
    try { lista = await servicio.cuentasBloqueadas(); } catch { return; }

    $g('segN').textContent = lista.length;
    $g('tarjetaBloqueados').style.display = lista.length ? '' : 'none';
    if (!lista.length) return;

    const cuando = (f) => {
      const d = new Date(f);
      return d.getFullYear() >= 9999 ? 'Hasta que lo liberes'
        : d.toLocaleString('es-CO', { hour12: false }).slice(0, 16);
    };

    $g('tablaBloqueados').innerHTML = `<table class="tb">
      <tr><th>Usuario</th><th>Nombre</th><th>Correo</th><th>Fallos</th><th>Bloqueo</th><th></th></tr>
      ${lista.map((u) => `<tr>
        <td class="mono">${seguro.texto(u.usuario)}</td>
        <td><b>${seguro.texto(u.nombre)}</b></td>
        <td>${seguro.celda(u.correo)}</td>
        <td class="mono">${seguro.texto(u.intentos_fallidos)}</td>
        <td class="mono">${seguro.texto(cuando(u.bloqueado_hasta))}</td>
        <td style="text-align:right">
          <button class="b b-teal b-sm" data-liberar="${seguro.texto(u.id)}">Desbloquear</button>
        </td>
      </tr>`).join('')}</table>`;
  }

  $g('tablaBloqueados').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-liberar]');
    if (!b) return;

    b.disabled = true;
    try {
      const r = await servicio.desbloquearCuenta(b.dataset.liberar);
      await pintarBloqueados();
      aviso(`${r.nombre} ya puede entrar.`, 'av-b');
    } catch (err) {
      aviso(err.message, 'av-a');
      b.disabled = false;
    }
  });

  /* ── Inactivos ──
     Se lanza a mano y no solo: desactivar gente sin que nadie lo pida
     es el tipo de cosa que conviene que alguien decida. */
  $g('btnSegInactivos').addEventListener('click', async () => {
    const dias = Number($g('segInactivo').value) || 0;
    if (!dias) {
      aviso('Primero define cuántos días de inactividad y guarda la política.', 'av-a');
      return;
    }
    if (!confirm(`¿Desactivar a quienes no entran hace más de ${dias} días?\n\n` +
                 'Podrás reactivarlos después desde Usuarios y roles.')) return;

    try {
      const r = await servicio.desactivarInactivos();
      aviso(r.desactivados
        ? `${r.desactivados} usuario(s) desactivados por inactividad.`
        : 'No hay usuarios que lleven tanto tiempo sin entrar.', 'av-b');
    } catch (e) { aviso(e.message, 'av-a'); }
  });

  return { abrir };
})();
