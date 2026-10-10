/* ==========================================================================
   Plataforma Educativa · Reglas de calificación (puras, sin pantalla)
   - La nota que escribe el maestro se guarda SIN alterar.
   - La penalización por entrega tarde se aplica al calcular, según la regla de
     cada evaluación (nada, porcentaje o nota completa) y salvo excepción.
   ========================================================================== */

export const NOTA_APROBACION_DEFECTO = 60;

const num = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * ¿Se entregó tarde? Compara el día real de entrega (archivo subido o "Recibido"
 * del maestro) con la fecha de entrega de la evaluación. Sin fecha o sin registro
 * de entrega (p. ej. examen calificado directamente) se considera a tiempo.
 */
export function puntualidad(item, ent) {
    const entregado = String(ent?.EntregadoEn || '').slice(0, 10);
    const tarde = !!(item?.FechaEntrega && entregado && entregado > item.FechaEntrega);
    return { tarde, excepcion: !!ent?.Excepcion, entregado };
}

/** Descripción corta de la regla de la evaluación. */
export function reglaTexto(item) {
    if (item?.PenalizacionTipo === 'TOTAL') return 'Entrega tarde: pierde la nota completa';
    if (item?.PenalizacionTipo === 'PORCENTAJE') return `Entrega tarde: −${num(item.PenalizacionPct) || 0}%`;
    return 'Entrega tarde: sin penalización';
}

/** Nota efectiva = nota del maestro con la penalización aplicada (si corresponde). */
export function notaEfectiva(item, ent, notaCruda = ent?.Nota) {
    const nota = num(notaCruda);
    if (nota == null) return null;
    const p = puntualidad(item, ent);
    if (!p.tarde || p.excepcion) return nota;
    if (item?.PenalizacionTipo === 'TOTAL') return 0;
    if (item?.PenalizacionTipo === 'PORCENTAJE') {
        const pct = Math.min(100, Math.max(0, num(item.PenalizacionPct) || 0));
        return Math.round(nota * (1 - pct / 100) * 100) / 100;
    }
    return nota;
}

/** Nota mínima para aprobar el curso (la define el admin o el docente). */
export const notaAprobacion = (curso) => num(curso?.NotaAprobacion) ?? NOTA_APROBACION_DEFECTO;

/** 'aprobado' | 'reprobado' | 'sin-notas' */
export function estadoFinal(final, curso) {
    if (final == null) return 'sin-notas';
    return final >= notaAprobacion(curso) ? 'aprobado' : 'reprobado';
}
