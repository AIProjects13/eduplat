/* ==========================================================================
   Plataforma Educativa · Frontend (ES Modules, sin frameworks)
   --------------------------------------------------------------------------
   1. Configuración          6. Navegación / router
   2. Estado e índices       7. Vistas del TUTOR
   3. Utilidades             8. Vistas del ESTUDIANTE
   4. API (backend)          9. Vistas del PADRE y compartidas
   5. Motor de notas        10. UI (modales, toasts), acciones y arranque
   ========================================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    initializeAuth, browserSessionPersistence, onAuthStateChanged, signInWithEmailAndPassword,
    signOut, sendPasswordResetEmail, sendEmailVerification, updatePassword, connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    getFunctions, httpsCallable, connectFunctionsEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import {
    getFirestore, doc, onSnapshot, connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { ico, hydrateIcons } from './icons.js';
import { puntualidad, notaEfectiva, notaAprobacion, estadoFinal, reglaTexto } from './notas.js';

// ==========================================================================
// 1. CONFIGURACIÓN
// ==========================================================================

const CONFIG = {
    firebase: {
        apiKey: 'AIzaSyByeIG0WlV62IsuZvZmBMgPzE5fZXgoAJ8',
        authDomain: 'plataforma-educativa-729cf.firebaseapp.com',
        projectId: 'plataforma-educativa-729cf',
        storageBucket: 'plataforma-educativa-729cf.firebasestorage.app',
        messagingSenderId: '97714603498',
        appId: '1:97714603498:web:9be3461511e740a0af1e93',
    },
    FUNCTIONS_REGION: 'us-central1',
    // Entregas: se envían a Apps Script y se guardan en una carpeta PRIVADA de Google Drive.
    MAX_ENTREGA_MB: 10,
    EXTENSIONES: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
        'txt', 'rtf', 'csv', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'zip'],
    // Seguridad de sesión
    INACTIVIDAD_MIN: 30,        // cierre automático de sesión por inactividad
    MIN_CLAVE: 10,              // longitud mínima de la contraseña definitiva
    // Fotos de perfil: se guardan en Sheets como data URL base64 (celda máx. 50,000 caracteres).
    MAX_FOTO_MB: 10,            // tamaño máximo del archivo ORIGINAL que elige el usuario
    FOTO_PX: 160,               // se recorta a un cuadrado de 160×160
    FOTO_MAX_CHARS: 40000,      // margen de seguridad bajo el límite de la celda
    NOTA_APROBACION: 60,
    NOTA_DESTACADA: 85,
    MIN_JUSTIFICACION: 10,
    MAX_ALUMNOS_CURSO: 15,     // cupo por clase (el backend también lo valida)
};

// La interfaz solo oculta lo que cada rol no puede usar; los permisos reales los aplica el backend.
const ROLES = { ADMIN: 'ADMIN', TUTOR: 'TUTOR', ESTUDIANTE: 'ESTUDIANTE', PADRE: 'PADRE' };
const ROLE_LABEL = { ADMIN: 'Administrador', TUTOR: 'Tutor', ESTUDIANTE: 'Estudiante', PADRE: 'Padre/Madre' };
const TIPOS_ITEM = ['Tarea', 'Prueba', 'Examen', 'Proyecto'];
const TIPOS_CON_ENTREGA = ['Tarea', 'Proyecto'];
const ESTADOS_ASISTENCIA = ['Presente', 'Tarde', 'Ausente', 'Justificado'];

window.__tgtIniciada = true;   // avisa a boot-check.js que la app sí arrancó
hydrateIcons();

const firebaseApp = initializeApp(CONFIG.firebase);
// Sesión por pestaña: al cerrar el navegador se cierra la sesión (equipos compartidos).
const auth = initializeAuth(firebaseApp, { persistence: browserSessionPersistence });
const functions = getFunctions(firebaseApp, CONFIG.FUNCTIONS_REGION);
// Solo para escuchar la señal de cambios propia (las reglas no dejan leer nada más).
const firestore = getFirestore(firebaseApp);

// Modo pruebas: en tu PC, abre http://localhost:5600/?emulador=1 para usar los emuladores locales.
const USA_EMULADOR = ['localhost', '127.0.0.1'].includes(location.hostname)
    && new URLSearchParams(location.search).has('emulador');
if (USA_EMULADOR) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
    console.info('[Plataforma] Modo emulador: los datos son de prueba y viven solo en tu PC.');
}
const callApi = httpsCallable(functions, 'api', { timeout: 120000 });

// ==========================================================================
// 2. ESTADO E ÍNDICES
// ==========================================================================

const emptyDb = () => ({
    users: [], cursos: [], unidades: [], pensum: [], items: [], inscripciones: [],
    entregas: [], asistencia: [], auditoria: [], bitacora: [],
    noticias: [], lecturas: [], anotaciones: [], eventos: [],
    conversaciones: [], restricciones: [], contactosAdmin: [], materiales: [],
});

const state = {
    user: null,          // usuario de Firebase
    me: null,            // fila de "Usuarios"
    db: emptyDb(),
    route: { view: '', param: null },
    currentHash: '',
    usersFilter: { rol: 'ALL', q: '' },
    cursoTab: 'evaluaciones',
    gb: { cursoId: null, unidad: 'all', draft: new Map() },     // libro de calificaciones
    att: { cursoId: null, fecha: today(), draft: new Map() },   // asistencia
    auditEst: 'ALL',
    auditCheck: null,
    studentCurso: null,
    childId: null,
    busy: 0,
};

let idx = {};

function groupBy(arr, key) {
    const m = new Map();
    for (const r of arr) {
        const k = r[key];
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
    }
    return m;
}

function buildIndex() {
    const db = state.db;
    const alumnosByCurso = new Map();
    const cursosByAlumno = new Map();
    for (const r of db.inscripciones) {
        if (!alumnosByCurso.has(r.CursoID)) alumnosByCurso.set(r.CursoID, new Set());
        alumnosByCurso.get(r.CursoID).add(r.EstudianteID);
        if (!cursosByAlumno.has(r.EstudianteID)) cursosByAlumno.set(r.EstudianteID, []);
        cursosByAlumno.get(r.EstudianteID).push(r.CursoID);
    }
    const items = [...db.items].sort((a, b) =>
        (+a.Unidad - +b.Unidad) || String(a.FechaEntrega).localeCompare(String(b.FechaEntrega)) ||
        String(a.Titulo).localeCompare(String(b.Titulo), 'es'));

    // La administración es contacto de todos (para mensajes), aunque no venga en "users".
    const users = new Map(db.contactosAdmin.map(u => [u.ID, u]));
    db.users.forEach(u => users.set(u.ID, u));
    const materiales = [...db.materiales].sort((a, b) => String(a.Fecha).localeCompare(String(b.Fecha)));

    idx = {
        users,
        materialesByCurso: groupBy(materiales.filter(m => !m.ItemID), 'CursoID'),
        adjuntosByItem: groupBy(materiales.filter(m => m.ItemID), 'ItemID'),
        cursos: new Map(db.cursos.map(c => [c.CursoID, c])),
        items: new Map(items.map(i => [i.ItemID, i])),
        itemsByCurso: groupBy(items, 'CursoID'),
        unidadesByCurso: groupBy(db.unidades, 'CursoID'),
        pensumByCurso: groupBy(db.pensum, 'CursoID'),
        entregas: new Map(db.entregas.map(e => [`${e.EstudianteID}|${e.ItemID}`, e])),
        alumnosByCurso,
        cursosByAlumno,
    };
}

const students = () => state.db.users.filter(u => u.Rol === ROLES.ESTUDIANTE).sort(byName);
const alumnosDe = (cursoId) => [...(idx.alumnosByCurso.get(cursoId) || [])]
    .map(id => idx.users.get(id)).filter(Boolean).sort(byName);
const cursosDe = (estId) => (idx.cursosByAlumno.get(estId) || [])
    .map(id => idx.cursos.get(id)).filter(Boolean).sort((a, b) => a.NombreCurso.localeCompare(b.NombreCurso, 'es'));
const cursosOrdenados = () => [...state.db.cursos].sort((a, b) => a.NombreCurso.localeCompare(b.NombreCurso, 'es'));
const isAdmin = () => state.me?.Rol === ROLES.ADMIN;
/** ADMIN gestiona todos los cursos; un TUTOR solo los que tiene asignados. */
const canManage = (cursoId) => isAdmin() || idx.cursos.get(cursoId)?.TutorID === state.me?.ID;
const cursosGestionables = () => cursosOrdenados().filter(c => canManage(c.CursoID));
const tutorDe = (c) => idx.users.get(c?.TutorID)?.Nombre || 'Sin tutor asignado';
const cupoTexto = (n) => `${n}/${CONFIG.MAX_ALUMNOS_CURSO}`;
const cursoOpcion = (c) => [c.CursoID, c.NombreCurso];

const tutoresDisponibles = () => state.db.users.filter(u => u.Rol === ROLES.TUTOR || u.Rol === ROLES.ADMIN).sort(byName);
const notaGuardada = (estId, itemId) => toNum(idx.entregas.get(`${estId}|${itemId}`)?.Nota);

// ==========================================================================
// 3. UTILIDADES
// ==========================================================================

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function safeUrl(u) {
    try {
        const x = new URL(String(u));
        return ['http:', 'https:'].includes(x.protocol) ? x.href : '';
    } catch { return ''; }
}

/** Solo acepta fotos base64 JPEG/PNG/WebP (lo que guarda la app) o URLs https. */
function safeImg(v) {
    const s = String(v || '');
    if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
    return s.startsWith('https://') ? safeUrl(s) : '';
}

function toNum(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function today() { return new Date().toLocaleDateString('en-CA'); }

function byName(a, b) { return String(a.Nombre).localeCompare(String(b.Nombre), 'es'); }

function fmtNota(v) {
    return v == null ? '—' : v.toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function fmtPeso(v) {
    const n = toNum(v) ?? 0;
    return `${n.toLocaleString('es-GT', { maximumFractionDigits: 2 })}%`;
}

function fmtDate(s) {
    if (!s) return '—';
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    if (!d) return esc(s);
    return new Date(y, m - 1, d).toLocaleDateString('es-GT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(s) {
    if (!s) return '—';
    const time = String(s).slice(11, 16);
    return `${fmtDate(s)}${time ? ' · ' + time : ''}`;
}

/** Color de una nota: destacada (≥85), aprobada (≥ nota mínima del curso) o en riesgo. */
function gradeClass(v, aprob = CONFIG.NOTA_APROBACION) {
    if (v == null) return 'muted';
    if (v >= Math.max(CONFIG.NOTA_DESTACADA, aprob)) return 'good';
    return v >= aprob ? 'ok' : 'risk';
}

const ESTADO_FINAL = {
    aprobado: '<span class="badge badge-success">Aprobado</span>',
    reprobado: '<span class="badge badge-danger">Reprobado</span>',
    'sin-notas': '<span class="badge">Sin notas</span>',
};
const estadoBadge = (final, curso) => ESTADO_FINAL[estadoFinal(final, curso)];
const aprobDe = (cursoId) => notaAprobacion(idx.cursos.get(cursoId));

/** Nota efectiva guardada (con la penalización por tarde, si corresponde). */
function notaEfectivaDe(estId, itemId) {
    return notaEfectiva(idx.items.get(itemId), idx.entregas.get(`${estId}|${itemId}`));
}

/** Etiqueta de puntualidad de una entrega: tarde (con su regla), excepción o nada. */
function puntualidadBadge(item, ent) {
    const pu = puntualidad(item, ent);
    if (!pu.tarde) return '';
    if (pu.excepcion) return `<span class="badge badge-info" title="${esc(ent.Excepcion.Comentario)} · ${esc(ent.Excepcion.Por)}">Tarde · con excepción</span>`;
    const regla = item.PenalizacionTipo === 'TOTAL' ? 'pierde la nota' : item.PenalizacionTipo === 'PORCENTAJE' ? `−${item.PenalizacionPct}%` : 'sin descuento';
    return `<span class="badge badge-warn" title="${esc(reglaTexto(item))}">Tarde · ${regla}</span>`;
}

function mean(arr) {
    const xs = arr.filter(v => v != null);
    return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

function avatar(u, size = 'md') {
    const url = safeImg(u?.FotoURL);
    return url
        ? `<img class="avatar avatar-${size}" src="${esc(url)}" alt="" loading="lazy">`
        : `<span class="avatar avatar-${size}" aria-hidden="true">${esc(initials(u?.Nombre))}</span>`;
}

function person(u, sub) {
    return `<div class="person">${avatar(u, 'sm')}<div><strong>${esc(u?.Nombre || '—')}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`;
}

const gradePill = (v) => `<span class="grade-pill ${gradeClass(v)}">${fmtNota(v)}</span>`;
const tipoBadge = (t) => `<span class="badge tipo-${esc(t)}">${esc(t)}</span>`;
const ROLE_BADGE = { ADMIN: 'badge-solid', TUTOR: 'badge-brand', PADRE: 'badge-info', ESTUDIANTE: 'badge-success' };
const roleBadge = (r) => `<span class="badge ${ROLE_BADGE[r] || ''}">${esc(ROLE_LABEL[r] || r)}</span>`;
const bar = (v) => `<div class="bar ${gradeClass(v)}"><span style="width:${Math.max(0, Math.min(100, v ?? 0))}%"></span></div>`;

function sumBadge(sum, label = 'Suma') {
    const ok = Math.abs(sum - 100) < 0.01;
    const txt = ok ? `${label} 100% ${ico('check', 'icon-xs')}` : `${label} ${fmtPeso(sum)} · ${sum < 100 ? 'faltan' : 'sobran'} ${fmtPeso(Math.abs(100 - sum))}`;
    return `<span class="badge ${ok ? 'badge-success' : 'badge-warn'}">${txt}</span>`;
}

function emptyState(msg, icon = 'inbox', actionHtml = '') {
    return `<div class="empty"><div class="empty-icon">${ico(icon)}</div><p>${esc(msg)}</p>${actionHtml}</div>`;
}

function kpi(label, value, sub = '', icon = '', cls = '') {
    return `<div class="card kpi">
        ${icon ? `<div class="kpi-icon">${ico(icon)}</div>` : ''}
        <span class="kpi-label">${esc(label)}</span>
        <span class="kpi-value ${cls}">${value}</span>
        ${sub ? `<span class="kpi-sub">${esc(sub)}</span>` : ''}
    </div>`;
}

function options(list, selected) {
    return list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

/** Botón de descarga de una entrega (el archivo vive en Drive privado y pasa por la API). */
function entregaBtn(ent, label = `${ico('paperclip')} Ver archivo`, cls = 'btn btn-ghost btn-sm') {
    if (!ent?.TieneArchivo) return '';
    return `<button type="button" class="${cls}" data-action="download-entrega" data-id="${esc(ent.EntregaID)}"
        title="${esc(ent.ArchivoNombre || 'Descargar entrega')}">${label}</button>`;
}

function itemLink(item) {
    const url = safeUrl(item.EnlaceURL);
    return url
        ? `<a class="item-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(item.Titulo)} ${ico('arrow-up-right', 'icon-xs')}</a>`
        : `<span class="item-title">${esc(item.Titulo)}</span>`;
}

// ==========================================================================
// 4. API · Google Apps Script
// ==========================================================================

class ApiError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

// Mensajes para el usuario: nunca mencionan tecnologías. El detalle técnico va a la consola.
const MSG = {
    CONFIG: 'La plataforma no está disponible en este momento. Contacta al administrador.',
    NETWORK: 'No hay conexión. Revisa tu internet e intenta de nuevo.',
    BAD_RESPONSE: 'No pudimos confirmar si la operación se completó. Revisa la información actualizada antes de intentarlo de nuevo.',
};

// Acciones de solo lectura: es seguro reintentarlas si la respuesta llega incompleta.
const READ_ACTIONS = new Set(['getSnapshot', 'getEntregaFile', 'verifyAudit', 'getNoticiaFoto', 'noticiaDetalle', 'getMensajes', 'getMaterialFile', 'marcarLeida']);

async function api(action, payload = {}, { forceRefresh = false, retried = false } = {}) {
    if (!auth.currentUser) throw new ApiError('UNAUTHENTICATED', 'Tu sesión no está iniciada.');
    // El token viaja automáticamente con la llamada; se renueva cuando se pide (p. ej. tras cambiar la contraseña).
    if (forceRefresh) await auth.currentUser.getIdToken(true);

    if (!READ_ACTIONS.has(action)) state.ultimaEscritura = Date.now();
    let json;
    try {
        json = (await callApi({ action, payload })).data;
    } catch (e) {
        console.error(`[Plataforma] Falló la llamada (${action}):`, e);
        if (e?.code === 'functions/unauthenticated') {
            if (state.me) setTimeout(() => signOut(auth), 1500);
            throw new ApiError('UNAUTHENTICATED', 'Tu sesión expiró o no es válida. Vuelve a iniciar sesión.');
        }
        throw new ApiError('NETWORK', MSG.NETWORK);
    }
    if (!json || typeof json !== 'object') {
        console.error(`[Plataforma] Respuesta no válida del backend (${action}):`, json);
        throw new ApiError('BAD_RESPONSE', MSG.BAD_RESPONSE);
    }
    // Respuesta "ok" pero sin datos: no es la respuesta de la acción pedida.
    if (json.ok && !Object.prototype.hasOwnProperty.call(json, 'data')) {
        console.error(`[Plataforma] Respuesta incompleta del backend (${action}):`, json);
        if (!retried && READ_ACTIONS.has(action)) return api(action, payload, { forceRefresh, retried: true });
        throw new ApiError('BAD_RESPONSE', MSG.BAD_RESPONSE);
    }
    if (!json.ok) {
        const err = new ApiError(json.error?.code || 'ERROR', json.error?.message || 'Error desconocido.');
        // Sesión revocada o contraseña temporal pendiente: se resuelve fuera de la vista actual.
        if (err.code === 'PASSWORD_CHANGE_REQUIRED' && state.me) showPasswordScreen();
        if (err.code === 'UNAUTHENTICATED' && state.me) setTimeout(() => signOut(auth), 1500);
        throw err;
    }
    return json.data;
}

async function loadSnapshot(opts) {
    const data = await api('getSnapshot', {}, opts);
    state.me = data.me;
    state.db = { ...emptyDb(), ...data };
    buildIndex();
}

/** Ejecuta una operación mostrando la barra de progreso. */
async function withBusy(fn) {
    state.busy++;
    $('#busy-bar').classList.add('is-active');
    try { return await fn(); } finally {
        state.busy--;
        if (!state.busy) $('#busy-bar').classList.remove('is-active');
    }
}

async function refresh() {
    await withBusy(loadSnapshot);
    renderChrome();
    render();
}

// --------------------------------------------------------------------------
// Tiempo real: cuando a esta persona le cambia algo (lo hizo otro usuario), el
// servidor toca su señal; aquí se escucha y se recargan los datos solos.
// No recarga encima de trabajo sin guardar, de un formulario abierto ni de un
// campo en edición: espera a que termine.
// --------------------------------------------------------------------------

const senal = { unsub: null, pendiente: false, timer: null };

function escucharCambios() {
    dejarDeEscuchar();
    if (!auth.currentUser) return;
    let primera = true;
    senal.unsub = onSnapshot(doc(firestore, 'senales', auth.currentUser.uid), (snap) => {
        if (primera) { primera = false; return; }          // estado inicial: los datos ya están cargados
        const d = snap.data();
        if (!d) return;
        // Cambio hecho desde esta misma pestaña: ya se recargó al guardar.
        if (d.Propio && Date.now() - (state.ultimaEscritura || 0) < 15000) return;
        senal.pendiente = true;
        programarRecarga(600);
    }, (e) => console.warn('[Plataforma] Sin actualización en tiempo real:', e.code || e));
}

function dejarDeEscuchar() {
    senal.unsub?.();
    senal.unsub = null;
    senal.pendiente = false;
    clearTimeout(senal.timer);
}

function programarRecarga(ms) {
    clearTimeout(senal.timer);
    senal.timer = setTimeout(recargarSiSePuede, ms);
}

function ocupado() {
    const activo = document.activeElement;
    // Escribir en el chat no bloquea: lo escrito se conserva al recargar.
    const editando = activo && $('#view').contains(activo) && activo.matches('input, textarea, select, [contenteditable]') && !activo.closest('.chat-compose');
    return hasUnsavedWork() || $('#modal').open || state.busy > 0 || editando || document.hidden;
}

async function recargarSiSePuede() {
    if (!senal.pendiente || !state.me || $('#screen-app').hidden) return;
    if (ocupado()) return programarRecarga(2500);
    senal.pendiente = false;
    const y = window.scrollY;
    try {
        await withBusy(loadSnapshot);
        if (ocupado()) { senal.pendiente = true; return programarRecarga(2500); }   // empezó a escribir mientras cargaba
        const borrador = $('.chat-compose textarea');
        const texto = borrador?.value || '', conFoco = borrador && document.activeElement === borrador;
        renderChrome();
        render();
        window.scrollTo(0, y);
        const nuevo = $('.chat-compose textarea');
        if (nuevo && texto) nuevo.value = texto;
        if (nuevo && conFoco) nuevo.focus();
    } catch (e) {
        if (!(e instanceof ApiError)) console.error('[Plataforma] Error al actualizar:', e);
    }
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && senal.pendiente) programarRecarga(300); });

/** Guarda con el servidor y recarga los datos. Devuelve true si todo salió bien. */
async function mutate(action, payload, successMsg) {
    try {
        const r = await withBusy(() => api(action, payload));
        if (successMsg) toast(typeof successMsg === 'function' ? successMsg(r) : successMsg, 'success');
        await refresh();
        return r ?? true;
    } catch (e) {
        toast(e.message, 'error');
        if (e.code === 'BAD_RESPONSE') refresh().catch(() => {});   // muestra si el cambio sí se guardó
        return null;
    }
}

// ==========================================================================
// 5. MOTOR DE NOTAS PONDERADAS (tiempo real)
// --------------------------------------------------------------------------
//  Promedio de unidad  = Σ(nota·peso) / Σ(peso de lo YA evaluado)
//  Acumulado de unidad = Σ(nota·peso) / Σ(peso total de la unidad)  → puntos ganados
//  Promedio final      = Σ(promUnidad·pesoUnidad) / Σ(peso de unidades con nota)
//  Si el curso no tiene unidades configuradas, todas pesan lo mismo.
// ==========================================================================

const Grades = {
    units(cursoId) {
        const defined = idx.unidadesByCurso.get(cursoId) || [];
        const items = idx.itemsByCurso.get(cursoId) || [];
        const nums = [...new Set([...defined.map(u => +u.Unidad), ...items.map(i => +i.Unidad)])].sort((a, b) => a - b);
        const equal = defined.length === 0 && nums.length ? 100 / nums.length : 0;
        return nums.map(n => {
            const def = defined.find(u => +u.Unidad === n);
            return {
                numero: n,
                id: def?.UnidadID || null,
                nombre: def?.NombreUnidad || `Unidad ${n}`,
                peso: def ? (toNum(def.Ponderacion) ?? 0) : equal,
                definida: !!def,
                items: items.filter(i => +i.Unidad === n),
            };
        });
    },

    weighted(pairs) {
        const withV = pairs.filter(p => p.valor != null);
        if (!withV.length) return null;
        const sw = withV.reduce((s, p) => s + p.peso, 0);
        if (sw <= 0) return mean(withV.map(p => p.valor));
        return withV.reduce((s, p) => s + p.valor * p.peso, 0) / sw;
    },

    /** notaDe(itemId) → number|null. Permite usar notas guardadas o borradores. */
    course(cursoId, notaDe) {
        const units = this.units(cursoId).map(u => {
            const pairs = u.items.map(i => ({ valor: notaDe(i.ItemID), peso: toNum(i.Ponderacion) ?? 0 }));
            const pesoTotal = pairs.reduce((s, p) => s + p.peso, 0);
            const pesoEvaluado = pairs.filter(p => p.valor != null).reduce((s, p) => s + p.peso, 0);
            const puntos = pairs.filter(p => p.valor != null).reduce((s, p) => s + p.valor * p.peso, 0);
            return {
                ...u,
                promedio: this.weighted(pairs),
                acumulado: pesoTotal > 0 && pesoEvaluado > 0 ? puntos / pesoTotal : null,
                pesoTotal, pesoEvaluado,
            };
        });
        return { units, final: this.weighted(units.map(u => ({ valor: u.promedio, peso: u.peso }))) };
    },

    forStudent(estId, cursoId) {
        return this.course(cursoId, itemId => notaEfectivaDe(estId, itemId));
    },

    general(estId) {
        return mean(cursosDe(estId).map(c => this.forStudent(estId, c.CursoID).final));
    },
};

function attendanceStats(estId, cursoId = null) {
    const rows = state.db.asistencia.filter(a => a.EstudianteID === estId && (!cursoId || a.CursoID === cursoId));
    const c = { Presente: 0, Tarde: 0, Ausente: 0, Justificado: 0 };
    rows.forEach(r => { if (r.Estado in c) c[r.Estado]++; });
    const base = c.Presente + c.Tarde + c.Ausente;
    return { ...c, total: rows.length, pct: base ? ((c.Presente + c.Tarde) / base) * 100 : null, rows };
}

// ==========================================================================
// 6. NAVEGACIÓN / ROUTER (hash)
// ==========================================================================

/** Menú por categorías (acordeones). Cada entrada: [vista, etiqueta, ícono]. */
/** Menú por categorías (acordeones). Cada entrada: [vista, etiqueta, ícono]. */
const COMUNICACION = ['Comunicación', [['muro', 'Muro', 'newspaper'], ['mensajes', 'Mensajes', 'message-square'], ['agenda', 'Agenda', 'calendar-days']]];
const NAV = {
    ADMIN: [
        ['General', [['dashboard', 'Resumen', 'layout-dashboard']]],
        COMUNICACION,
        ['Académico', [['grados', 'Grados', 'school'], ['cursos', 'Cursos', 'book-open'], ['calificaciones', 'Calificaciones', 'clipboard-list'], ['asistencia', 'Asistencia', 'calendar-check']]],
        ['Administración', [['usuarios', 'Usuarios', 'users'], ['auditoria', 'Auditoría', 'history']]],
        ['Mi cuenta', [['perfil', 'Mi perfil', 'circle-user']]],
    ],
    TUTOR: [
        ['General', [['dashboard', 'Resumen', 'layout-dashboard']]],
        COMUNICACION,
        ['Mis clases', [['grados', 'Grados', 'school'], ['cursos', 'Mis cursos', 'book-open'], ['usuarios', 'Mis estudiantes', 'graduation-cap']]],
        ['Evaluación', [['calificaciones', 'Calificaciones', 'clipboard-list'], ['asistencia', 'Asistencia', 'calendar-check'], ['auditoria', 'Bitácora', 'history']]],
        ['Mi cuenta', [['perfil', 'Mi perfil', 'circle-user']]],
    ],
    ESTUDIANTE: [
        ['General', [['inicio', 'Inicio', 'house']]],
        COMUNICACION,
        ['Mis estudios', [['mis-cursos', 'Mis cursos', 'book-open'], ['mi-asistencia', 'Asistencia', 'calendar-check']]],
        ['Mi cuenta', [['perfil', 'Mi perfil', 'circle-user']]],
    ],
    PADRE: [
        COMUNICACION,
        ['Mis hijos', [['progreso', 'Progreso', 'trending-up']]],
    ],
};
// Alumnos y padres entran primero al muro (noticias y pendientes).
const HOME = { ADMIN: 'dashboard', TUTOR: 'dashboard', ESTUDIANTE: 'muro', PADRE: 'muro' };

const T = [ROLES.ADMIN, ROLES.TUTOR], E = [ROLES.ESTUDIANTE], P = [ROLES.PADRE];
const VIEWS = {
    dashboard:       { roles: T, title: () => 'Resumen', render: viewTutorDashboard },
    usuarios:        { roles: T, title: () => isAdmin() ? 'Usuarios' : 'Mis estudiantes', render: viewUsuarios },
    estudiante:      { roles: T, nav: 'usuarios', title: id => idx.users.get(id)?.Nombre || 'Estudiante', render: viewTutorStudent },
    cursos:          { roles: T, title: () => isAdmin() ? 'Cursos' : 'Mis cursos', render: viewCursos },
    curso:           { roles: T, nav: 'cursos', title: id => idx.cursos.get(id)?.NombreCurso || 'Curso', render: viewCursoDetalle },
    calificaciones:  { roles: T, title: () => 'Libro de calificaciones', render: viewCalificaciones, after: gbAfterRender },
    asistencia:      { roles: T, title: () => 'Asistencia', render: viewAsistencia },
    auditoria:       { roles: T, title: () => isAdmin() ? 'Auditoría' : 'Bitácora de mis estudiantes', render: viewAuditoria },
    grados:          { roles: T, title: () => 'Grados', render: viewGrados },
    grado:           { roles: T, nav: 'grados', title: g => g || 'Grado', render: viewGrado },
    agenda:          { roles: [ROLES.ADMIN, ROLES.TUTOR, ROLES.ESTUDIANTE, ROLES.PADRE], title: () => 'Agenda', render: viewAgenda, after: agendaAfter },
    mensajes:        { roles: [ROLES.ADMIN, ROLES.TUTOR, ROLES.ESTUDIANTE, ROLES.PADRE], title: () => 'Mensajes', render: viewMensajes, after: mensajesAfter },
    inicio:          { roles: E, title: () => 'Inicio', render: viewStudentHome },
    'mis-cursos':    { roles: E, title: () => 'Mis cursos', render: viewStudentCursos },
    'mi-asistencia': { roles: E, title: () => 'Mi asistencia', render: viewStudentAsistencia },
    progreso:        { roles: P, title: () => 'Progreso académico', render: viewParent },
    muro:            { roles: [ROLES.ADMIN, ROLES.TUTOR, ROLES.ESTUDIANTE, ROLES.PADRE], title: () => 'Muro', render: viewMuro, after: cargarFotosMuro },
    perfil:          { roles: [ROLES.ADMIN, ROLES.TUTOR, ROLES.ESTUDIANTE], title: () => 'Mi perfil', render: viewPerfil },
};

function parseHash() {
    const [view = '', param = ''] = location.hash.replace(/^#\/?/, '').split('/');
    return { view: decodeURIComponent(view), param: param ? decodeURIComponent(param) : null };
}

function go(view, param = null) {
    const hash = `#/${view}${param ? '/' + encodeURIComponent(param) : ''}`;
    if (location.hash === hash) render();
    else location.hash = hash;
}

function hasUnsavedWork() {
    return state.gb.draft.size > 0 || state.att.draft.size > 0;
}

function discardDrafts() {
    state.gb.draft.clear();
    state.att.draft.clear();
}

window.addEventListener('hashchange', () => {
    if (!state.me) return;
    if (hasUnsavedWork()) {
        if (!confirm('Tienes cambios sin guardar. ¿Salir y descartarlos?')) {
            history.replaceState(null, '', state.currentHash);
            return;
        }
        discardDrafts();
    }
    render();
});

window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedWork()) { e.preventDefault(); e.returnValue = ''; }
});

function render() {
    const { view, param } = parseHash();
    const def = VIEWS[view];
    if (!def || !def.roles.includes(state.me.Rol)) {
        history.replaceState(null, '', `#/${HOME[state.me.Rol]}`);
        return render();
    }
    state.route = { view, param };
    state.currentHash = location.hash;
    $('#page-title').textContent = def.title(param);
    document.title = `${def.title(param)} · Plataforma Educativa`;
    $$('#nav .nav-link').forEach(a => a.toggleAttribute('aria-current', a.dataset.view === (def.nav || view)));
    $$('#nav .nav-link[aria-current]').forEach(a => a.setAttribute('aria-current', 'page'));
    const grupoActual = $('#nav .nav-link[aria-current]')?.closest('.nav-group');
    if (grupoActual && !grupoActual.classList.contains('is-open')) toggleGrupo(grupoActual, true);
    $('#view').innerHTML = def.render(param);
    def.after?.(param);
    $('#screen-app').classList.remove('sidebar-open');
    aplicarMenuOculto();
}

// Preferencias del menú (solo de este navegador; si no se pueden guardar, no pasa nada).
const PREF = {
    get(k, def) { try { const v = localStorage.getItem(`pe-${k}`); return v == null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem(`pe-${k}`, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const esEscritorio = () => matchMedia('(min-width: 961px)').matches;

function toggleGrupo(g, abrir = !g.classList.contains('is-open')) {
    g.classList.toggle('is-open', abrir);
    g.querySelector('.nav-group-head').setAttribute('aria-expanded', String(abrir));
    const abiertos = new Set(PREF.get('menu-abiertos', []));
    abrir ? abiertos.add(g.dataset.group) : abiertos.delete(g.dataset.group);
    PREF.set('menu-abiertos', [...abiertos]);
}

function aplicarMenuOculto() {
    const oculto = esEscritorio() && PREF.get('menu-oculto', false);
    $('#screen-app').classList.toggle('sidebar-collapsed', oculto);
    const btn = $('.menu-btn');
    const abierto = esEscritorio() ? !oculto : $('#screen-app').classList.contains('sidebar-open');
    btn?.setAttribute('aria-expanded', String(abierto));
    btn?.setAttribute('aria-label', abierto ? 'Ocultar menú' : 'Mostrar menú');
}

function renderChrome() {
    const me = state.me;
    const abiertos = new Set(PREF.get('menu-abiertos', []));
    $('#nav').innerHTML = NAV[me.Rol].map(([grupo, links]) => {
        const abierto = abiertos.has(grupo);
        return `<div class="nav-group${abierto ? ' is-open' : ''}" data-group="${esc(grupo)}">
            <button type="button" class="nav-group-head" data-action="nav-group" aria-expanded="${abierto}"><span>${esc(grupo)}</span>${ico('chevron-down', 'icon-sm')}</button>
            <div class="nav-group-body"><div>${links.map(([v, label, icon]) =>
                `<a class="nav-link" href="#/${v}" data-view="${v}"><span class="nav-icon">${ico(icon)}</span>${esc(label)}${v === 'mensajes' ? '<span class="nav-badge" data-nav-badge hidden></span>' : ''}</a>`).join('')}</div></div>
        </div>`;
    }).join('');
    actualizarInsignia();
    aplicarMenuOculto();
    $('#user-chip').innerHTML = `${avatar(me)}<div><strong>${esc(me.Nombre)}</strong>${roleBadge(me.Rol)}</div>`;
}

function showScreen(name) {
    hideAllPasswords();
    for (const s of ['loading', 'login', 'denied', 'password', 'app']) $(`#screen-${s}`).hidden = s !== name;
}

// ==========================================================================
// 7. VISTAS DEL TUTOR
// ==========================================================================

// ---------- 7.1 Resumen ----------

function viewTutorDashboard() {
    const db = state.db;
    const admin = isAdmin();
    // Tutor: solo sus cursos asignados. Admin: todos.
    const cursos = cursosGestionables();
    const propios = new Set(cursos.map(c => c.CursoID));
    const est = admin ? students() : [...new Set(cursos.flatMap(c => alumnosDe(c.CursoID).map(a => a.ID)))];
    const padres = db.users.filter(u => u.Rol === ROLES.PADRE);
    const tutores = db.users.filter(u => u.Rol === ROLES.TUTOR);
    const porCalificar = db.entregas
        .filter(e => e.Estado === 'Entregado' && toNum(e.Nota) == null && propios.has(idx.items.get(e.ItemID)?.CursoID))
        .sort((a, b) => String(b.Fecha).localeCompare(String(a.Fecha)));
    const asistRows = db.asistencia.filter(a => propios.has(a.CursoID));
    const asist = (() => {
        const c = { p: 0, b: 0 };
        asistRows.forEach(a => {
            if (a.Estado === 'Presente' || a.Estado === 'Tarde') { c.p++; c.b++; } else if (a.Estado === 'Ausente') c.b++;
        });
        return c.b ? (c.p / c.b) * 100 : null;
    })();
    const nItems = cursos.reduce((s, c) => s + (idx.itemsByCurso.get(c.CursoID) || []).length, 0);

    const filasCursos = cursos.map(c => {
        const alumnos = alumnosDe(c.CursoID);
        const finales = alumnos.map(a => Grades.forStudent(a.ID, c.CursoID).final);
        const prom = mean(finales);
        const aprob = aprobDe(c.CursoID);
        const aprobados = finales.filter(f => f != null && f >= aprob).length;
        const riesgo = finales.filter(f => f != null && f < aprob).length;
        return `<tr>
            <td><a href="#/curso/${encodeURIComponent(c.CursoID)}"><strong>${esc(c.NombreCurso)}</strong></a></td>
            ${admin ? `<td>${esc(tutorDe(c))}</td>` : ''}
            <td class="num">${cupoTexto(alumnos.length)}</td>
            <td class="num">${(idx.itemsByCurso.get(c.CursoID) || []).length}</td>
            <td class="center">${gradePill(prom)}</td>
            <td class="center"><span class="badge badge-success">${aprobados}</span> <span class="badge ${riesgo ? 'badge-danger' : ''}">${riesgo}</span>
                <small class="muted">(mín. ${aprob})</small></td>
            <td class="actions"><button class="btn btn-ghost btn-sm" data-action="open-gradebook" data-curso="${esc(c.CursoID)}">Calificar</button></td>
        </tr>`;
    }).join('');

    const filasPend = porCalificar.slice(0, 8).map(e => {
        const it = idx.items.get(e.ItemID);
        return `<li class="item-row">
            ${tipoBadge(it.Tipo)}
            <div class="item-main"><strong>${esc(it.Titulo)}</strong>
                <div class="item-meta"><span>${esc(idx.users.get(e.EstudianteID)?.Nombre || e.EstudianteID)}</span><span>${esc(idx.cursos.get(it.CursoID)?.NombreCurso || '')}</span><span>Entregado ${fmtDateTime(e.Fecha)}</span></div>
            </div>
            <div class="item-side">
                ${entregaBtn(e)}
                <button class="btn btn-primary btn-sm" data-action="open-gradebook" data-curso="${esc(it.CursoID)}">Calificar</button>
            </div>
        </li>`;
    }).join('');

    return `
    <div class="grid grid-kpi">
        ${kpi(admin ? 'Estudiantes' : 'Mis estudiantes', est.length, admin ? `${padres.length} padres · ${tutores.length} tutores` : '', 'graduation-cap')}
        ${kpi(admin ? 'Cursos activos' : 'Mis cursos', cursos.length, `${nItems} evaluaciones`, 'book-open')}
        ${kpi('Por calificar', porCalificar.length, 'Entregas sin nota', 'inbox', porCalificar.length ? 'grade ok' : '')}
        ${kpi(admin ? 'Asistencia global' : 'Asistencia en mis cursos', asist == null ? '—' : `${fmtNota(asist)}%`, `${asistRows.length} registros`, 'calendar-check')}
    </div>

    <section class="card">
        <div class="card-head"><h2>Rendimiento por curso</h2>
            ${admin ? '<button class="btn btn-primary btn-sm" data-action="new-course">+ Nuevo curso</button>' : ''}</div>
        ${cursos.length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Curso</th>${admin ? '<th>Tutor</th>' : ''}<th class="num">Estudiantes</th><th class="num">Evaluaciones</th><th class="center">Promedio</th><th class="center">Aprobados / Reprobados</th><th></th></tr></thead>
            <tbody>${filasCursos}</tbody></table></div>`
        : emptyState(admin ? 'Aún no hay cursos. Crea el primero y asígnale un tutor.' : 'Aún no tienes cursos asignados. El administrador te los asignará.', 'book-open')}
    </section>

    <section class="card">
        <div class="card-head"><h2>Entregas por calificar</h2>${porCalificar.length > 8 ? `<span class="badge">+${porCalificar.length - 8} más</span>` : ''}</div>
        ${porCalificar.length ? `<ul class="item-list">${filasPend}</ul>` : emptyState('No hay entregas pendientes. ¡Todo al día!', 'circle-check')}
    </section>`;
}

// ---------- 7.2 Usuarios ----------

function viewUsuarios() {
    const f = state.usersFilter;
    const admin = isAdmin();
    // El tutor solo ve a sus estudiantes y a los padres de ellos (lo filtra el backend).
    const tabs = admin
        ? [['ALL', 'Todos'], ['ESTUDIANTE', 'Estudiantes'], ['PADRE', 'Padres'], ['TUTOR', 'Tutores y admins']]
        : [['ESTUDIANTE', 'Estudiantes'], ['PADRE', 'Padres']];
    if (!tabs.some(([v]) => v === f.rol)) f.rol = tabs[0][0];
    return `
    ${admin ? '' : `<p class="alert alert-info">${ico('info')}<span>Estudiantes inscritos en tus cursos. Puedes ver su progreso completo en solo lectura; las cuentas las gestiona el administrador.</span></p>`}
    <div class="section-title">
        <div class="tabs" role="tablist">${tabs.map(([v, l]) =>
            `<button class="tab" role="tab" aria-selected="${f.rol === v}" data-action="users-rol" data-rol="${v}">${l}</button>`).join('')}</div>
        <div class="row">
            <input type="search" class="inline-select" placeholder="Buscar por nombre, correo o grado…" value="${esc(f.q)}" data-input="users-q" aria-label="Buscar usuarios">
            ${(() => {
                const grados = [...new Set(state.db.users.filter(u => u.Rol === ROLES.ESTUDIANTE).map(u => u.Grado).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
                return grados.length > 1 ? `<select class="inline-select" data-change="users-grado" aria-label="Filtrar por grado"><option value="">Todos los grados</option>${grados.map(g => `<option ${f.grado === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>` : '';
            })()}
            ${admin ? '<button class="btn btn-primary" data-action="new-user">+ Nuevo usuario</button>' : ''}
        </div>
    </div>
    <section class="card" id="users-table">${usersTable()}</section>`;
}

function usersTable() {
    const { rol, q, grado = '' } = state.usersFilter;
    const admin = isAdmin();
    const palabras = norm(q).split(/\s+/).filter(Boolean);
    const matchRol = (u) => rol === 'ALL' || u.Rol === rol || (rol === 'TUTOR' && u.Rol === ROLES.ADMIN);
    const gradoDeU = (u) => (u.Rol === ROLES.PADRE
        ? String(u.HijosIDs || '').split(',').map(id => idx.users.get(id)?.Grado).filter(Boolean)
        : [u.Grado]);
    const todos = state.db.users
        .filter(u => u.ID !== state.me.ID && matchRol(u) &&
            (!grado || gradoDeU(u).includes(grado)) &&
            palabras.every(w => norm(`${u.Nombre} ${u.Email} ${u.Grado}`).includes(w)))
        .sort(byName);
    if (!todos.length) return emptyState('No hay usuarios que coincidan. Prueba con otro nombre o grado.', 'search');
    const limite = state.usersFilter.limite || 50;
    const list = todos.slice(0, limite);

    const rows = list.map(u => {
        let rel = '—';
        if (u.Rol === ROLES.PADRE) {
            const hijos = String(u.HijosIDs || '').split(',').filter(Boolean).map(id => idx.users.get(id)?.Nombre).filter(Boolean);
            rel = hijos.length ? esc(hijos.join(', ')) : '<span class="muted">Sin hijos vinculados</span>';
        } else if (u.Rol === ROLES.ESTUDIANTE) {
            const cursos = cursosDe(u.ID);
            const conmigo = cursos.filter(c => c.TutorID === state.me.ID).length;
            rel = `${cursos.length} curso${cursos.length === 1 ? '' : 's'}${!admin ? ` · ${conmigo} contigo` : ''}`;
        } else if (u.Rol === ROLES.TUTOR || u.Rol === ROLES.ADMIN) {
            const asignados = state.db.cursos.filter(c => c.TutorID === u.ID).map(c => c.NombreCurso);
            rel = asignados.length ? esc(asignados.join(', ')) : '<span class="muted">Sin cursos asignados</span>';
        }
        const editable = admin && u.Rol !== ROLES.ADMIN;
        return `<tr>
            <td><div class="person">${avatar(u)}<div><strong>${esc(u.Nombre)}</strong><small>${esc(u.Email || '')}</small></div></div></td>
            <td>${roleBadge(u.Rol)}</td>
            <td>${esc(u.Grado || '—')}</td>
            <td class="wrap">${rel}</td>
            ${admin ? `<td>${u.Vinculado ? '<span class="badge badge-success">Activa</span>' : '<span class="badge badge-warn" title="Se vinculará cuando inicie sesión por primera vez">Pendiente</span>'}${u.DebeCambiarClave === 'SI' ? ' <span class="badge" title="Aún no cambia su contraseña temporal">Clave temporal</span>' : ''}</td>` : ''}
            <td class="actions">
                ${u.Rol === ROLES.ESTUDIANTE ? `<a class="btn btn-ghost btn-sm" href="#/estudiante/${encodeURIComponent(u.ID)}">Ver progreso</a>` : ''}
                ${puedoEscribirA(u) ? `<button class="icon-btn" data-action="nuevo-mensaje" data-para="${esc(u.ID)}" title="Enviar mensaje" aria-label="Enviar mensaje a ${esc(u.Nombre)}">${ico('message-square')}</button>` : ''}
                ${editable ? `<button class="icon-btn" data-action="edit-user" data-id="${esc(u.ID)}" aria-label="Editar ${esc(u.Nombre)}" title="Editar">${ico('pencil')}</button>
                <button class="icon-btn danger" data-action="delete-user" data-id="${esc(u.ID)}" aria-label="Eliminar ${esc(u.Nombre)}" title="Eliminar">${ico('trash')}</button>` : ''}
            </td></tr>`;
    }).join('');

    return `<div class="table-wrap"><table class="table">
        <thead><tr><th>Usuario</th><th>Rol</th><th>Grado</th><th>${admin ? 'Vínculo / cursos' : 'Vínculo'}</th>${admin ? '<th>Cuenta</th>' : ''}<th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>
        <div class="picker-foot" style="padding:12px 18px"><small>${list.length < todos.length ? `Mostrando ${list.length} de ${todos.length}` : `${todos.length} usuario(s)`}</small>
            ${list.length < todos.length ? '<button class="btn btn-ghost btn-sm" data-action="users-mas">Mostrar más</button>' : ''}</div>`;
}

function justificationField(help = 'Explica el motivo del cambio. Queda registrado en la auditoría y es visible para los padres.') {
    return `<label class="field justify-box">
        <span>Comentario explicativo / Justificación *</span>
        <textarea name="justificacion" required minlength="${CONFIG.MIN_JUSTIFICACION}" maxlength="1000" placeholder="Ej.: Se corrige la nota por error de digitación en la prueba corta 2."></textarea>
        <small class="field-hint">${esc(help)} Mínimo ${CONFIG.MIN_JUSTIFICACION} caracteres.</small>
    </label>`;
}

function userForm(u = null) {
    const isEdit = !!u;
    const rol = u?.Rol || ROLES.ESTUDIANTE;
    const hijos = new Set(String(u?.HijosIDs || '').split(',').filter(Boolean));
    const est = students();
    return `
    <div class="form-grid">
        <label class="field span-all"><span>Nombre completo *</span>
            <input name="Nombre" required maxlength="120" value="${esc(u?.Nombre)}" autocomplete="off"></label>
        <label class="field"><span>Correo electrónico *</span>
            <input type="email" name="Email" required value="${esc(u?.Email)}" ${isEdit ? 'disabled' : ''} autocomplete="off"></label>
        <label class="field"><span>Rol *</span>
            <select name="Rol" ${isEdit ? 'disabled' : ''} data-change="user-form-rol">
                ${options([[ROLES.ESTUDIANTE, 'Estudiante'], [ROLES.PADRE, 'Padre / Madre'], [ROLES.TUTOR, 'Tutor'],
                    ...(rol === ROLES.ADMIN ? [[ROLES.ADMIN, 'Administrador']] : [])], rol)}
            </select></label>
        ${isEdit ? '' : `<label class="field span-all"><span>Contraseña temporal *</span>
            <input type="text" name="password" required minlength="10" maxlength="64" autocomplete="new-password" value="${esc(tempPassword())}">
            <small class="field-hint">Compártela en persona o por un canal privado. En su primer ingreso el sistema le obligará a crear su propia contraseña.</small></label>`}
        <label class="field"><span>Fecha de nacimiento</span>
            <input type="date" name="FechaNacimiento" value="${esc(u?.FechaNacimiento)}"></label>
        <label class="field"><span>Grado / Nivel académico</span>
            <input name="Grado" maxlength="80" value="${esc(u?.Grado)}" placeholder="Ej.: 3ro Básico"></label>
        <fieldset class="field span-all" data-role-only="PADRE" ${rol === ROLES.PADRE ? '' : 'hidden'} style="border:0;padding:0;margin:0">
            <span>Hijos vinculados (lectura de su progreso)</span>
            ${picker({ name: 'HijosIDs', items: est.map(s => ({ id: s.ID, nombre: s.Nombre, sub: s.Grado || s.Email, grado: s.Grado || '', user: s })),
                selected: [...hijos], placeholder: 'Buscar al hijo/a por nombre…', vacio: 'Primero crea las cuentas de los estudiantes.' })}
        </fieldset>
    </div>
    ${isEdit ? justificationField() : ''}`;
}

function tempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const buf = crypto.getRandomValues(new Uint32Array(12));
    return Array.from(buf, n => chars[n % chars.length]).join('');
}

async function openUserModal(u = null) {
    await openModal({
        title: u ? `Editar · ${u.Nombre}` : 'Nuevo usuario',
        body: userForm(u),
        wide: true,
        submitLabel: u ? 'Guardar cambios' : 'Crear cuenta',
        onSubmit: async (fd) => {
            const payload = {
                Nombre: fd.get('Nombre'),
                FechaNacimiento: fd.get('FechaNacimiento'),
                Grado: fd.get('Grado'),
                HijosIDs: fd.getAll('HijosIDs'),
            };
            if (u) {
                Object.assign(payload, { ID: u.ID, justificacion: fd.get('justificacion') });
            } else {
                Object.assign(payload, { Email: fd.get('Email'), Rol: fd.get('Rol'), password: fd.get('password') });
            }
            const r = await withBusy(() => api('saveUser', payload));
            if (r?.sinCambios) toast('No había cambios que guardar.');
            else if (r?.cuentaExistente) toast('Este correo ya tenía una cuenta: la persona entrará con la contraseña que ya usa.', 'info', 8000);
            else toast(u ? 'Usuario actualizado.' : 'Cuenta creada. Comparte el correo y la contraseña temporal.', 'success', 6000);
            await refresh();
        },
    });
}

async function deleteUserFlow(u) {
    const asignados = state.db.cursos.filter(c => c.TutorID === u.ID);
    const extra = u.Rol === ROLES.ESTUDIANTE
        ? '<p class="alert alert-warn">Se retirará de sus cursos y se desvinculará de sus padres. Sus notas, entregas y asistencia se conservan como historial.</p>'
        : u.Rol === ROLES.TUTOR && asignados.length
            ? `<p class="alert alert-warn">${ico('alert-triangle')}<span>Tiene cursos asignados (${esc(asignados.map(c => c.NombreCurso).join(', '))}). Reasígnalos a otro tutor antes de eliminarlo.</span></p>`
            : '';
    await openModal({
        title: `Eliminar a ${u.Nombre}`,
        body: `<p>Esta persona perderá el acceso a la plataforma.</p>${extra}${justificationField('Explica por qué se elimina esta cuenta.')}`,
        submitLabel: 'Eliminar usuario',
        danger: true,
        onSubmit: async (fd) => {
            await withBusy(() => api('deleteUser', { ID: u.ID, justificacion: fd.get('justificacion') }));
            toast('Usuario eliminado.', 'success');
            await refresh();
        },
    });
}

// ---------- 7.3 Cursos ----------

function viewCursos() {
    const admin = isAdmin();
    const cursos = cursosGestionables();
    return `
    <div class="section-title"><h2>${cursos.length} curso${cursos.length === 1 ? '' : 's'}${admin ? '' : ' asignado' + (cursos.length === 1 ? '' : 's')}</h2>
        ${admin ? '<button class="btn btn-primary" data-action="new-course">+ Nuevo curso</button>' : ''}</div>
    ${cursos.length ? `<div class="grid grid-cards">${cursos.map(c => {
        const units = Grades.units(c.CursoID);
        return `<a class="card course-card" href="#/curso/${encodeURIComponent(c.CursoID)}">
            <h3>${esc(c.NombreCurso)}</h3>
            <p>${esc(c.Descripcion || 'Sin descripción')}</p>
            ${admin ? `<p class="meta-line">${ico('presentation', 'icon-sm')}<strong>${esc(tutorDe(c))}</strong></p>` : ''}
            <div class="course-stats">
                <span>${ico('layers', 'icon-sm')} ${units.length} unidades</span>
                <span>${ico('clipboard-list', 'icon-sm')} ${(idx.itemsByCurso.get(c.CursoID) || []).length} evaluaciones</span>
                <span>${ico('graduation-cap', 'icon-sm')} ${cupoTexto(alumnosDe(c.CursoID).length)} estudiantes</span>
            </div></a>`;
    }).join('')}</div>`
    : `<section class="card">${emptyState(admin
        ? 'Crea el primer curso (Matemática, Inglés…) y asígnale un tutor.'
        : 'Aún no tienes cursos asignados. El administrador te los asignará.', 'book-open')}</section>`}`;
}

function courseForm(c = null) {
    const tutores = tutoresDisponibles();
    return `<label class="field"><span>Nombre del curso *</span><input name="NombreCurso" required maxlength="120" value="${esc(c?.NombreCurso)}" placeholder="Ej.: Matemática · 3ro Básico"></label>
        <label class="field"><span>Tutor que lo imparte *</span>
            <select name="TutorID" required>
                <option value="">— Selecciona —</option>
                ${options(tutores.map(t => [t.ID, `${t.Nombre}${t.Rol === ROLES.ADMIN ? ' (administrador)' : ''}`]), c?.TutorID)}
            </select>
            <small class="field-hint">El tutor asignado gestiona unidades, tareas, notas y asistencia de este curso. Un tutor puede tener varias clases. Cupo máximo: ${CONFIG.MAX_ALUMNOS_CURSO} estudiantes por clase. ${tutores.length <= 1 ? 'Para agregar tutores, créalos en "Usuarios" con rol Tutor.' : ''}</small></label>
        <label class="field"><span>Nota mínima para aprobar *</span><input type="number" name="NotaAprobacion" min="0" max="100" step="0.01" required value="${esc(c?.NotaAprobacion ?? 60)}">
            <small class="field-hint">Sobre 100. El docente del curso también puede ajustarla.</small></label>
        <label class="field"><span>Descripción</span><textarea name="Descripcion" maxlength="1000">${esc(c?.Descripcion)}</textarea></label>`;
}

async function openCourseModal(c = null) {
    await openModal({
        title: c ? 'Editar curso' : 'Nuevo curso',
        body: courseForm(c),
        onSubmit: async (fd) => {
            const r = await withBusy(() => api('saveCourse', {
                CursoID: c?.CursoID, NombreCurso: fd.get('NombreCurso'), Descripcion: fd.get('Descripcion'),
                TutorID: fd.get('TutorID'), NotaAprobacion: fd.get('NotaAprobacion'),
            }));
            toast(c ? 'Curso actualizado.' : 'Curso creado.', 'success');
            await refresh();
            if (!c && r?.CursoID) go('curso', r.CursoID);
        },
    });
}

function viewCursoDetalle(cursoId) {
    const c = idx.cursos.get(cursoId);
    if (!c) return `<section class="card">${emptyState('El curso no existe.', 'search', '<a class="btn btn-ghost" href="#/cursos">Volver a cursos</a>')}</section>`;
    const tabs = [['evaluaciones', 'Evaluaciones'], ['material', 'Material de apoyo'], ['resultados', 'Resultados'], ['unidades', 'Unidades y ponderación'], ['pensum', 'Pensum'], ['estudiantes', 'Estudiantes']];
    const tab = state.cursoTab;
    const m = canManage(c.CursoID);
    const body = { evaluaciones: cursoEvaluaciones, material: cursoMaterial, resultados: cursoResultados, unidades: cursoUnidades, pensum: cursoPensum, estudiantes: cursoEstudiantes }[tab](c, m);
    return `
    <div class="row-between">
        <div><a class="btn btn-link" href="#/cursos">${ico('arrow-left')} Cursos</a>
            <div class="row"><span class="muted meta-line">${ico('presentation', 'icon-sm')}${esc(tutorDe(c))}</span>${c.Descripcion ? `<span class="muted">· ${esc(c.Descripcion)}</span>` : ''}
                <span class="badge badge-brand">Aprueba con ${fmtNota(aprobDe(c.CursoID))}</span>
                ${m ? `<button class="btn btn-link" data-action="nota-aprobacion" data-curso="${esc(c.CursoID)}">Cambiar</button>` : ''}</div></div>
        <div class="row">
            ${m ? `<button class="btn btn-ghost btn-sm" data-action="open-gradebook" data-curso="${esc(c.CursoID)}">${ico('clipboard-check')} Calificar</button>` : ''}
            ${isAdmin() ? `<button class="btn btn-ghost btn-sm" data-action="edit-course" data-id="${esc(c.CursoID)}">${ico('pencil')} Editar / reasignar</button>
            <button class="btn btn-ghost btn-sm" data-action="delete-course" data-id="${esc(c.CursoID)}">${ico('trash')} Eliminar</button>` : ''}
        </div>
    </div>
    ${m ? '' : `<p class="alert alert-info">${ico('eye')}<span>Curso de otro tutor: solo lectura.</span></p>`}
    <div class="tabs" role="tablist">${tabs.map(([v, l]) =>
        `<button class="tab" role="tab" aria-selected="${tab === v}" data-action="curso-tab" data-tab="${v}">${l}</button>`).join('')}</div>
    ${body}`;
}

function cursoResultados(c) {
    const alumnos = alumnosDe(c.CursoID);
    if (!alumnos.length) return `<section class="card">${emptyState('No hay estudiantes inscritos en este curso.', 'graduation-cap')}</section>`;
    const aprob = aprobDe(c.CursoID);
    const filas = alumnos.map(a => ({ a, final: Grades.forStudent(a.ID, c.CursoID).final }))
        .sort((x, y) => (y.final ?? -1) - (x.final ?? -1));
    const cuenta = (e) => filas.filter(f => estadoFinal(f.final, c) === e).length;
    return `<div class="grid grid-kpi">
        ${kpi('Aprobados', cuenta('aprobado'), `Nota mínima ${fmtNota(aprob)}`, 'circle-check')}
        ${kpi('Reprobados', cuenta('reprobado'), '', 'alert-triangle')}
        ${kpi('Sin notas', cuenta('sin-notas'), '', 'clipboard-list')}
        ${kpi('Promedio del curso', fmtNota(mean(filas.map(f => f.final))), '', 'award')}
    </div>
    <section class="card"><div class="card-head"><h2>Resultados por estudiante</h2><small class="muted">Notas con penalizaciones por entrega tarde aplicadas</small></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Estudiante</th><th class="center">Nota final</th><th class="center">Estado</th><th></th></tr></thead>
        <tbody>${filas.map(f => `<tr><td>${person(f.a, f.a.Grado)}</td>
            <td class="center"><span class="grade-pill ${gradeClass(f.final, aprob)}">${fmtNota(f.final)}</span></td>
            <td class="center">${estadoBadge(f.final, c)}</td>
            <td class="actions"><a class="btn btn-ghost btn-sm" href="#/estudiante/${encodeURIComponent(f.a.ID)}">Ver perfil</a></td></tr>`).join('')}</tbody></table></div>
    </section>`;
}

function cursoUnidades(c, m) {
    const defined = [...(idx.unidadesByCurso.get(c.CursoID) || [])].sort((a, b) => +a.Unidad - +b.Unidad);
    const units = Grades.units(c.CursoID);
    const sum = defined.reduce((s, u) => s + (toNum(u.Ponderacion) ?? 0), 0);
    const sinDefinir = units.filter(u => !u.definida);
    return `<section class="card">
        <div class="card-head"><div class="row"><h2>Unidades</h2>${defined.length ? sumBadge(sum, 'Total') : ''}</div>
            ${m ? `<button class="btn btn-primary btn-sm" data-action="new-unit" data-curso="${esc(c.CursoID)}">+ Unidad</button>` : ''}</div>
        ${sinDefinir.length ? `<div class="card-body"><p class="alert alert-info">${ico('info')}<span>${defined.length ? 'Hay evaluaciones en unidades sin ponderación configurada (cuentan como 0%): ' + sinDefinir.map(u => 'U' + u.numero).join(', ') : 'Sin unidades configuradas: todas las unidades pesan lo mismo en el promedio final.'}</span></p></div>` : ''}
        ${defined.length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>#</th><th>Nombre</th><th>Periodo</th><th class="num">Ponderación</th><th class="num">Evaluaciones</th><th>Suma de evaluaciones</th><th></th></tr></thead>
            <tbody>${defined.map(u => {
                const its = (idx.itemsByCurso.get(c.CursoID) || []).filter(i => +i.Unidad === +u.Unidad);
                const s = its.reduce((a, i) => a + (toNum(i.Ponderacion) ?? 0), 0);
                return `<tr><td><strong>U${esc(u.Unidad)}</strong></td><td>${esc(u.NombreUnidad)}</td>
                    <td><small>${u.FechaInicio || u.FechaFin ? `${u.FechaInicio ? fmtDate(u.FechaInicio) : '…'} – ${u.FechaFin ? fmtDate(u.FechaFin) : '…'}` : '<span class="muted">Sin fechas</span>'}</small></td>
                    <td class="num">${fmtPeso(u.Ponderacion)}</td><td class="num">${its.length}</td>
                    <td>${its.length ? sumBadge(s) : '<span class="muted">—</span>'}</td>
                    <td class="actions">${m ? `<button class="icon-btn" data-action="edit-unit" data-id="${esc(u.UnidadID)}" aria-label="Editar unidad" title="Editar">${ico('pencil')}</button>
                    <button class="icon-btn danger" data-action="delete-unit" data-id="${esc(u.UnidadID)}" aria-label="Eliminar unidad" title="Eliminar">${ico('trash')}</button>` : ''}</td></tr>`;
            }).join('')}</tbody></table></div>`
        : emptyState('Define las unidades del curso y su peso (%) en la nota final.', 'layers')}
    </section>`;
}

function nextUnitNumber(cursoId) {
    const nums = Grades.units(cursoId).map(u => u.numero);
    return nums.length ? Math.max(...nums) + 1 : 1;
}

async function openUnitModal(cursoId, u = null) {
    await openModal({
        title: u ? 'Editar unidad' : 'Nueva unidad',
        body: `<div class="form-grid">
            <label class="field"><span>Número *</span><input type="number" name="Unidad" min="1" max="50" step="1" required value="${esc(u?.Unidad ?? nextUnitNumber(cursoId))}"></label>
            <label class="field"><span>Ponderación (%) *</span><input type="number" name="Ponderacion" min="0" max="100" step="0.01" required value="${esc(u?.Ponderacion ?? '')}"></label>
            <label class="field span-all"><span>Nombre *</span><input name="NombreUnidad" required maxlength="120" value="${esc(u?.NombreUnidad)}" placeholder="Ej.: Álgebra básica"></label>
            <label class="field"><span>Inicio (opcional)</span><input type="date" name="FechaInicio" value="${esc(u?.FechaInicio)}"></label>
            <label class="field"><span>Fin (opcional)</span><input type="date" name="FechaFin" value="${esc(u?.FechaFin)}"></label>
        </div>`,
        onSubmit: async (fd) => {
            await withBusy(() => api('saveUnit', {
                UnidadID: u?.UnidadID, CursoID: cursoId,
                Unidad: fd.get('Unidad'), NombreUnidad: fd.get('NombreUnidad'), Ponderacion: fd.get('Ponderacion'),
                FechaInicio: fd.get('FechaInicio'), FechaFin: fd.get('FechaFin'),
            }));
            toast('Unidad guardada.', 'success');
            await refresh();
        },
    });
}

function unitSelect(cursoId, selected) {
    const units = Grades.units(cursoId);
    const list = units.map(u => [u.numero, `U${u.numero} · ${u.nombre}`]);
    if (!list.length) list.push([1, 'U1']);
    return `<select name="Unidad" required>${options(list, selected ?? list[0][0])}</select>`;
}

function cursoPensum(c, m) {
    const pensum = idx.pensumByCurso.get(c.CursoID) || [];
    const units = Grades.units(c.CursoID);
    const nums = [...new Set([...units.map(u => u.numero), ...pensum.map(p => +p.Unidad)])].sort((a, b) => a - b);
    return `<section class="card">
        <div class="card-head"><h2>Pensum por unidad</h2>
            ${m ? `<button class="btn btn-primary btn-sm" data-action="new-pensum" data-curso="${esc(c.CursoID)}">+ Tema</button>` : ''}</div>
        ${pensum.length ? nums.map(n => {
            const temas = pensum.filter(p => +p.Unidad === n);
            if (!temas.length) return '';
            const u = units.find(x => x.numero === n);
            return `<div class="unit-block"><div class="unit-head"><h3>U${n} · ${esc(u?.nombre || `Unidad ${n}`)}</h3></div>
                <ul class="item-list">${temas.map(t => `<li class="item-row">
                    <span class="badge">Tema</span>
                    <div class="item-main"><strong>${esc(t.Tema)}</strong>${t.Detalle ? `<span class="muted">${esc(t.Detalle)}</span>` : ''}</div>
                    <div class="item-side">${m ? `<button class="icon-btn" data-action="edit-pensum" data-id="${esc(t.PensumID)}" aria-label="Editar tema" title="Editar">${ico('pencil')}</button>
                    <button class="icon-btn danger" data-action="delete-pensum" data-id="${esc(t.PensumID)}" aria-label="Eliminar tema" title="Eliminar">${ico('trash')}</button>` : ''}</div>
                </li>`).join('')}</ul></div>`;
        }).join('') : emptyState('Agrega los temas que se cubrirán en cada unidad.', 'folder-open')}
    </section>`;
}

async function openPensumModal(cursoId, t = null) {
    await openModal({
        title: t ? 'Editar tema' : 'Nuevo tema del pensum',
        body: `<div class="form-grid">
            <label class="field"><span>Unidad *</span>${unitSelect(cursoId, t?.Unidad)}</label>
            <label class="field"><span>Tema *</span><input name="Tema" required maxlength="200" value="${esc(t?.Tema)}"></label>
            <label class="field span-all"><span>Detalle</span><textarea name="Detalle" maxlength="2000">${esc(t?.Detalle)}</textarea></label>
        </div>`,
        onSubmit: async (fd) => {
            await withBusy(() => api('savePensum', {
                PensumID: t?.PensumID, CursoID: cursoId, Unidad: fd.get('Unidad'), Tema: fd.get('Tema'), Detalle: fd.get('Detalle'),
            }));
            toast('Tema guardado.', 'success');
            await refresh();
        },
    });
}

function cursoEvaluaciones(c, m) {
    const units = Grades.units(c.CursoID);
    const alumnos = alumnosDe(c.CursoID).length;
    return `<section class="card">
        <div class="card-head"><h2>Tareas, pruebas y exámenes</h2>
            ${m ? `<button class="btn btn-primary btn-sm" data-action="new-item" data-curso="${esc(c.CursoID)}">+ Evaluación</button>` : ''}</div>
        ${units.some(u => u.items.length) ? units.map(u => {
            if (!u.items.length) return '';
            const s = u.items.reduce((a, i) => a + (toNum(i.Ponderacion) ?? 0), 0);
            return `<div class="unit-block">
                <div class="unit-head"><h3>U${u.numero} · ${esc(u.nombre)} <small class="muted">(${fmtPeso(u.peso)} del curso)</small></h3>${sumBadge(s)}</div>
                <ul class="item-list">${u.items.map(i => {
                    const t = tasaEntrega(i);
                    return `<li class="item-row">
                        ${tipoBadge(i.Tipo)}
                        <div class="item-main">${itemLink(i)}
                            <div class="item-meta"><span>Ponderación ${fmtPeso(i.Ponderacion)}</span>${i.FechaEntrega ? `<span>Entrega ${fmtDate(i.FechaEntrega)}</span>` : ''}${i.PenalizacionTipo && i.PenalizacionTipo !== 'NINGUNA' ? `<span>${esc(reglaTexto(i))}</span>` : ''}<span class="${t.pct === 100 ? 'grade good' : ''}">Entregas ${t.n}/${t.total}${t.pct != null ? ` (${fmtNota(t.pct)}%)` : ''}</span></div>
                            ${adjuntosHtml(i, m)}</div>
                        <div class="item-side">${m ? `
                            <button class="btn btn-ghost btn-sm" data-action="new-material" data-curso="${esc(i.CursoID)}" data-item="${esc(i.ItemID)}" title="Adjuntar hoja de trabajo, enunciado o enlace">${ico('paperclip')} Adjuntar</button>` : ''}
                            <button class="btn btn-ghost btn-sm" data-action="ver-entregas" data-id="${esc(i.ItemID)}">${ico('check-check')} Entregas</button>${m ? `
                            <button class="icon-btn" data-action="edit-item" data-id="${esc(i.ItemID)}" aria-label="Editar evaluación" title="Editar">${ico('pencil')}</button>
                            <button class="icon-btn danger" data-action="delete-item" data-id="${esc(i.ItemID)}" aria-label="Eliminar evaluación" title="Eliminar">${ico('trash')}</button>` : ''}
                        </div></li>`;
                }).join('')}</ul></div>`;
        }).join('') : emptyState('Crea tareas, pruebas o exámenes con su enlace y ponderación.', 'clipboard-list')}
    </section>`;
}

async function openItemModal(cursoId, it = null) {
    await openModal({
        title: it ? 'Editar evaluación' : 'Nueva evaluación',
        wide: true,
        body: `<div class="form-grid">
            <label class="field"><span>Tipo *</span><select name="Tipo" required>${options(TIPOS_ITEM.map(t => [t, t]), it?.Tipo || 'Tarea')}</select></label>
            <label class="field"><span>Unidad *</span>${unitSelect(cursoId, it?.Unidad)}</label>
            <label class="field span-all"><span>Título / número oficial *</span><input name="Titulo" required maxlength="160" value="${esc(it?.Titulo)}" placeholder="Ej.: Examen parcial 1 — Fracciones"></label>
            <label class="field span-all"><span>Enlace (URL)</span><input type="url" name="EnlaceURL" maxlength="2000" value="${esc(it?.EnlaceURL)}" placeholder="https://… (formulario, HTML del examen, documento)">
                <small class="field-hint">El estudiante lo verá como hipervínculo directo con el título.</small></label>
            <label class="field"><span>Ponderación dentro de la unidad (%) *</span><input type="number" name="Ponderacion" min="0" max="100" step="0.01" required value="${esc(it?.Ponderacion ?? '')}"></label>
            <label class="field"><span>Fecha de entrega</span><input type="date" name="FechaEntrega" value="${esc(it?.FechaEntrega)}"></label>
            <fieldset class="field span-all" style="border:0;padding:0;margin:0"><span>Si se entrega tarde…</span>
                <div class="segmented" role="radiogroup" aria-label="Penalización por entrega tarde">
                    ${[['NINGUNA', 'Sin descuento'], ['PORCENTAJE', 'Descontar %'], ['TOTAL', 'Pierde la nota']].map(([v, l]) =>
                        `<label><input type="radio" name="PenalizacionTipo" value="${v}" data-change="penalizacion" ${(it?.PenalizacionTipo || 'NINGUNA') === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}
                </div>
                <label class="field" data-pct style="margin-top:10px;max-width:220px" ${it?.PenalizacionTipo === 'PORCENTAJE' ? '' : 'hidden'}>
                    <span>Porcentaje a descontar</span><input type="number" name="PenalizacionPct" min="1" max="100" step="1" value="${esc(it?.PenalizacionPct || 10)}"></label>
                <small class="field-hint">Es tarde si se entrega después de la fecha de entrega. Puedes hacer excepciones por alumno, con comentario, desde "Entregas".</small>
            </fieldset>
        </div>`,
        onSubmit: async (fd) => {
            await withBusy(() => api('saveItem', {
                ItemID: it?.ItemID, CursoID: cursoId, Tipo: fd.get('Tipo'), Unidad: fd.get('Unidad'),
                Titulo: fd.get('Titulo'), EnlaceURL: fd.get('EnlaceURL'), Ponderacion: fd.get('Ponderacion'),
                FechaEntrega: fd.get('FechaEntrega'),
                PenalizacionTipo: fd.get('PenalizacionTipo') || 'NINGUNA', PenalizacionPct: fd.get('PenalizacionPct'),
            }));
            toast('Evaluación guardada.', 'success');
            await refresh();
        },
    });
}

async function deleteItemFlow(it) {
    const conDatos = state.db.entregas.filter(e => e.ItemID === it.ItemID).length;
    await openModal({
        title: `Eliminar "${it.Titulo}"`,
        danger: true,
        submitLabel: 'Eliminar evaluación',
        body: conDatos
            ? `<p class="alert alert-warn">${ico('alert-triangle')}<span>Esta evaluación tiene ${conDatos} entrega(s)/nota(s). Se eliminarán y el cambio quedará auditado.</span></p>${justificationField()}`
            : '<p>La evaluación no tiene notas registradas. ¿Eliminarla?</p>',
        onSubmit: async (fd) => {
            await withBusy(() => api('deleteItem', { ItemID: it.ItemID, justificacion: fd.get('justificacion') || '' }));
            toast('Evaluación eliminada.', 'success');
            await refresh();
        },
    });
}

function cursoEstudiantes(c) {
    const inscritos = idx.alumnosByCurso.get(c.CursoID) || new Set();
    // Solo el administrador inscribe o retira alumnos; el tutor ve la lista.
    if (!isAdmin()) {
        const lista = alumnosDe(c.CursoID);
        return `<section class="card">
            <div class="card-head"><h2>Estudiantes inscritos (${cupoTexto(lista.length)})</h2><small class="muted">Las inscripciones las gestiona el administrador.</small></div>
            ${lista.length ? `<ul class="item-list">${lista.map(s => `<li class="item-row">${avatar(s, 'sm')}
                <div class="item-main"><strong>${esc(s.Nombre)}</strong><span class="muted">${esc(s.Grado || '')}</span></div>
                <div class="item-side"><a class="btn btn-ghost btn-sm" href="#/estudiante/${encodeURIComponent(s.ID)}">Ver progreso</a></div></li>`).join('')}</ul>`
            : emptyState('Aún no hay estudiantes inscritos en este curso.', 'graduation-cap')}
        </section>`;
    }
    const est = students();
    return `<form class="card" data-submit="enrollment" data-curso="${esc(c.CursoID)}">
        <div class="card-head"><h2>Estudiantes inscritos</h2>
            <div class="row"><span class="badge badge-brand" data-cupo>${cupoTexto(inscritos.size)} cupos usados</span>
            <button type="submit" class="btn btn-primary btn-sm" ${est.length ? '' : 'disabled'}>Guardar inscripciones</button></div></div>
        <div class="card-body">${est.length ? `<p class="muted" style="font-size:13px;margin-top:0">Los inscritos aparecen primero. Filtra por grado o escribe un nombre para encontrar a otros alumnos.</p>
            ${picker({ name: 'est', items: est.map(s => ({ id: s.ID, nombre: s.Nombre, sub: s.Grado || s.Email, grado: s.Grado || '', user: s })),
                selected: [...inscritos], placeholder: 'Buscar alumno por nombre…',
                inputAttrs: (it) => `data-change="enroll-check" ${!inscritos.has(it.id) && inscritos.size >= CONFIG.MAX_ALUMNOS_CURSO ? 'disabled' : ''}` })}`
            : emptyState('Crea cuentas de estudiantes en "Usuarios" para inscribirlos.', 'graduation-cap', '<a class="btn btn-ghost" href="#/usuarios">Ir a usuarios</a>')}
        </div></form>`;
}

async function saveEnrollment(form) {
    const cursoId = form.dataset.curso;
    const ids = $$('input[name="est"]:checked', form).map(i => i.value);
    if (ids.length > CONFIG.MAX_ALUMNOS_CURSO) {
        return toast(`Cada clase admite como máximo ${CONFIG.MAX_ALUMNOS_CURSO} estudiantes.`, 'error');
    }
    const actuales = idx.alumnosByCurso.get(cursoId) || new Set();
    const quitados = [...actuales].filter(id => !ids.includes(id));
    const agregados = ids.filter(id => !actuales.has(id));
    if (!quitados.length && !agregados.length) return toast('No hay cambios en las inscripciones.');

    if (quitados.length) {
        await openModal({
            title: 'Retirar estudiantes del curso',
            body: `<p>Se retirará a: <strong>${quitados.map(id => esc(idx.users.get(id)?.Nombre || id)).join(', ')}</strong>.</p>${justificationField()}`,
            submitLabel: 'Confirmar',
            onSubmit: async (fd) => {
                await withBusy(() => api('setEnrollment', { CursoID: cursoId, EstudianteIDs: ids, justificacion: fd.get('justificacion') }));
                toast('Inscripciones actualizadas.', 'success');
                await refresh();
            },
        });
    } else {
        await mutate('setEnrollment', { CursoID: cursoId, EstudianteIDs: ids }, `${agregados.length} estudiante(s) inscrito(s).`);
    }
}

// ---------- 7.4 Libro de calificaciones (cálculo en tiempo real) ----------

function gbValue(estId, itemId) {
    const key = `${estId}|${itemId}`;
    if (!state.gb.draft.has(key)) return notaGuardada(estId, itemId);
    const raw = state.gb.draft.get(key);
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function viewCalificaciones() {
    const cursos = cursosGestionables();   // tutor: solo sus cursos asignados
    if (!cursos.length) return `<section class="card">${emptyState(isAdmin() ? 'Primero crea un curso.' : 'Aún no tienes cursos asignados.', 'book-open')}</section>`;
    if (!cursos.some(c => c.CursoID === state.gb.cursoId)) state.gb.cursoId = cursos[0].CursoID;
    const cursoId = state.gb.cursoId;
    const units = Grades.units(cursoId);
    if (state.gb.unidad !== 'all' && !units.some(u => String(u.numero) === String(state.gb.unidad))) state.gb.unidad = 'all';

    return `
    <div class="gb-toolbar">
        <label class="field"><span>Curso</span>
            <select class="inline-select" data-change="gb-curso">${options(cursos.map(cursoOpcion), cursoId)}</select></label>
        <label class="field"><span>Unidad</span>
            <select class="inline-select" data-change="gb-unidad">${options([['all', 'Todas las unidades'], ...units.map(u => [u.numero, `U${u.numero} · ${u.nombre}`])], state.gb.unidad)}</select></label>
        <div class="spacer"></div>
        <span class="gb-status" id="gb-status"></span>
        <button class="btn btn-ghost" data-action="gb-discard" id="gb-discard">Descartar</button>
        <button class="btn btn-primary" data-action="gb-save" id="gb-save">Guardar cambios</button>
    </div>
    <p class="muted" style="font-size:13px">Escala 0–100 · Aprueba con ${fmtNota(aprobDe(cursoId))} o más. Escribe la nota del trabajo; si se entregó tarde, los promedios ya aplican la penalización de esa evaluación (la celda se marca en ámbar). <kbd>Enter</kbd> baja a la siguiente fila. Deja la celda vacía para quitar una nota.</p>
    <section class="card"><div class="table-wrap" style="max-height:70vh">${gradebookTable(cursoId)}</div></section>`;
}

function gradebookTable(cursoId) {
    const alumnos = alumnosDe(cursoId);
    const allUnits = Grades.units(cursoId);
    const units = allUnits.filter(u => state.gb.unidad === 'all' || String(u.numero) === String(state.gb.unidad));
    if (!alumnos.length) return emptyState('No hay estudiantes inscritos en este curso.', 'graduation-cap', `<a class="btn btn-ghost" href="#/curso/${encodeURIComponent(cursoId)}">Inscribir estudiantes</a>`);
    if (!allUnits.some(u => u.items.length)) return emptyState('Este curso aún no tiene evaluaciones.', 'clipboard-list', `<a class="btn btn-ghost" href="#/curso/${encodeURIComponent(cursoId)}">Crear evaluaciones</a>`);

    const head1 = units.map(u => `<th class="unit-th" colspan="${u.items.length + 1}">U${u.numero} · ${esc(u.nombre)} <small>(${fmtPeso(u.peso)})</small></th>`).join('');
    const head2 = units.map(u => u.items.map(i =>
        `<th class="item-th" title="${esc(`${i.Tipo}: ${i.Titulo}`)}">${esc(i.Titulo.length > 16 ? i.Titulo.slice(0, 15) + '…' : i.Titulo)}<small>${esc(i.Tipo)} · ${fmtPeso(i.Ponderacion)}</small></th>`).join('') +
        `<th class="avg-col">Prom.</th>`).join('');

    const body = alumnos.map(a => `<tr data-est="${esc(a.ID)}">
        <th class="sticky-col" scope="row">${person(a, a.Grado)}</th>
        ${units.map(u => u.items.map(i => {
            const key = `${a.ID}|${i.ItemID}`;
            const draft = state.gb.draft.has(key);
            const val = draft ? state.gb.draft.get(key) : (notaGuardada(a.ID, i.ItemID) ?? '');
            const ent = idx.entregas.get(key);
            const pu = puntualidad(i, ent);
            const marca = pu.tarde ? `<span class="late-dot${pu.excepcion ? ' is-exc' : ''}" title="${esc(pu.excepcion ? 'Entregada tarde · con excepción: ' + ent.Excepcion.Comentario : 'Entregada tarde · ' + reglaTexto(i))}">T</span>` : '';
            return `<td class="cell${pu.tarde && !pu.excepcion ? ' is-late' : ''}">${entregaBtn(ent, ico('paperclip'), 'file-dot')}${marca}
                <input class="grade-input${draft ? ' is-dirty' : ''}" type="number" inputmode="decimal" min="0" max="100" step="0.01"
                    value="${esc(val)}" data-input="gb-cell" data-est="${esc(a.ID)}" data-item="${esc(i.ItemID)}"
                    aria-label="${esc(`${a.Nombre} · ${i.Titulo}`)}"></td>`;
        }).join('') + `<td class="avg-col" data-u="${esc(a.ID)}|${u.numero}"></td>`).join('')}
        <td class="final-col" data-f="${esc(a.ID)}"></td><td class="center" data-e="${esc(a.ID)}"></td></tr>`).join('');

    const foot = `<tr><th class="sticky-col" scope="row">Promedio del grupo</th>
        ${units.map(u => u.items.map(i => `<td data-ci="${esc(i.ItemID)}"></td>`).join('') + `<td class="avg-col" data-cu="${u.numero}"></td>`).join('')}
        <td class="final-col" data-cf></td><td></td></tr>`;

    return `<table class="gradebook" id="gradebook">
        <thead><tr><th class="sticky-col" rowspan="2">Estudiante</th>${head1}<th class="final-col" rowspan="2">Final</th><th rowspan="2">Estado</th></tr><tr>${head2}</tr></thead>
        <tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

function setGradeCell(el, v) {
    if (!el) return;
    el.innerHTML = `<span class="grade ${gradeClass(v, aprobDe(state.gb.cursoId))}">${fmtNota(v)}</span>`;
}

/** Nota efectiva de la celda (borrador o guardada) con la penalización de la evaluación. */
function gbEfectiva(estId, itemId) {
    return notaEfectiva(idx.items.get(itemId), idx.entregas.get(`${estId}|${itemId}`), gbValue(estId, itemId));
}

function gbRecalcRow(estId) {
    const table = $('#gradebook');
    if (!table) return;
    const res = Grades.course(state.gb.cursoId, itemId => gbEfectiva(estId, itemId));
    res.units.forEach(u => setGradeCell(table.querySelector(`[data-u="${CSS.escape(`${estId}|${u.numero}`)}"]`), u.promedio));
    setGradeCell(table.querySelector(`[data-f="${CSS.escape(estId)}"]`), res.final);
    const estado = table.querySelector(`[data-e="${CSS.escape(estId)}"]`);
    if (estado) estado.innerHTML = estadoBadge(res.final, idx.cursos.get(state.gb.cursoId));
    return res;
}

function gbRecalcFooter() {
    const table = $('#gradebook');
    if (!table) return;
    const cursoId = state.gb.cursoId;
    const alumnos = alumnosDe(cursoId);
    const results = alumnos.map(a => Grades.course(cursoId, itemId => gbEfectiva(a.ID, itemId)));
    Grades.units(cursoId).forEach((u, k) => {
        u.items.forEach(i => setGradeCell(table.querySelector(`[data-ci="${CSS.escape(i.ItemID)}"]`), mean(alumnos.map(a => gbEfectiva(a.ID, i.ItemID)))));
        setGradeCell(table.querySelector(`[data-cu="${u.numero}"]`), mean(results.map(r => r.units[k]?.promedio)));
    });
    setGradeCell(table.querySelector('[data-cf]'), mean(results.map(r => r.final)));
}

function gbUpdateToolbar() {
    const n = state.gb.draft.size;
    const invalid = $$('#gradebook .grade-input.is-invalid').length;
    const status = $('#gb-status');
    if (!status) return;
    status.innerHTML = invalid ? `<strong style="color:var(--risk)">${invalid} valor(es) inválido(s)</strong>`
        : n ? `<strong>${n} cambio(s) sin guardar</strong>` : 'Sin cambios pendientes';
    $('#gb-save').disabled = !n || !!invalid;
    $('#gb-discard').disabled = !n;
    $('#gb-save').textContent = n ? `Guardar ${n} cambio(s)` : 'Guardar cambios';
}

function gbAfterRender() {
    if (!$('#gradebook')) { gbUpdateToolbar(); return; }
    alumnosDe(state.gb.cursoId).forEach(a => gbRecalcRow(a.ID));
    gbRecalcFooter();
    gbUpdateToolbar();
}

function gbOnInput(el) {
    const { est, item } = el.dataset;
    const key = `${est}|${item}`;
    const raw = el.value.trim();
    const n = raw === '' ? null : Number(raw);
    const invalid = raw !== '' && (!Number.isFinite(n) || n < 0 || n > 100) || (el.validity && el.validity.badInput);
    const saved = notaGuardada(est, item);

    if (!invalid && n === saved) state.gb.draft.delete(key);
    else state.gb.draft.set(key, el.validity?.badInput ? 'NaN' : raw);

    el.classList.toggle('is-invalid', !!invalid);
    el.classList.toggle('is-dirty', state.gb.draft.has(key) && !invalid);
    gbRecalcRow(est);
    gbRecalcFooter();
    gbUpdateToolbar();
}

async function gbSave() {
    const cambios = [];
    for (const [key, raw] of state.gb.draft) {
        const [est, item] = key.split('|');
        const nota = raw === '' ? null : Number(raw);
        if (nota !== null && (!Number.isFinite(nota) || nota < 0 || nota > 100)) return toast('Corrige las notas inválidas antes de guardar.', 'error');
        cambios.push({ EstudianteID: est, ItemID: item, Nota: nota, anterior: notaGuardada(est, item) });
    }
    if (!cambios.length) return;

    const resumen = cambios.slice(0, 40).map(c => `<tr>
        <td>${esc(idx.users.get(c.EstudianteID)?.Nombre)}</td><td>${esc(idx.items.get(c.ItemID)?.Titulo)}</td>
        <td class="num">${fmtNota(c.anterior)}</td><td class="num"><strong>${fmtNota(c.Nota)}</strong></td></tr>`).join('');

    await openModal({
        title: 'Justificar cambios de notas',
        wide: true,
        submitLabel: `Guardar ${cambios.length} cambio(s)`,
        body: `<div class="table-wrap" style="max-height:260px"><table class="table">
            <thead><tr><th>Estudiante</th><th>Evaluación</th><th class="num">Antes</th><th class="num">Ahora</th></tr></thead>
            <tbody>${resumen}</tbody></table></div>
            ${cambios.length > 40 ? `<p class="muted">… y ${cambios.length - 40} cambio(s) más.</p>` : ''}
            ${justificationField('Toda creación o corrección de nota requiere justificación. Queda en la auditoría y es visible para los padres.')}`,
        onSubmit: async (fd) => {
            await withBusy(() => api('saveGrades', {
                CursoID: state.gb.cursoId,
                justificacion: fd.get('justificacion'),
                cambios: cambios.map(({ EstudianteID, ItemID, Nota }) => ({ EstudianteID, ItemID, Nota })),
            }));
            state.gb.draft.clear();
            toast(`${cambios.length} nota(s) guardada(s) y auditada(s).`, 'success');
            await refresh();
        },
    });
}

// ---------- 7.5 Asistencia ----------

function viewAsistencia() {
    const cursos = cursosGestionables();   // tutor: solo sus cursos asignados
    if (!cursos.length) return `<section class="card">${emptyState(isAdmin() ? 'Primero crea un curso.' : 'Aún no tienes cursos asignados.', 'book-open')}</section>`;
    if (!cursos.some(c => c.CursoID === state.att.cursoId)) state.att.cursoId = cursos[0].CursoID;
    const { cursoId, fecha } = state.att;
    const alumnos = alumnosDe(cursoId);
    const existentes = new Map(state.db.asistencia
        .filter(a => a.CursoID === cursoId && a.Fecha === fecha).map(a => [a.EstudianteID, a]));
    const fechas = [...new Set(state.db.asistencia.filter(a => a.CursoID === cursoId).map(a => a.Fecha))].sort().reverse();

    const lista = alumnos.map(a => {
        const prev = existentes.get(a.ID)?.Estado || '';
        const actual = state.att.draft.get(a.ID) ?? prev;
        const dirty = state.att.draft.has(a.ID);
        return `<li class="att-row${dirty ? ' is-dirty' : ''}">
            ${person(a, prev ? `Registrado: ${prev}` : 'Sin registro')}
            <div class="segmented" role="radiogroup" aria-label="Asistencia de ${esc(a.Nombre)}">
                ${ESTADOS_ASISTENCIA.map(s => `<label><input type="radio" name="att-${esc(a.ID)}" value="${s}" ${actual === s ? 'checked' : ''} data-change="att-mark" data-est="${esc(a.ID)}"><span>${s}</span></label>`).join('')}
            </div></li>`;
    }).join('');

    const resumen = alumnos.map(a => {
        const s = attendanceStats(a.ID, cursoId);
        return `<tr><td>${person(a)}</td><td class="num">${s.Presente}</td><td class="num">${s.Tarde}</td><td class="num">${s.Ausente}</td><td class="num">${s.Justificado}</td>
            <td class="center">${s.pct == null ? '—' : `<span class="grade-pill ${gradeClass(s.pct)}">${fmtNota(s.pct)}%</span>`}</td></tr>`;
    }).join('');

    return `
    <div class="gb-toolbar">
        <label class="field"><span>Curso</span><select class="inline-select" data-change="att-curso">${options(cursos.map(cursoOpcion), cursoId)}</select></label>
        <label class="field"><span>Fecha</span><input type="date" value="${esc(fecha)}" data-change="att-fecha" max="${today()}"></label>
        <div class="spacer"></div>
        <button class="btn btn-ghost" data-action="att-all-present" ${alumnos.length ? '' : 'disabled'}>Todos presentes</button>
        <button class="btn btn-primary" data-action="att-save" ${state.att.draft.size ? '' : 'disabled'}>Guardar asistencia${state.att.draft.size ? ` (${state.att.draft.size})` : ''}</button>
    </div>
    ${existentes.size ? `<p class="alert alert-info">${ico('info')}<span>Esta fecha ya tiene asistencia registrada. Modificarla requiere justificación.</span></p>` : ''}
    <section class="card">
        <div class="card-head"><h2>${fmtDate(fecha)}</h2><span class="badge">${alumnos.length} estudiantes</span></div>
        ${alumnos.length ? `<ul class="att-list">${lista}</ul>` : emptyState('No hay estudiantes inscritos en este curso.', 'graduation-cap')}
    </section>
    ${alumnos.length ? `<section class="card">
        <div class="card-head"><h2>Resumen del curso</h2><span class="muted" style="font-size:13px">${fechas.length} sesión(es) registradas</span></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Estudiante</th><th class="num">Presente</th><th class="num">Tarde</th><th class="num">Ausente</th><th class="num">Justificado</th><th class="center">% Asistencia</th></tr></thead>
        <tbody>${resumen}</tbody></table></div></section>` : ''}`;
}

async function attSave() {
    const { cursoId, fecha } = state.att;
    const existentes = new Map(state.db.asistencia.filter(a => a.CursoID === cursoId && a.Fecha === fecha).map(a => [a.EstudianteID, a.Estado]));
    const registros = [...state.att.draft].map(([EstudianteID, Estado]) => ({ EstudianteID, Estado }))
        .filter(r => existentes.get(r.EstudianteID) !== r.Estado);
    if (!registros.length) { state.att.draft.clear(); render(); return toast('No hay cambios.'); }
    const modificados = registros.filter(r => existentes.has(r.EstudianteID));

    const send = async (justificacion = '') => {
        await withBusy(() => api('saveAttendance', { CursoID: cursoId, Fecha: fecha, registros, justificacion }));
        state.att.draft.clear();
        toast('Asistencia guardada.', 'success');
        await refresh();
    };

    if (!modificados.length) {
        try { await send(); } catch (e) { toast(e.message, 'error'); }
        return;
    }
    await openModal({
        title: 'Corregir asistencia registrada',
        body: `<ul>${modificados.map(r => `<li>${esc(idx.users.get(r.EstudianteID)?.Nombre)}: ${esc(existentes.get(r.EstudianteID))} → <strong>${esc(r.Estado)}</strong></li>`).join('')}</ul>${justificationField()}`,
        submitLabel: 'Guardar corrección',
        onSubmit: (fd) => send(fd.get('justificacion')),
    });
}

// ---------- 7.6 Auditoría ----------

function viewAuditoria() {
    const est = students();
    const f = state.auditEst;
    const match = r => f === 'ALL' || r.EstudianteID === f;
    const notas = state.db.auditoria.filter(match).sort((a, b) => String(b.Fecha).localeCompare(String(a.Fecha)));
    const bit = state.db.bitacora.filter(match).sort((a, b) => String(b.Fecha).localeCompare(String(a.Fecha)));
    const name = id => esc(idx.users.get(id)?.Nombre || id || '—');

    return `
    <div class="row-between" style="align-items:flex-end">
        <label class="field"><span>Estudiante</span>
            <select class="inline-select" data-change="audit-est">${options([['ALL', 'Todos'], ...est.map(s => [s.ID, s.Nombre])], f)}</select></label>
        ${isAdmin() ? `<button class="btn btn-ghost" data-action="verify-audit">${ico('shield-check')} Verificar integridad</button>` : ''}
    </div>
    <div id="audit-check">${state.auditCheck ? auditCheckHtml(state.auditCheck) : ''}</div>
    <section class="card">
        <div class="card-head"><h2>Cambios de notas</h2><span class="badge">${notas.length}</span></div>
        ${notas.length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Fecha</th><th>Estudiante</th><th>Curso / Evaluación</th><th class="center">Antes → Ahora</th><th>Justificación</th><th>Por</th></tr></thead>
            <tbody>${notas.slice(0, 300).map(r => `<tr>
                <td>${fmtDateTime(r.Fecha)}</td><td>${name(r.EstudianteID)}</td>
                <td>${esc(idx.cursos.get(r.CursoID)?.NombreCurso || r.CursoID)}<br><small class="muted">${esc(idx.items.get(r.ItemID)?.Titulo || r.ItemID)}</small></td>
                <td class="center">${gradePill(toNum(r.NotaAnterior))} → ${gradePill(toNum(r.NotaNueva))}</td>
                <td class="wrap">${esc(r.Justificacion)}</td><td><small>${esc(r.ModificadoPor)}</small></td></tr>`).join('')}</tbody></table></div>`
        : emptyState('Sin cambios de notas registrados.', 'history')}
    </section>
    <section class="card">
        <div class="card-head"><h2>Bitácora de datos</h2><span class="badge">${bit.length}</span></div>
        ${bit.length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Fecha</th><th>Estudiante</th><th>Acción</th><th>Detalle</th><th>Justificación</th><th>Por</th></tr></thead>
            <tbody>${bit.slice(0, 300).map(r => `<tr>
                <td>${fmtDateTime(r.Fecha)}</td><td>${name(r.EstudianteID)}</td>
                <td><span class="badge">${esc(r.Entidad)} · ${esc(r.Accion)}</span></td>
                <td class="wrap">${esc(r.Detalle)}</td><td class="wrap">${esc(r.Justificacion)}</td><td><small>${esc(r.ModificadoPor)}</small></td></tr>`).join('')}</tbody></table></div>`
        : emptyState('Sin movimientos registrados.', 'history')}
    </section>`;
}

function auditCheckHtml(r) {
    if (r.ok) {
        return `<p class="alert alert-ok">${ico('shield-check')}<span>Integridad verificada (${fmtDateTime(r.verificadoEn)}): ${r.tablas.map(t => `${esc(t.tabla)} ${t.filas} registros`).join(' · ')}. Las notas vigentes coinciden con la auditoría.</span></p>`;
    }
    const tablas = r.tablas.filter(t => t.totalErrores).map(t => `<li><strong>${esc(t.tabla)}</strong>: ${t.totalErrores} problema(s)
        <ul>${t.errores.slice(0, 10).map(e => `<li>${e.fila ? `Fila ${e.fila}: ` : ''}${esc(e.motivo)}</li>`).join('')}</ul></li>`).join('');
    const notas = r.notas.slice(0, 15).map(n => `<li>${esc(idx.users.get(n.EstudianteID)?.Nombre || n.EstudianteID)} · ${esc(idx.items.get(n.ItemID)?.Titulo || n.ItemID)}:
        en la hoja <strong>${esc(n.notaEnHoja || '—')}</strong>, auditada <strong>${esc(n.ultimaAuditada || '—')}</strong></li>`).join('');
    return `<div class="alert alert-danger" role="alert">${ico('alert-triangle')}<div>
        <strong>Se detectaron modificaciones hechas fuera de la app.</strong>
        <p>Revisa <em>Archivo → Historial de versiones</em> en la hoja para ver quién y cuándo.</p>
        ${tablas ? `<ul>${tablas}</ul>` : ''}
        ${notas ? `<p><strong>Notas que no coinciden con la auditoría:</strong></p><ul>${notas}</ul>` : ''}
    </div></div>`;
}

function viewTutorStudent(estId) {
    const u = idx.users.get(estId);
    if (!u || u.Rol !== ROLES.ESTUDIANTE) return `<section class="card">${emptyState('Estudiante no encontrado.', 'search', '<a class="btn btn-ghost" href="#/usuarios">Volver</a>')}</section>`;
    const padres = state.db.users.filter(p => p.Rol === ROLES.PADRE && String(p.HijosIDs || '').split(',').includes(estId));
    const botones = [
        puedoEscribirA(u) ? `<button class="btn btn-primary btn-sm" data-action="nuevo-mensaje" data-para="${esc(u.ID)}">${ico('message-square')} Mensaje al alumno</button>` : '',
        ...padres.filter(puedoEscribirA).map(p => `<button class="btn btn-ghost btn-sm" data-action="nuevo-mensaje" data-para="${esc(p.ID)}">${ico('message-square')} Mensaje a ${esc(p.Nombre)}</button>`),
        esStaff() && padres.length ? `<button class="btn btn-ghost btn-sm" data-action="cita-alumno" data-est="${esc(estId)}">${ico('calendar')} Citar a los padres</button>` : '',
    ].join('');
    return `<div class="row-between"><a class="btn btn-link" href="#/usuarios">${ico('arrow-left')} Usuarios</a><div class="row">${botones}</div></div>${progressView(estId, { showAudit: true })}`;
}

// ==========================================================================
// 8. VISTAS DEL ESTUDIANTE
// ==========================================================================

function itemEstado(item, estId) {
    const ent = idx.entregas.get(`${estId}|${item.ItemID}`);
    const nota = toNum(ent?.Nota);
    if (nota != null) {
        const ef = notaEfectiva(item, ent);
        const pill = ef !== nota
            ? `<span class="grade-pill ${gradeClass(ef, aprobDe(item.CursoID))}" title="Nota del trabajo: ${fmtNota(nota)} · ${esc(reglaTexto(item))}">${fmtNota(ef)}</span>`
            : gradePill(nota);
        return { key: 'calificado', html: `<span class="badge badge-success">Calificado</span> ${pill}`, ent, nota };
    }
    if (ent?.Estado === 'Entregado' || ent?.RecibidoEn) return { key: 'entregado', html: '<span class="badge badge-info">Entregado</span>', ent, nota };
    const vencido = item.FechaEntrega && item.FechaEntrega < today();
    return { key: vencido ? 'vencido' : 'pendiente', html: `<span class="badge ${vencido ? 'badge-danger' : 'badge-warn'}">${vencido ? 'Vencido' : 'Pendiente'}</span>`, ent, nota };
}

function viewStudentHome() {
    const me = state.me;
    const cursos = cursosDe(me.ID);
    const general = Grades.general(me.ID);
    const asist = attendanceStats(me.ID);
    const proximas = cursos.flatMap(c => idx.itemsByCurso.get(c.CursoID) || [])
        .filter(i => i.FechaEntrega && i.FechaEntrega >= today() && itemEstado(i, me.ID).key === 'pendiente')
        .sort((a, b) => a.FechaEntrega.localeCompare(b.FechaEntrega)).slice(0, 6);
    const pendientes = cursos.flatMap(c => idx.itemsByCurso.get(c.CursoID) || [])
        .filter(i => TIPOS_CON_ENTREGA.includes(i.Tipo) && ['pendiente', 'vencido'].includes(itemEstado(i, me.ID).key)).length;

    return `
    <div class="hero">${avatar(me, 'lg')}<div><h2>¡Hola, ${esc(String(me.Nombre).split(' ')[0])}!</h2><p>${esc(me.Grado || 'Bienvenido a la Plataforma Educativa')}</p></div></div>
    <div class="grid grid-kpi">
        ${kpi('Promedio general', `<span class="grade ${gradeClass(general)}">${fmtNota(general)}</span>`, 'Todos tus cursos', 'award')}
        ${kpi('Cursos', cursos.length, '', 'book-open')}
        ${kpi('Tareas por entregar', pendientes, '', 'inbox')}
        ${kpi('Asistencia', asist.pct == null ? '—' : `${fmtNota(asist.pct)}%`, `${asist.total} sesiones`, 'calendar-check')}
    </div>
    ${cursos.length ? `<div class="grid grid-2">${cursos.map(c => courseSummaryCard(me.ID, c, true)).join('')}</div>`
        : `<section class="card">${emptyState('Aún no estás inscrito en ningún curso.', 'book-open')}</section>`}
    ${proximas.length ? `<section class="card"><div class="card-head"><h2>Próximas entregas</h2></div>
        <ul class="item-list">${proximas.map(i => `<li class="item-row">${tipoBadge(i.Tipo)}
            <div class="item-main">${itemLink(i)}<div class="item-meta"><span>${esc(idx.cursos.get(i.CursoID)?.NombreCurso)}</span><span>Entrega ${fmtDate(i.FechaEntrega)}</span></div></div>
            <div class="item-side"><a class="btn btn-ghost btn-sm" href="#/mis-cursos" data-action="open-student-course" data-curso="${esc(i.CursoID)}">Ir al curso</a></div></li>`).join('')}</ul></section>` : ''}
    ${anotacionesSection(me.ID)}`;
}

function courseSummaryCard(estId, c, linkToCourse = false) {
    const res = Grades.forStudent(estId, c.CursoID);
    return `<section class="card">
        <div class="card-head"><div><h3>${esc(c.NombreCurso)}</h3><div class="row" style="gap:8px;margin-top:4px"><small class="muted meta-line">${ico('presentation', 'icon-xs')}${esc(tutorDe(c))}</small></div></div>
            ${linkToCourse ? `<button class="btn btn-ghost btn-sm" data-action="open-student-course" data-curso="${esc(c.CursoID)}">Ver curso</button>` : ''}</div>
        <div class="card-body stack">
            <div class="row-between"><span class="muted">Promedio del curso</span><span class="grade-big grade ${gradeClass(res.final)}">${fmtNota(res.final)}</span></div>
            ${res.units.map(u => `<div class="stack" style="gap:6px">
                <div class="row-between" style="font-size:14px"><span><strong>U${u.numero}</strong> · ${esc(u.nombre)} <small class="muted">(${fmtPeso(u.peso)})</small></span>
                <span class="grade ${gradeClass(u.promedio)}">${fmtNota(u.promedio)}</span></div>
                ${bar(u.promedio)}
                <small class="muted">Evaluado ${fmtPeso(u.pesoEvaluado)} de ${fmtPeso(u.pesoTotal)} · Acumulado ${fmtNota(u.acumulado)} pts</small>
            </div>`).join('') || '<p class="muted">Sin evaluaciones todavía.</p>'}
        </div></section>`;
}

function viewStudentCursos() {
    const me = state.me;
    const cursos = cursosDe(me.ID);
    if (!cursos.length) return `<section class="card">${emptyState('Aún no estás inscrito en ningún curso.', 'book-open')}</section>`;
    if (!cursos.some(c => c.CursoID === state.studentCurso)) state.studentCurso = cursos[0].CursoID;
    const c = idx.cursos.get(state.studentCurso);
    const res = Grades.forStudent(me.ID, c.CursoID);
    const pensum = idx.pensumByCurso.get(c.CursoID) || [];

    return `
    <div class="tabs" role="tablist">${cursos.map(x =>
        `<button class="tab" role="tab" aria-selected="${x.CursoID === c.CursoID}" data-action="student-course" data-curso="${esc(x.CursoID)}">${esc(x.NombreCurso)}</button>`).join('')}</div>
    <section class="card">
        <div class="card-head"><div><h2>${esc(c.NombreCurso)}</h2><p class="muted" style="font-size:14px">${esc(c.Descripcion || '')}</p></div>
            <div class="row"><span class="muted">Promedio</span><span class="grade-big grade ${gradeClass(res.final)}">${fmtNota(res.final)}</span></div></div>
        ${materialLista(c.CursoID, 0, false, true)}
        ${res.units.map(u => {
            const temas = pensum.filter(p => +p.Unidad === u.numero);
            return `<div class="unit-block">
                <div class="unit-head"><h3>U${u.numero} · ${esc(u.nombre)} <small class="muted">(${fmtPeso(u.peso)})</small></h3>
                    <span>Promedio ${gradePill(u.promedio)}</span></div>
                ${temas.length ? `<ul class="topic-list">${temas.map(t => `<li><strong>${esc(t.Tema)}</strong>${t.Detalle ? ` — <small>${esc(t.Detalle)}</small>` : ''}</li>`).join('')}</ul>` : ''}
                ${materialLista(c.CursoID, u.numero, false, true)}
                ${u.items.length ? `<ul class="item-list">${u.items.map(i => studentItemRow(i, me.ID)).join('')}</ul>` : ''}
            </div>`;
        }).join('') || emptyState('Tu tutor aún no ha publicado evaluaciones.', 'clipboard-list')}
    </section>`;
}

function studentItemRow(item, estId) {
    const st = itemEstado(item, estId);
    const rol = state.me.Rol;
    const puedeSubir = rol === ROLES.ESTUDIANTE && TIPOS_CON_ENTREGA.includes(item.Tipo) && st.nota == null;
    const ent = st.ent;
    const marcas = [
        ent?.HechaEn ? `<span class="badge badge-info" title="Marcada por el alumno · ${esc(fmtDateTime(ent.HechaEn))}">${ico('check')}Hecha</span>` : '',
        ent?.RevisadaEn ? `<span class="badge badge-success" title="Revisada por ${esc(ent.RevisadaPor)} · ${esc(fmtDateTime(ent.RevisadaEn))}">${ico('check-check')}Revisada</span>` : '',
        ent?.RecibidoEn ? '<span class="badge badge-brand">Recibido</span>' : '',
    ].join('');
    const datos = `data-item="${esc(item.ItemID)}" data-est="${esc(estId)}"`;
    let seguimiento = '';
    if (rol === ROLES.ESTUDIANTE && TIPOS_CON_ENTREGA.includes(item.Tipo) && st.nota == null && !ent?.TieneArchivo) {
        seguimiento = ent?.HechaEn
            ? `<button class="btn btn-link" data-action="marcar-tarea" data-accion="pendiente" ${datos}>Deshacer</button>`
            : `<button class="btn btn-ghost btn-sm" data-action="marcar-tarea" data-accion="hecha" ${datos}>${ico('check')} Marcar como hecha</button>`;
    }
    if (rol === ROLES.PADRE) {
        seguimiento = ent?.RevisadaEn
            ? `<button class="btn btn-link" data-action="marcar-tarea" data-accion="no-revisada" ${datos}>Deshacer revisión</button>`
            : `<button class="btn btn-ghost btn-sm" data-action="marcar-tarea" data-accion="revisada" ${datos}>${ico('check-check')} Marcar revisada</button>`;
    }
    return `<li class="item-row">
        ${tipoBadge(item.Tipo)}
        <div class="item-main">${itemLink(item)}
            <div class="item-meta"><span>Ponderación ${fmtPeso(item.Ponderacion)}</span>${item.FechaEntrega ? `<span>Entrega ${fmtDate(item.FechaEntrega)}</span>` : ''}
            ${entregaBtn(st.ent, `${ico('paperclip', 'icon-sm')} ${state.me.Rol === ROLES.ESTUDIANTE ? 'Ver mi entrega' : 'Ver entrega'}`, 'btn btn-link')}</div>
            ${adjuntosHtml(item, false)}</div>
        <div class="item-side">${st.html}${puntualidadBadge(item, ent)}${marcas}
            ${puedeSubir ? `<button class="btn ${st.ent?.TieneArchivo ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="upload-entrega" data-item="${esc(item.ItemID)}">${ico('upload')} ${st.ent?.TieneArchivo ? 'Reemplazar archivo' : 'Subir entrega'}</button>` : ''}
            ${seguimiento}
        </div></li>`;
}

function viewStudentAsistencia() {
    return attendanceSection(state.me.ID, true);
}

function attendanceSection(estId, full = false) {
    const s = attendanceStats(estId);
    const rows = [...s.rows].sort((a, b) => String(b.Fecha).localeCompare(String(a.Fecha)));
    const color = { Presente: 'badge-success', Tarde: 'badge-warn', Ausente: 'badge-danger', Justificado: 'badge-info' };
    const shown = full ? rows : rows.slice(0, 15);
    return `
    ${full ? `<div class="grid grid-kpi">
        ${kpi('Asistencia', s.pct == null ? '—' : `${fmtNota(s.pct)}%`, 'Presente + tarde', 'calendar-check')}
        ${kpi('Presente', s.Presente)}${kpi('Tarde', s.Tarde)}${kpi('Ausente', s.Ausente)}${kpi('Justificado', s.Justificado)}
    </div>` : ''}
    <section class="card">
        <div class="card-head"><h2>Historial de asistencia</h2>${!full && s.pct != null ? `<span class="grade-pill ${gradeClass(s.pct)}">${fmtNota(s.pct)}%</span>` : ''}</div>
        ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Curso</th><th>Estado</th></tr></thead>
        <tbody>${shown.map(r => `<tr><td>${fmtDate(r.Fecha)}</td><td>${esc(idx.cursos.get(r.CursoID)?.NombreCurso || '—')}</td>
            <td><span class="badge ${color[r.Estado] || ''}">${esc(r.Estado)}</span></td></tr>`).join('')}</tbody></table></div>
        ${rows.length > shown.length ? `<p class="muted card-body">Mostrando las últimas ${shown.length} de ${rows.length} sesiones.</p>` : ''}`
        : emptyState('Aún no hay asistencia registrada.', 'calendar-check')}
    </section>`;
}

// ==========================================================================
// 9. VISTAS DEL PADRE Y COMPARTIDAS
// ==========================================================================

function viewParent() {
    const hijos = String(state.me.HijosIDs || '').split(',').map(id => idx.users.get(id)).filter(Boolean).sort(byName);
    if (!hijos.length) return `<section class="card">${emptyState('Tu cuenta aún no tiene estudiantes vinculados. Contacta al tutor.', 'users')}</section>`;
    if (!hijos.some(h => h.ID === state.childId)) state.childId = hijos[0].ID;
    return `
    ${hijos.length > 1 ? `<div class="child-picker" role="group" aria-label="Seleccionar hijo">${hijos.map(h =>
        `<button class="child-chip" aria-pressed="${h.ID === state.childId}" data-action="pick-child" data-id="${esc(h.ID)}">${avatar(h, 'sm')}${esc(h.Nombre)}</button>`).join('')}</div>` : ''}
    ${progressView(state.childId, { showAudit: true })}`;
}

/** Progreso completo de un estudiante (solo lectura). Lo usan Padre y Tutor. */
function progressView(estId, { showAudit = false } = {}) {
    const u = idx.users.get(estId);
    const cursos = cursosDe(estId);
    const general = Grades.general(estId);
    const estados = cursosDe(estId).map(c => estadoFinal(Grades.forStudent(estId, c.CursoID).final, c));
    const nAprob = estados.filter(e => e === 'aprobado').length, nRepr = estados.filter(e => e === 'reprobado').length;
    const asist = attendanceStats(estId);
    const calificadas = state.db.entregas.filter(e => e.EstudianteID === estId && toNum(e.Nota) != null).length;

    const cursoCards = cursos.map(c => {
        const res = Grades.forStudent(estId, c.CursoID);
        return `<section class="card">
            <div class="card-head"><div><h3>${esc(c.NombreCurso)}</h3><div class="row" style="gap:8px;margin-top:4px"><small class="muted meta-line">${ico('presentation', 'icon-xs')}${esc(tutorDe(c))}</small></div></div>
                <div class="row"><span class="muted">Final</span><span class="grade-pill ${gradeClass(res.final, aprobDe(c.CursoID))}">${fmtNota(res.final)}</span>${estadoBadge(res.final, c)}</div></div>
            ${res.units.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>Unidad</th><th class="num">Peso</th><th style="width:30%">Progreso</th><th class="center">Promedio</th></tr></thead>
                <tbody>${res.units.map(un => `<tr><td><strong>U${un.numero}</strong> · ${esc(un.nombre)}</td><td class="num">${fmtPeso(un.peso)}</td>
                    <td>${bar(un.promedio)}<small class="muted">Evaluado ${fmtPeso(un.pesoEvaluado)} de ${fmtPeso(un.pesoTotal)}</small></td>
                    <td class="center">${gradePill(un.promedio)}</td></tr>`).join('')}</tbody></table></div>
            <details class="more"><summary>Ver notas por evaluación</summary>
                <ul class="item-list">${res.units.flatMap(un => un.items).map(i => studentItemRow(i, estId)).join('')}</ul>
            </details>` : emptyState('Sin evaluaciones todavía.', 'clipboard-list')}
            ${(idx.materialesByCurso.get(c.CursoID) || []).length ? `<details class="more"><summary>Material de apoyo (${idx.materialesByCurso.get(c.CursoID).length})</summary>
                ${materialLista(c.CursoID, null, false)}</details>` : ''}
        </section>`;
    }).join('');

    return `
    <div class="hero">${avatar(u, 'lg')}<div><h2>${esc(u?.Nombre)}</h2>
        <p>${esc(u?.Grado || '')}${u?.FechaNacimiento ? ` · Nac. ${fmtDate(u.FechaNacimiento)}` : ''}</p></div></div>
    <div class="grid grid-kpi">
        ${kpi('Promedio general', `<span class="grade ${gradeClass(general)}">${fmtNota(general)}</span>`, `${nAprob} curso(s) aprobado(s) · ${nRepr} reprobado(s)`, 'award')}
        ${kpi('Asistencia', asist.pct == null ? '—' : `${fmtNota(asist.pct)}%`, `${asist.Ausente} ausencia(s)`, 'calendar-check')}
        ${kpi('Cursos', cursos.length, '', 'book-open')}
        ${kpi('Evaluaciones calificadas', calificadas, '', 'circle-check')}
    </div>
    ${cursoCards || `<section class="card">${emptyState('Sin cursos inscritos.', 'book-open')}</section>`}
    ${anotacionesSection(estId)}
    ${attendanceSection(estId)}
    ${showAudit ? auditTimeline(estId) : ''}`;
}

function auditTimeline(estId) {
    const eventos = [
        ...state.db.auditoria.filter(a => a.EstudianteID === estId).map(a => ({
            fecha: a.Fecha,
            titulo: `Nota · ${idx.items.get(a.ItemID)?.Titulo || 'Evaluación'} (${idx.cursos.get(a.CursoID)?.NombreCurso || ''})`,
            detalle: `${gradePill(toNum(a.NotaAnterior))} → ${gradePill(toNum(a.NotaNueva))}`,
            just: a.Justificacion, por: a.ModificadoPor,
        })),
        ...state.db.bitacora.filter(b => b.EstudianteID === estId).map(b => ({
            fecha: b.Fecha, titulo: `${b.Entidad} · ${b.Accion}`, detalle: esc(b.Detalle), just: b.Justificacion, por: b.ModificadoPor,
        })),
    ].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

    return `<section class="card">
        <div class="card-head"><h2>Bitácora del tutor</h2><span class="badge">${eventos.length}</span></div>
        ${eventos.length ? `<ul class="timeline">${eventos.slice(0, 100).map(e => `<li>
            <div class="row-between"><strong>${esc(e.titulo)}</strong><small class="muted">${fmtDateTime(e.fecha)}</small></div>
            <div>${e.detalle}</div>
            ${e.just ? `<p class="quote">${ico('message-square', 'icon-sm')}<span>${esc(e.just)}</span></p>` : ''}
            <small class="muted">Por ${esc(e.por)}</small></li>`).join('')}</ul>`
        : emptyState('Sin cambios ni comentarios registrados.', 'message-square')}
    </section>`;
}

// ==========================================================================
// 9b. MURO: noticias, pendientes, anotaciones y marcas de seguimiento
// ==========================================================================

const TIPOS_ANOTACION = ['Positiva', 'Académica', 'Conducta', 'Disciplinaria'];
const ANOTACION_BADGE = { Positiva: 'badge-success', 'Académica': 'badge-info', Conducta: 'badge-warn', Disciplinaria: 'badge-danger' };
const fotosNoticias = new Map();   // NoticiaID → imagen (caché de la sesión)

const esStaff = () => [ROLES.ADMIN, ROLES.TUTOR].includes(state.me.Rol);
const esPadre = () => state.me.Rol === ROLES.PADRE;
const miLectura = (noticiaId) => state.db.lecturas.find(l => l.NoticiaID === noticiaId);
const gestionaNoticia = (n) => isAdmin() || n.AutorID === state.me.ID;
const hijosDe = () => String(state.me.HijosIDs || '').split(',').map(id => idx.users.get(id)).filter(Boolean);
/** Cuenta como entregada si tiene archivo, el maestro marcó "Recibido" o ya tiene nota. */
const entregada = (ent) => !!ent && (!!ent.TieneArchivo || !!ent.RecibidoEn || toNum(ent.Nota) != null);

function tasaEntrega(item) {
    const alumnos = alumnosDe(item.CursoID);
    const n = alumnos.filter(a => entregada(idx.entregas.get(`${a.ID}|${item.ItemID}`))).length;
    return { n, total: alumnos.length, pct: alumnos.length ? (n / alumnos.length) * 100 : null };
}

function alcanceTexto(n) {
    if (n.Alcance === 'COLEGIO') return 'Todo el colegio';
    if (n.Alcance === 'ALUMNOS') {
        const nombres = (n.EstudianteIDs || []).map(id => idx.users.get(id)?.Nombre).filter(Boolean).join(', ') || 'alumnos específicos';
        return n.Tipo === 'CITA' ? `Padres de ${nombres}` : nombres;
    }
    const nombres = (n.CursoIDs || []).map(id => idx.cursos.get(id)?.NombreCurso).filter(Boolean);
    return nombres.length ? nombres.join(', ') : 'Cursos específicos';
}

/** Actualiza una entrega en memoria tras una marca (sin recargar todo). */
function actualizarEntrega(estId, itemId, patch) {
    const id = `${itemId}_${estId}`;
    let e = state.db.entregas.find(x => x.EntregaID === id);
    if (!e) {
        e = { EntregaID: id, ItemID: itemId, EstudianteID: estId, Nota: '', Estado: 'Pendiente', TieneArchivo: false };
        state.db.entregas.push(e);
    }
    Object.assign(e, patch);
    buildIndex();
}

const prioridadNoticia = (n) => (n.Obligatoria && esPadre() && !miLectura(n.NoticiaID) ? 1 : 0);

function viewMuro() {
    const noticias = [...state.db.noticias].sort((a, b) =>
        prioridadNoticia(b) - prioridadNoticia(a) || String(b.PublicadaEn).localeCompare(String(a.PublicadaEn)));
    const atencion = atencionItems();
    return `
    <div class="row-between">
        <p class="muted">${esStaff() ? 'Noticias del colegio y seguimiento de tus cursos.' : 'Avisos del colegio y lo que necesita tu atención.'}</p>
        ${esStaff() ? `<button class="btn btn-primary" data-action="new-noticia">${ico('megaphone')} Publicar noticia</button>` : ''}
    </div>
    ${atencion.length ? `<section class="card atencion">
        <div class="card-head"><h2 class="meta-line">${ico('bell')} Requiere tu atención</h2><span class="badge badge-warn">${atencion.length}</span></div>
        <ul class="item-list">${atencion.join('')}</ul></section>` : ''}
    <section class="stack">
        <h2 class="eyebrow">Noticias</h2>
        ${noticias.length ? `<div class="news-feed">${noticias.map(noticiaCard).join('')}</div>`
            : `<section class="card">${emptyState('No hay nada nuevo.', 'newspaper')}</section>`}
    </section>`;
}

function itemAtencion(badge, titulo, detalle, botones) {
    return `<li class="item-row">${badge}<div class="item-main"><strong>${titulo}</strong>${detalle ? `<div class="item-meta">${detalle}</div>` : ''}</div>
        <div class="item-side">${botones}</div></li>`;
}

/** Lo pendiente de cada rol, con su acción directa. */
function atencionItems() {
    const out = [];
    const rol = state.me.Rol;
    const sinLeer = convsSinLeer();
    if (sinLeer.length) out.push(itemAtencion(`<span class="badge badge-info">${ico('message-square')}Mensajes</span>`,
        `${sinLeer.length} conversación(es) con mensajes nuevos`, sinLeer.slice(0, 3).map(c => `<span>${esc(convTitulo(c))}</span>`).join(''),
        `<a class="btn btn-primary btn-sm" href="#/mensajes/${encodeURIComponent(sinLeer[0].ConvID)}">Leer</a>`));
    if (rol === ROLES.PADRE) {
        citasPendientes().forEach(e => out.push(itemAtencion(`<span class="badge badge-brand">${ico('calendar')}Cita</span>`, esc(e.Titulo),
            `<span>${esc(cuandoEvento(e))}</span><span>${esc(e.AutorNombre)}</span>`,
            `<button class="btn btn-primary btn-sm" data-action="ver-evento" data-tipo="evento" data-id="${esc(e.EventoID)}">Responder</button>`)));
        state.db.noticias.filter(n => n.Obligatoria && !miLectura(n.NoticiaID)).forEach(n => out.push(itemAtencion(
            `<span class="badge badge-danger">${ico('bell')}Obligatoria</span>`, esc(n.Titulo), `<span>${esc(n.AutorNombre)}</span><span>${fmtDate(n.PublicadaEn)}</span>`,
            `<button class="btn btn-primary btn-sm" data-action="leer-noticia" data-id="${esc(n.NoticiaID)}">${ico('check-check')} Leído y entendido</button>`)));
        state.db.anotaciones.filter(a => !a.Confirmaciones?.[state.me.ID]).forEach(a => out.push(itemAtencion(
            `<span class="badge ${ANOTACION_BADGE[a.Tipo] || ''}">${esc(a.Tipo)}</span>`,
            `Anotación sobre ${esc(idx.users.get(a.EstudianteID)?.Nombre || 'tu hijo')}`,
            `<span>${esc(a.Texto.length > 90 ? a.Texto.slice(0, 90) + '…' : a.Texto)}</span><span>${esc(a.AutorNombre)}</span>`,
            `<button class="btn btn-primary btn-sm" data-action="confirmar-anotacion" data-id="${esc(a.AnotacionID)}">${ico('check-check')} Enterado</button>`)));
        hijosDe().forEach(h => cursosDe(h.ID).flatMap(c => idx.itemsByCurso.get(c.CursoID) || []).forEach(i => {
            const ent = idx.entregas.get(`${h.ID}|${i.ItemID}`);
            if (ent?.HechaEn && !ent.RevisadaEn && toNum(ent.Nota) == null) {
                out.push(itemAtencion(tipoBadge(i.Tipo), `${esc(h.Nombre)} marcó como hecha: ${esc(i.Titulo)}`,
                    `<span>${esc(idx.cursos.get(i.CursoID)?.NombreCurso)}</span><span>${fmtDateTime(ent.HechaEn)}</span>`,
                    `<button class="btn btn-ghost btn-sm" data-action="marcar-tarea" data-accion="revisada" data-item="${esc(i.ItemID)}" data-est="${esc(h.ID)}">${ico('check-check')} Marcar revisada</button>`));
            } else if (TIPOS_CON_ENTREGA.includes(i.Tipo) && i.FechaEntrega && i.FechaEntrega < today() && !entregada(ent) && !ent?.HechaEn) {
                out.push(itemAtencion('<span class="badge badge-danger">Vencida</span>', `${esc(h.Nombre)} no ha entregado: ${esc(i.Titulo)}`,
                    `<span>${esc(idx.cursos.get(i.CursoID)?.NombreCurso)}</span><span>Venció ${fmtDate(i.FechaEntrega)}</span>`,
                    `<a class="btn btn-ghost btn-sm" href="#/progreso">Ver progreso</a>`));
            }
        }));
    }
    if (rol === ROLES.ESTUDIANTE) {
        cursosDe(state.me.ID).flatMap(c => idx.itemsByCurso.get(c.CursoID) || []).forEach(i => {
            const ent = idx.entregas.get(`${state.me.ID}|${i.ItemID}`);
            if (!TIPOS_CON_ENTREGA.includes(i.Tipo) || toNum(ent?.Nota) != null || ent?.HechaEn || entregada(ent)) return;
            const vencida = i.FechaEntrega && i.FechaEntrega < today();
            out.push(itemAtencion(vencida ? '<span class="badge badge-danger">Vencida</span>' : tipoBadge(i.Tipo), esc(i.Titulo),
                `<span>${esc(idx.cursos.get(i.CursoID)?.NombreCurso)}</span>${i.FechaEntrega ? `<span>Entrega ${fmtDate(i.FechaEntrega)}</span>` : ''}`,
                `<button class="btn btn-ghost btn-sm" data-action="marcar-tarea" data-accion="hecha" data-item="${esc(i.ItemID)}" data-est="${esc(state.me.ID)}">${ico('check')} Marcar como hecha</button>
                 <button class="btn btn-link" data-action="open-student-course" data-curso="${esc(i.CursoID)}">Ir al curso</button>`));
        });
    }
    if (esStaff()) {
        const propios = new Set(cursosGestionables().map(c => c.CursoID));
        const porCalificar = state.db.entregas.filter(e => toNum(e.Nota) == null && (e.TieneArchivo || e.RecibidoEn) && propios.has(idx.items.get(e.ItemID)?.CursoID)).length;
        if (porCalificar) out.push(itemAtencion('<span class="badge badge-warn">Por calificar</span>', `${porCalificar} entrega(s) esperan nota`, '',
            `<a class="btn btn-primary btn-sm" href="#/calificaciones">Calificar</a>`));
        cursosGestionables().flatMap(c => idx.itemsByCurso.get(c.CursoID) || []).forEach(i => {
            if (!i.FechaEntrega || i.FechaEntrega >= today()) return;
            const t = tasaEntrega(i);
            if (t.total && t.n < t.total) out.push(itemAtencion(tipoBadge(i.Tipo), `${esc(i.Titulo)}: faltan ${t.total - t.n} entrega(s)`,
                `<span>${esc(idx.cursos.get(i.CursoID)?.NombreCurso)}</span><span>Venció ${fmtDate(i.FechaEntrega)}</span><span>${t.n}/${t.total} (${fmtNota(t.pct)}%)</span>`,
                `<button class="btn btn-ghost btn-sm" data-action="ver-entregas" data-id="${esc(i.ItemID)}">${ico('check-check')} Entregas</button>`));
        });
        state.db.noticias.filter(n => n.Obligatoria && n.AutorID === state.me.ID && !n.Vencida).forEach(n => out.push(itemAtencion(
            `<span class="badge badge-danger">${ico('bell')}Obligatoria</span>`, `Tu noticia: ${esc(n.Titulo)}`, `<span>Revisa qué padres ya confirmaron</span>`,
            `<button class="btn btn-ghost btn-sm" data-action="detalle-noticia" data-id="${esc(n.NoticiaID)}">${ico('users')} Confirmaciones</button>`)));
    }
    return out;
}

function noticiaCard(n) {
    const lect = miLectura(n.NoticiaID);
    const obligPadre = n.Obligatoria && esPadre();
    const accion = lect
        ? `<span class="badge badge-success">${ico('check-check')}${obligPadre ? 'Leído y entendido' : 'Visto'} · ${fmtDateTime(lect.Fecha)}</span>`
        : `<button class="btn ${obligPadre ? 'btn-primary' : 'btn-ghost'} btn-sm" data-action="leer-noticia" data-id="${esc(n.NoticiaID)}">${ico(obligPadre ? 'check-check' : 'eye')} ${obligPadre ? 'Leído y entendido' : 'Marcar como visto'}</button>`;
    const gestion = gestionaNoticia(n) ? `
        <button class="btn btn-ghost btn-sm" data-action="detalle-noticia" data-id="${esc(n.NoticiaID)}">${ico('users')} ${n.Obligatoria ? 'Confirmaciones' : 'Lecturas'}</button>
        <button class="icon-btn" data-action="edit-noticia" data-id="${esc(n.NoticiaID)}" title="Editar" aria-label="Editar noticia">${ico('pencil')}</button>
        <button class="icon-btn danger" data-action="delete-noticia" data-id="${esc(n.NoticiaID)}" title="Eliminar" aria-label="Eliminar noticia">${ico('trash')}</button>` : '';
    return `<article class="card news-card${obligPadre && !lect ? ' is-pendiente' : ''}">
        ${n.TieneFoto ? `<div class="news-foto" data-foto="${esc(n.NoticiaID)}"><span class="spinner"></span></div>` : ''}
        <div class="news-body">
            <div class="row">${n.Obligatoria ? `<span class="badge badge-danger">${ico('bell')}Obligatoria</span>` : ''}
                <span class="badge">${esc(alcanceTexto(n))}</span>${n.Vencida ? '<span class="badge badge-warn">Vencida</span>' : ''}</div>
            <h3>${esc(n.Titulo)}</h3>
            <p class="news-text">${esc(n.Cuerpo)}</p>
            <div class="news-meta"><span>${esc(n.AutorNombre)}</span><span>${fmtDateTime(n.PublicadaEn)}</span><span>Visible hasta ${fmtDate(n.VenceEl)}</span></div>
            <div class="row-between"><div>${accion}</div><div class="row">${gestion}</div></div>
        </div>
    </article>`;
}

/** Las fotos se piden aparte (son privadas) y se guardan en memoria durante la sesión. */
function cargarFotosMuro() {
    $$('[data-foto]').forEach((el) => {
        const id = el.dataset.foto;
        const pintar = (src) => { el.innerHTML = `<img src="${esc(src)}" alt="">`; };
        if (fotosNoticias.has(id)) return pintar(fotosNoticias.get(id));
        api('getNoticiaFoto', { NoticiaID: id })
            .then((r) => { fotosNoticias.set(id, r.dataUrl); if (document.body.contains(el)) pintar(r.dataUrl); })
            .catch(() => el.remove());
    });
}

/** Reduce la foto (lado mayor 1280 px, JPEG) para que el muro cargue rápido. */
async function comprimirFoto(file, maxLado = 1280, maxChars = 1300000) {
    const bitmap = await createImageBitmap(file).catch(() => { throw new Error('No se pudo leer la imagen. Prueba con otro archivo JPG o PNG.'); });
    const escala = Math.min(1, maxLado / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * escala);
    const h = Math.round(bitmap.height * escala);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    for (let q = 0.85; q >= 0.4; q -= 0.1) {
        const d = canvas.toDataURL('image/jpeg', q);
        if (d.length <= maxChars) return d;
    }
    throw new Error('La imagen es demasiado pesada. Prueba con otra.');
}

async function openNoticiaModal(n = null) {
    const cursos = cursosGestionables();
    const d = new Date();
    d.setDate(d.getDate() + 14);
    const venceDef = d.toLocaleDateString('en-CA');
    const alcance = n?.Alcance || 'COLEGIO';
    const sel = new Set(n?.CursoIDs || []);
    await openModal({
        title: n ? 'Editar noticia' : 'Publicar noticia',
        wide: true,
        submitLabel: n ? 'Guardar cambios' : 'Publicar',
        body: `<div class="form-grid">
            <label class="field span-all"><span>Título *</span><input name="Titulo" required maxlength="160" value="${esc(n?.Titulo)}"></label>
            <label class="field span-all"><span>Mensaje *</span><textarea name="Cuerpo" required maxlength="5000" rows="5">${esc(n?.Cuerpo)}</textarea></label>
            <fieldset class="field span-all" style="border:0;padding:0;margin:0"><span>¿Para quién? *</span>
                <div class="segmented" role="radiogroup" aria-label="Destinatarios">
                    <label><input type="radio" name="Alcance" value="COLEGIO" data-change="noticia-alcance" ${alcance === 'COLEGIO' ? 'checked' : ''}><span>Todo el colegio</span></label>
                    <label><input type="radio" name="Alcance" value="CURSOS" data-change="noticia-alcance" ${alcance === 'CURSOS' ? 'checked' : ''}><span>Cursos específicos</span></label>
                </div>
                <div data-cursos style="margin-top:10px" ${alcance === 'CURSOS' ? '' : 'hidden'}>
                    ${picker({ name: 'CursoIDs', items: cursos.map(itemCurso), selected: [...sel], filtros: [], placeholder: 'Buscar curso…', vacio: 'No tienes cursos asignados.' })}</div>
            </fieldset>
            <label class="field"><span>Visible hasta *</span><input type="date" name="VenceEl" required min="${today()}" value="${esc(n?.VenceEl || venceDef)}"></label>
            <label class="check-item" style="align-self:end"><input type="checkbox" name="Obligatoria" ${n?.Obligatoria ? 'checked' : ''}>
                <span><strong>Obligatoria</strong><small>Los padres deben confirmar "Leído y entendido"</small></span></label>
            <div class="field span-all"><span>Foto (opcional)</span>
                <div class="row">
                    <button type="button" class="btn btn-ghost btn-sm" data-action="noticia-foto">${ico('image')} ${n?.TieneFoto ? 'Cambiar foto' : 'Agregar foto'}</button>
                    <span class="muted" data-foto-estado>${n?.TieneFoto ? 'Tiene foto' : 'Sin foto'}</span>
                    ${n?.TieneFoto ? '<label class="row" style="gap:6px"><input type="checkbox" name="QuitarFoto"> Quitar foto</label>' : ''}
                </div>
                <img data-foto-preview alt="" class="news-preview" hidden>
            </div>
        </div>`,
        onSubmit: async (fd, form) => {
            const alc = fd.get('Alcance');
            const cursoIds = fd.getAll('CursoIDs');
            if (alc === 'CURSOS' && !cursoIds.length) throw new Error('Selecciona al menos un curso.');
            const payload = {
                NoticiaID: n?.NoticiaID, Titulo: fd.get('Titulo'), Cuerpo: fd.get('Cuerpo'), Alcance: alc,
                CursoIDs: cursoIds, VenceEl: fd.get('VenceEl'), Obligatoria: fd.get('Obligatoria') === 'on',
            };
            if (form.dataset.foto) payload.Foto = form.dataset.foto;
            else if (fd.get('QuitarFoto') === 'on') payload.Foto = 'QUITAR';
            await withBusy(() => api('saveNoticia', payload));
            if (n) fotosNoticias.delete(n.NoticiaID);
            toast(n ? 'Noticia actualizada.' : 'Noticia publicada.', 'success');
            await refresh();
        },
    });
}

async function detalleNoticia(id) {
    const n = state.db.noticias.find(x => x.NoticiaID === id);
    let d;
    try { d = await withBusy(() => api('noticiaDetalle', { NoticiaID: id })); } catch (e) { return toast(e.message, 'error'); }
    const lista = (arr) => arr.length
        ? `<ul class="plain-list">${arr.map(u => `<li><strong>${esc(u.Nombre)}</strong>${u.Rol ? ` <small class="muted">(${esc(ROLE_LABEL[u.Rol] || u.Rol)})</small>` : ''}${u.Fecha ? ` <small class="muted">· ${fmtDateTime(u.Fecha)}</small>` : ''}</li>`).join('')}</ul>`
        : '<p class="muted">Nadie todavía.</p>';
    await openModal({
        title: `${n?.Obligatoria ? 'Confirmaciones' : 'Lecturas'} · ${n?.Titulo || ''}`,
        wide: true,
        submitLabel: 'Cerrar',
        body: n?.Obligatoria
            ? `<div class="grid grid-kpi">${kpi('Padres destinatarios', d.destinatarios)}${kpi('Confirmaron', d.confirmados.length)}${kpi('Pendientes', d.pendientes.length)}</div>
               <h3>Confirmaron</h3>${lista(d.confirmados)}<h3>Pendientes</h3>${lista(d.pendientes)}`
            : `<p>${d.lecturas.length} persona(s) la marcaron como vista.</p>${lista(d.lecturas)}`,
        onSubmit: async () => true,
    });
}

/** Detalle de entregas de una evaluación: quién entregó, marcas y "Recibido". */
function filasEntregas(it) {
    const m = canManage(it.CursoID);
    return alumnosDe(it.CursoID).map((a) => {
        const ent = idx.entregas.get(`${a.ID}|${it.ItemID}`);
        const estado = entregada(ent) ? '<span class="badge badge-success">Entregada</span>'
            : (it.FechaEntrega && it.FechaEntrega < today() ? '<span class="badge badge-danger">Sin entregar</span>' : '<span class="badge badge-warn">Pendiente</span>');
        return `<tr><td>${person(a)}</td><td>${estado}</td>
            <td>${ent?.TieneArchivo ? entregaBtn(ent, `${ico('paperclip', 'icon-sm')} Archivo`, 'btn btn-link') : '—'}</td>
            <td>${ent?.HechaEn ? `<small>${fmtDateTime(ent.HechaEn)}</small>` : '—'}</td>
            <td>${ent?.RevisadaEn ? `<small>${esc(ent.RevisadaPor)}<br>${fmtDateTime(ent.RevisadaEn)}</small>` : '—'}</td>
            <td class="center">${m ? `<input type="checkbox" data-change="recibido" data-item="${esc(it.ItemID)}" data-est="${esc(a.ID)}" ${ent?.RecibidoEn ? 'checked' : ''} aria-label="Recibido de ${esc(a.Nombre)}">` : (ent?.RecibidoEn ? ico('check') : '—')}</td>
            <td>${puntualidadCelda(it, ent, a, m)}</td>
            <td class="center">${gradePill(notaEfectiva(it, ent))}</td></tr>`;
    }).join('');
}

function puntualidadCelda(it, ent, a, m) {
    const pu = puntualidad(it, ent);
    if (!pu.entregado) return '<span class="muted">—</span>';
    if (!pu.tarde) return '<span class="badge badge-success">A tiempo</span>';
    const boton = m ? `<button class="btn btn-link" data-action="excepcion" data-item="${esc(it.ItemID)}" data-est="${esc(a.ID)}" data-quitar="${pu.excepcion ? '1' : ''}">${pu.excepcion ? 'Retirar excepción' : 'Excepción'}</button>` : '';
    return `${puntualidadBadge(it, ent)}${boton}`;
}

function tasaTexto(it) {
    const t = tasaEntrega(it);
    return `<strong>${t.n}/${t.total}</strong> entregadas${t.pct != null ? ` (${fmtNota(t.pct)}%)` : ''}${it.FechaEntrega ? ` · fecha de entrega ${fmtDate(it.FechaEntrega)}` : ''}`;
}

async function verEntregas(itemId) {
    const it = idx.items.get(itemId);
    if (!it) return;
    await openModal({
        title: `Entregas · ${it.Titulo}`,
        wide: true,
        submitLabel: 'Listo',
        body: `<p data-tasa>${tasaTexto(it)}</p>
            <p class="muted" style="font-size:13px">Cuenta como entregada si el alumno subió el archivo, si marcaste "Recibido" (entregas en papel o exámenes) o si ya tiene nota.</p>
            <div class="table-wrap"><table class="table"><thead><tr><th>Estudiante</th><th>Estado</th><th>Archivo</th><th>Hecha (alumno)</th><th>Revisada (padre)</th><th class="center">Recibido</th><th>Puntualidad</th><th class="center">Nota final</th></tr></thead>
            <tbody data-filas data-item="${esc(it.ItemID)}">${filasEntregas(it)}</tbody></table></div>`,
        onSubmit: async () => true,
    });
    render();
}

function anotacionesSection(estId) {
    const lista = state.db.anotaciones.filter(a => a.EstudianteID === estId);
    const puedeAnotar = esStaff() && (isAdmin() || cursosDe(estId).some(c => c.TutorID === state.me.ID));
    if (!lista.length && !puedeAnotar) return '';
    return `<section class="card">
        <div class="card-head"><h2 class="meta-line">${ico('notebook')} Anotaciones</h2>
            ${puedeAnotar ? `<button class="btn btn-primary btn-sm" data-action="new-anotacion" data-est="${esc(estId)}">${ico('plus')} Nueva anotación</button>` : ''}</div>
        ${lista.length ? `<ul class="timeline">${lista.map(anotacionItem).join('')}</ul>` : emptyState('Sin anotaciones.', 'notebook')}
    </section>`;
}

function anotacionItem(a) {
    const confs = Object.values(a.Confirmaciones || {});
    const mia = a.Confirmaciones?.[state.me.ID];
    return `<li>
        <div class="row-between"><div class="row"><span class="badge ${ANOTACION_BADGE[a.Tipo] || ''}">${esc(a.Tipo)}</span><strong>${esc(a.AutorNombre)}</strong></div>
            <small class="muted">${fmtDateTime(a.Fecha)}</small></div>
        <p class="news-text">${esc(a.Texto)}</p>
        <div class="row-between">
            <small class="muted">${confs.length ? 'Enterado: ' + confs.map(c => `${esc(c.Nombre)} (${fmtDateTime(c.Fecha)})`).join(', ') : 'Los padres aún no confirman'}</small>
            <div class="row">
                ${esPadre() && !mia ? `<button class="btn btn-primary btn-sm" data-action="confirmar-anotacion" data-id="${esc(a.AnotacionID)}">${ico('check-check')} Enterado</button>` : ''}
                ${isAdmin() || a.AutorID === state.me.ID ? `<button class="icon-btn danger" data-action="delete-anotacion" data-id="${esc(a.AnotacionID)}" title="Eliminar" aria-label="Eliminar anotación">${ico('trash')}</button>` : ''}
            </div>
        </div>
    </li>`;
}

function viewPerfil() {
    const me = state.me;
    return `
    <div class="profile-grid">
        <section class="card profile-photo">
            ${avatar(me, 'xl')}
            <div><strong>${esc(me.Nombre)}</strong><div>${roleBadge(me.Rol)}</div></div>
            <button class="btn btn-ghost btn-sm" data-action="upload-photo">${ico('camera')} Cambiar foto</button>
            <small class="muted">JPG, PNG o WebP · se recorta a ${CONFIG.FOTO_PX}×${CONFIG.FOTO_PX} px</small>
        </section>
        <form class="card" data-submit="profile">
            <div class="card-head"><h2>Información personal</h2></div>
            <div class="card-body form-grid">
                <label class="field span-all"><span>Nombre completo *</span><input name="Nombre" required maxlength="120" value="${esc(me.Nombre)}"></label>
                <label class="field"><span>Fecha de nacimiento</span><input type="date" name="FechaNacimiento" value="${esc(me.FechaNacimiento)}" max="${today()}"></label>
                <label class="field"><span>Grado / Nivel académico</span><input name="Grado" maxlength="80" value="${esc(me.Grado)}"></label>
                <label class="field span-all"><span>Correo</span><input value="${esc(me.Email)}" disabled></label>
                <div class="span-all row" style="justify-content:flex-end"><button type="submit" class="btn btn-primary">Guardar perfil</button></div>
            </div>
        </form>
    </div>`;
}

// ==========================================================================
// 9c. GRADOS: alumnos, cursos, resultados y asistencia por grado
// ==========================================================================

const gradoDe = (u) => String(u?.Grado || '').trim();
/** Cursos que cuentan en Grados: el admin todos; el maestro solo los suyos. */
const cursosDeGrados = () => (isAdmin() ? cursosOrdenados() : cursosGestionables());

/** Grados ingresados en el perfil de los alumnos visibles (el maestro: alumnos de sus cursos). */
function gradosVisibles() {
    const alumnos = isAdmin() ? students()
        : [...new Map(cursosGestionables().flatMap(c => alumnosDe(c.CursoID)).map(a => [a.ID, a])).values()];
    const map = new Map();
    alumnos.forEach(a => {
        const g = gradoDe(a);
        if (!g) return;
        if (!map.has(g)) map.set(g, []);
        map.get(g).push(a);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es', { numeric: true }))
        .map(([nombre, lista]) => ({ nombre, alumnos: lista.sort(byName) }));
}

function resumenGrado(g) {
    const ids = new Set(g.alumnos.map(a => a.ID));
    const visibles = cursosDeGrados();
    const visiblesIds = new Set(visibles.map(c => c.CursoID));
    const cursos = visibles.map(c => {
        const delGrado = alumnosDe(c.CursoID).filter(a => ids.has(a.ID));
        if (!delGrado.length) return null;
        const finales = delGrado.map(a => Grades.forStudent(a.ID, c.CursoID).final);
        const est = finales.map(f => estadoFinal(f, c));
        return {
            c, n: delGrado.length, prom: mean(finales),
            aprobados: est.filter(e => e === 'aprobado').length,
            reprobados: est.filter(e => e === 'reprobado').length,
            sinNotas: est.filter(e => e === 'sin-notas').length,
        };
    }).filter(Boolean);
    const alumnos = g.alumnos.map(a => {
        const cs = cursosDe(a.ID).filter(c => visiblesIds.has(c.CursoID));
        const finales = cs.map(c => ({ c, f: Grades.forStudent(a.ID, c.CursoID).final }));
        const est = finales.map(x => estadoFinal(x.f, x.c));
        return {
            a, cursos: cs.length, prom: mean(finales.map(x => x.f)), asist: attendanceStats(a.ID),
            aprobados: est.filter(e => e === 'aprobado').length, reprobados: est.filter(e => e === 'reprobado').length,
        };
    });
    return {
        cursos, alumnos,
        prom: mean(alumnos.map(x => x.prom)),
        asist: mean(alumnos.map(x => x.asist.pct)),
        conReprobados: alumnos.filter(x => x.reprobados).length,
    };
}

const pctTexto = (v) => (v == null ? '—' : `${fmtNota(v)}%`);

function viewGrados() {
    const grados = gradosVisibles();
    if (!grados.length) {
        return `<section class="card">${emptyState(isAdmin()
            ? 'Todavía no hay grados. El grado se toma del perfil de cada alumno (campo "Grado / Nivel académico").'
            : 'Tus estudiantes aún no tienen grado asignado en su perfil.', 'school')}</section>`;
    }
    return `<p class="muted">${grados.length} grado(s) con alumnos${isAdmin() ? '' : ' en tus cursos'}. El grado se toma del perfil de cada alumno.</p>
    <div class="grid grid-cards">${grados.map(g => {
        const r = resumenGrado(g);
        return `<a class="card grade-card" href="#/grado/${encodeURIComponent(g.nombre)}">
            <div class="row-between"><h3 class="meta-line">${ico('school')} ${esc(g.nombre)}</h3>${ico('chevron-right', 'icon-sm')}</div>
            <div class="course-stats"><span>${g.alumnos.length} alumno(s)</span><span>${r.cursos.length} curso(s)</span><span>Asistencia ${pctTexto(r.asist)}</span></div>
            <div class="row"><span class="muted">Promedio</span>${gradePill(r.prom)}
                ${r.conReprobados ? `<span class="badge badge-danger">${r.conReprobados} con cursos reprobados</span>` : '<span class="badge badge-success">Sin reprobados</span>'}</div>
        </a>`;
    }).join('')}</div>`;
}

function viewGrado(nombre) {
    const g = gradosVisibles().find(x => x.nombre === nombre);
    const volver = `<div><a class="btn btn-link" href="#/grados">${ico('arrow-left')} Grados</a></div>`;
    if (!g) return `${volver}<section class="card">${emptyState('Este grado ya no tiene alumnos visibles.', 'school')}</section>`;
    const r = resumenGrado(g);
    return `${volver}
    <div class="grid grid-kpi">
        ${kpi('Alumnos', g.alumnos.length, '', 'graduation-cap')}
        ${kpi('Promedio del grado', fmtNota(r.prom), '', 'award')}
        ${kpi('Asistencia', pctTexto(r.asist), '', 'calendar-check')}
        ${kpi('Con cursos reprobados', r.conReprobados, `de ${g.alumnos.length} alumno(s)`, 'alert-triangle')}
    </div>
    <section class="card"><div class="card-head"><h2>Cursos del grado</h2><small class="muted">Resultados solo de los alumnos de ${esc(g.nombre)}</small></div>
        ${r.cursos.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Curso</th><th>Profesor</th><th class="num">Alumnos</th>
            <th class="center">Promedio</th><th class="center">Aprobados</th><th class="center">Reprobados</th><th class="center">Sin notas</th><th></th></tr></thead>
        <tbody>${r.cursos.map(x => `<tr><td><strong>${esc(x.c.NombreCurso)}</strong><br><small class="muted">Aprueba con ${fmtNota(aprobDe(x.c.CursoID))}</small></td>
            <td>${esc(tutorDe(x.c))}</td><td class="num">${x.n}</td>
            <td class="center"><span class="grade-pill ${gradeClass(x.prom, aprobDe(x.c.CursoID))}">${fmtNota(x.prom)}</span></td>
            <td class="center"><span class="badge badge-success">${x.aprobados}</span></td>
            <td class="center"><span class="badge ${x.reprobados ? 'badge-danger' : ''}">${x.reprobados}</span></td>
            <td class="center"><span class="badge">${x.sinNotas}</span></td>
            <td class="actions">${canManage(x.c.CursoID) ? `<a class="btn btn-ghost btn-sm" href="#/curso/${encodeURIComponent(x.c.CursoID)}">Abrir curso</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : emptyState('Los alumnos de este grado no están inscritos en cursos.', 'book-open')}
    </section>
    <section class="card"><div class="card-head"><h2>Alumnos del grado</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Alumno</th><th class="center">Promedio</th><th class="center">Cursos aprobados</th>
            <th class="center">Cursos reprobados</th><th class="center">Asistencia</th><th class="num">Ausencias</th><th></th></tr></thead>
        <tbody>${r.alumnos.map(x => `<tr><td>${person(x.a, `${x.cursos} curso(s)`)}</td>
            <td class="center">${gradePill(x.prom)}</td>
            <td class="center"><span class="badge badge-success">${x.aprobados}</span></td>
            <td class="center"><span class="badge ${x.reprobados ? 'badge-danger' : ''}">${x.reprobados}</span></td>
            <td class="center">${pctTexto(x.asist.pct)}</td><td class="num">${x.asist.Ausente}</td>
            <td class="actions"><a class="btn btn-ghost btn-sm" href="#/estudiante/${encodeURIComponent(x.a.ID)}">Ver perfil</a></td></tr>`).join('')}</tbody></table></div>
    </section>`;
}

// ==========================================================================
// 9d. AGENDA: calendario de eventos (mes, semana, día y lista)
// ==========================================================================

const AG_MODOS = [['mes', 'Mes'], ['semana', 'Semana'], ['dia', 'Día'], ['lista', 'Lista']];
const AG_COLORES = [['azul', 'Azul'], ['verde', 'Verde'], ['ambar', 'Ámbar'], ['rojo', 'Rojo'], ['morado', 'Morado'], ['gris', 'Gris']];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const HORA_PX = 48;
const LISTA_DIAS = 30;

const aFecha = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const isoDe = (d) => d.toLocaleDateString('en-CA');
const sumarDias = (iso, n) => { const d = aFecha(iso); d.setDate(d.getDate() + n); return isoDe(d); };
const aMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + (b || 0); };
const inicioSemana = (iso) => sumarDias(iso, -aFecha(iso).getDay());
const fechaLarga = (iso) => aFecha(iso).toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function agenda() {
    return state.agenda ||= { modo: matchMedia('(max-width: 600px)').matches ? 'lista' : 'mes', fecha: today(), entregas: true };
}

/** Evaluaciones con fecha de entrega que le corresponden a quien mira. */
function itemsAgenda() {
    const items = state.db.items.filter(i => i.FechaEntrega);
    return esStaff() && !isAdmin() ? items.filter(i => canManage(i.CursoID)) : items;
}

/** Ocurrencias entre dos fechas (incluidas): eventos (uno por día) y fechas de entrega. */
function ocurrencias(desde, hasta) {
    const out = [];
    for (const e of state.db.eventos) {
        const fin = e.FechaFin || e.Fecha;
        if (fin < desde || e.Fecha > hasta) continue;
        const varios = fin !== e.Fecha;
        for (let d = e.Fecha > desde ? e.Fecha : desde; d <= fin && d <= hasta; d = sumarDias(d, 1)) {
            out.push({ tipo: 'evento', id: e.EventoID, fecha: d, titulo: e.Tipo === 'CITA' ? `Cita: ${e.Titulo}` : e.Titulo, color: e.Color || 'azul',
                todoElDia: !!e.TodoElDia || varios, ini: e.HoraInicio, fin: e.HoraFin, lugar: e.Lugar });
        }
    }
    if (agenda().entregas) {
        for (const i of itemsAgenda()) {
            if (i.FechaEntrega < desde || i.FechaEntrega > hasta) continue;
            out.push({ tipo: 'entrega', id: i.ItemID, fecha: i.FechaEntrega, titulo: `Entrega: ${i.Titulo}`, color: 'entrega',
                todoElDia: true, lugar: idx.cursos.get(i.CursoID)?.NombreCurso || '' });
        }
    }
    return out.sort((a, b) => (b.todoElDia - a.todoElDia) || String(a.ini || '').localeCompare(String(b.ini || '')) || a.titulo.localeCompare(b.titulo, 'es'));
}

const porFecha = (ocs) => ocs.reduce((m, o) => (m.get(o.fecha)?.push(o) || m.set(o.fecha, [o]), m), new Map());

function evChip(o) {
    const hora = o.todoElDia ? '' : `<span class="ev-time">${esc(o.ini)}</span>`;
    return `<button type="button" class="ev-chip ev-${esc(o.color)}${o.todoElDia ? ' is-allday' : ''}" data-action="ver-evento" data-tipo="${o.tipo}" data-id="${esc(o.id)}"
        title="${esc(o.titulo)}${o.lugar ? ' · ' + esc(o.lugar) : ''}">${hora}<span class="ev-title">${esc(o.titulo)}</span></button>`;
}

function agTitulo(ag) {
    if (ag.modo === 'mes') return aFecha(ag.fecha).toLocaleDateString('es-GT', { month: 'long', year: 'numeric' });
    if (ag.modo === 'dia') return fechaLarga(ag.fecha);
    if (ag.modo === 'lista') return `Próximos ${LISTA_DIAS} días desde ${fmtDate(ag.fecha)}`;
    const ini = inicioSemana(ag.fecha);
    return `${fmtDate(ini)} – ${fmtDate(sumarDias(ini, 6))}`;
}

function viewAgenda() {
    const ag = agenda();
    const cuerpo = { mes: calMes, semana: calSemana, dia: calSemana, lista: calLista }[ag.modo](ag);
    return `<section class="card cal">
        <div class="cal-toolbar">
            <div class="row cal-nav">
                <button type="button" class="btn btn-ghost btn-sm" data-action="agenda-nav" data-dir="0">Hoy</button>
                <button type="button" class="icon-btn" data-action="agenda-nav" data-dir="-1" aria-label="Anterior">${ico('chevron-left')}</button>
                <button type="button" class="icon-btn" data-action="agenda-nav" data-dir="1" aria-label="Siguiente">${ico('chevron-right')}</button>
                <h2 class="cal-title">${esc(agTitulo(ag).replace(/^./, (x) => x.toUpperCase()))}</h2>
            </div>
            <div class="row">
                <div class="segmented" role="radiogroup" aria-label="Vista del calendario">${AG_MODOS.map(([v, l]) =>
                    `<label><input type="radio" name="agmodo" value="${v}" data-change="agenda-modo" ${ag.modo === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
                ${esStaff() ? `<button type="button" class="btn btn-primary btn-sm" data-action="new-evento">${ico('plus')} Evento</button>` : ''}
            </div>
        </div>
        <div class="cal-legend">
            <label class="check-inline"><input type="checkbox" data-change="agenda-entregas" ${ag.entregas ? 'checked' : ''}><span>Mostrar fechas de entrega de tareas y exámenes</span></label>
            <span class="ev-chip ev-entrega is-allday" aria-hidden="true"><span class="ev-title">Entrega</span></span>
        </div>
        ${cuerpo}
    </section>`;
}

function calMes(ag) {
    const f = aFecha(ag.fecha);
    const primero = isoDe(new Date(f.getFullYear(), f.getMonth(), 1));
    const diasMes = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
    const offset = aFecha(primero).getDay();
    const semanas = Math.ceil((offset + diasMes) / 7);
    const desde = sumarDias(primero, -offset), hasta = sumarDias(desde, semanas * 7 - 1);
    const mapa = porFecha(ocurrencias(desde, hasta));
    const hoy = today(), mes = f.getMonth();
    const celdas = [];
    for (let k = 0; k < semanas * 7; k++) {
        const d = sumarDias(desde, k);
        const lista = mapa.get(d) || [];
        const extra = lista.length - 3;
        celdas.push(`<div class="cal-cell${aFecha(d).getMonth() !== mes ? ' is-out' : ''}${d === hoy ? ' is-today' : ''}"
            ${esStaff() ? `data-action="new-evento" data-fecha="${d}" title="Crear evento el ${fmtDate(d)}"` : ''}>
            <button type="button" class="cal-daynum" data-action="agenda-ir" data-fecha="${d}" aria-label="Ver el ${fmtDate(d)}">${aFecha(d).getDate()}</button>
            <div class="cal-chips">${lista.slice(0, extra > 0 ? 2 : 3).map(evChip).join('')}
                ${extra > 0 ? `<button type="button" class="cal-more" data-action="agenda-ir" data-fecha="${d}">+${extra + 1} más</button>` : ''}</div>
        </div>`);
    }
    return `<div class="cal-scroll"><div class="cal-month" style="--semanas:${semanas}">
        ${DIAS_CORTOS.map(d => `<div class="cal-dow">${d}</div>`).join('')}${celdas.join('')}
    </div></div>`;
}

/** Reparte en columnas los eventos que se cruzan (como en los calendarios de escritorio). */
function columnas(evs) {
    evs.sort((a, b) => a.s - b.s || b.e - a.e);
    const out = [];
    let grupo = [], finGrupo = -1;
    const cerrar = () => {
        const cols = [];
        grupo.forEach(ev => {
            let k = cols.findIndex(f => f <= ev.s);
            if (k < 0) { k = cols.length; cols.push(0); }
            cols[k] = ev.e; ev.col = k;
        });
        grupo.forEach(ev => { ev.ncol = cols.length; });
        out.push(...grupo); grupo = [];
    };
    for (const ev of evs) {
        if (grupo.length && ev.s >= finGrupo) cerrar();
        grupo.push(ev); finGrupo = Math.max(finGrupo, ev.e);
    }
    if (grupo.length) cerrar();
    return out;
}

function calSemana(ag) {
    const dias = ag.modo === 'dia' ? [ag.fecha] : Array.from({ length: 7 }, (_, k) => sumarDias(inicioSemana(ag.fecha), k));
    const mapa = porFecha(ocurrencias(dias[0], dias[dias.length - 1]));
    const hoy = today();
    const ahora = new Date();
    const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();
    const horas = Array.from({ length: 24 }, (_, h) => h);
    const hh = (h) => `${String(h).padStart(2, '0')}:00`;
    const cols = dias.map(d => {
        const lista = mapa.get(d) || [];
        const timed = columnas(lista.filter(o => !o.todoElDia).map(o => {
            const s = aMin(o.ini);
            const e = Math.min(1440, o.fin && aMin(o.fin) > s ? aMin(o.fin) : s + 60);
            return { o, s, e };
        }));
        const evs = timed.map(({ o, s, e, col, ncol }) => `<button type="button" class="ev-block ev-${esc(o.color)}" data-action="ver-evento" data-tipo="${o.tipo}" data-id="${esc(o.id)}"
            style="top:${s / 60 * HORA_PX}px;height:${Math.max(22, (e - s) / 60 * HORA_PX - 2)}px;left:calc(${col / ncol * 100}% + 2px);width:calc(${100 / ncol}% - 4px)">
            <strong>${esc(o.titulo)}</strong><small>${esc(o.ini)}${o.fin ? '–' + esc(o.fin) : ''}${o.lugar ? ' · ' + esc(o.lugar) : ''}</small></button>`).join('');
        const slots = horas.map(h => esStaff()
            ? `<div class="cal-slot" data-action="new-evento" data-fecha="${d}" data-hora="${hh(h)}" title="Crear evento ${fmtDate(d)} ${hh(h)}"></div>`
            : '<div class="cal-slot"></div>').join('');
        const linea = d === hoy ? `<div class="cal-now" style="top:${ahoraMin / 60 * HORA_PX}px"></div>` : '';
        return `<div class="cal-col${d === hoy ? ' is-today' : ''}">${slots}${evs}${linea}</div>`;
    });
    return `<div class="cal-scroll"><div class="cal-week" style="--dias:${dias.length}">
        <div class="cal-week-head"><div class="cal-gutter"></div>${dias.map(d => `<button type="button" class="cal-wday${d === hoy ? ' is-today' : ''}" data-action="agenda-ir" data-fecha="${d}">
            <span>${DIAS_CORTOS[aFecha(d).getDay()]}</span><strong>${aFecha(d).getDate()}</strong></button>`).join('')}</div>
        <div class="cal-allday"><div class="cal-gutter"><small>Todo el día</small></div>${dias.map(d =>
            `<div class="cal-allday-cell">${(mapa.get(d) || []).filter(o => o.todoElDia).map(evChip).join('')}</div>`).join('')}</div>
        <div class="cal-grid-scroll" data-cal-scroll>
            <div class="cal-grid" style="--hora:${HORA_PX}px">
                <div class="cal-hours">${horas.map(h => `<div class="cal-hour"><span>${h ? hh(h) : ''}</span></div>`).join('')}</div>
                ${cols.join('')}
            </div>
        </div>
    </div></div>`;
}

function calLista(ag) {
    const hasta = sumarDias(ag.fecha, LISTA_DIAS - 1);
    const mapa = porFecha(ocurrencias(ag.fecha, hasta));
    if (!mapa.size) return emptyState(`No hay eventos entre el ${fmtDate(ag.fecha)} y el ${fmtDate(hasta)}.`, 'calendar');
    const hoy = today();
    return `<div class="cal-list">${[...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, lista]) => `
        <div class="cal-list-day${d === hoy ? ' is-today' : ''}">
            <button type="button" class="cal-list-date" data-action="agenda-ir" data-fecha="${d}"><strong>${aFecha(d).getDate()}</strong>
                <span>${DIAS_CORTOS[aFecha(d).getDay()]} · ${aFecha(d).toLocaleDateString('es-GT', { month: 'short' })}</span></button>
            <div class="cal-list-items">${lista.map(o => `<button type="button" class="cal-list-item" data-action="ver-evento" data-tipo="${o.tipo}" data-id="${esc(o.id)}">
                <span class="ev-dot ev-${esc(o.color)}"></span><span class="cal-list-time">${o.todoElDia ? 'Todo el día' : `${esc(o.ini)}${o.fin ? '–' + esc(o.fin) : ''}`}</span>
                <span><strong>${esc(o.titulo)}</strong>${o.lugar ? `<small class="muted"> · ${esc(o.lugar)}</small>` : ''}</span></button>`).join('')}</div>
        </div>`).join('')}</div>`;
}

function agendaAfter() {
    const sc = $('[data-cal-scroll]');
    if (sc) sc.scrollTop = 7 * HORA_PX;
}

function agendaNav(dir) {
    const ag = agenda();
    if (!dir) { ag.fecha = today(); return; }
    if (ag.modo === 'mes') {
        const f = aFecha(ag.fecha);
        ag.fecha = isoDe(new Date(f.getFullYear(), f.getMonth() + dir, 1));
    } else {
        ag.fecha = sumarDias(ag.fecha, dir * { semana: 7, dia: 1, lista: LISTA_DIAS }[ag.modo]);
    }
}

function cuandoEvento(e) {
    const horas = e.TodoElDia ? 'Todo el día' : `${e.HoraInicio}${e.HoraFin ? '–' + e.HoraFin : ''}`;
    return e.FechaFin && e.FechaFin !== e.Fecha
        ? `${fmtDate(e.Fecha)} – ${fmtDate(e.FechaFin)} · ${horas}`
        : `${fechaLarga(e.Fecha)} · ${horas}`;
}

const RESPUESTA_CITA = { ASISTIRE: '<span class="badge badge-success">Asistirá</span>', NO_PUEDO: '<span class="badge badge-danger">No puede</span>' };
const MODALIDAD_TXT = { PRESENCIAL: 'En persona', LLAMADA: 'Por llamada' };

/** Padres invitados a una cita (los que la app conoce). */
function padresDeCita(e) {
    const ids = new Set(e.EstudianteIDs || []);
    return state.db.users.filter(u => u.Rol === ROLES.PADRE && String(u.HijosIDs || '').split(',').some(h => ids.has(h)));
}

const citasPendientes = () => state.db.eventos.filter(e => e.Tipo === 'CITA' && e.Fecha >= today() && !e.Respuestas?.[state.me.ID]);

async function verEvento(tipo, id) {
    if (tipo === 'entrega') {
        const it = idx.items.get(id);
        if (!it) return;
        const c = idx.cursos.get(it.CursoID);
        const gestiona = canManage(it.CursoID) && esStaff();
        const r = await openModal({
            title: it.Titulo,
            submitLabel: gestiona ? 'Ver entregas' : 'Cerrar',
            body: `<p class="row">${tipoBadge(it.Tipo)}<strong>${esc(c?.NombreCurso || '')}</strong></p>
                <p class="meta-line">${ico('clock', 'icon-sm')} Fecha de entrega: ${esc(fechaLarga(it.FechaEntrega))}</p>
                <p class="muted">Ponderación ${fmtPeso(it.Ponderacion)}${it.PenalizacionTipo && it.PenalizacionTipo !== 'NINGUNA' ? ` · ${esc(reglaTexto(it))}` : ''}</p>
                ${it.Descripcion ? `<p class="news-text">${esc(it.Descripcion)}</p>` : ''}${adjuntosHtml(it, false)}`,
            onSubmit: async () => (gestiona ? 'entregas' : true),
        });
        if (r === 'entregas') verEntregas(id);
        return;
    }
    const e = state.db.eventos.find(x => x.EventoID === id);
    if (!e) return;
    const gestiona = isAdmin() || e.AutorID === state.me.ID;
    const cita = e.Tipo === 'CITA';
    let extra = '';
    if (cita) {
        const donde = e.Modalidad === 'LLAMADA'
            ? `<p class="meta-line">${ico('message-square', 'icon-sm')} ${MODALIDAD_TXT.LLAMADA}: ${esc(e.Contacto)}</p>`
            : `<p class="meta-line">${ico('map-pin', 'icon-sm')} ${MODALIDAD_TXT.PRESENCIAL}${e.Lugar ? ` · ${esc(e.Lugar)}` : ''}</p>`;
        if (esPadre()) {
            const mia = e.Respuestas?.[state.me.ID];
            extra = `${donde}<div class="cita-respuesta">
                ${mia ? `<p>Tu respuesta: ${RESPUESTA_CITA[mia.Respuesta]}${mia.Comentario ? ` · <em>${esc(mia.Comentario)}</em>` : ''}</p>` : '<p><strong>Confirma si podrás asistir.</strong></p>'}
                <div class="row"><button type="button" class="btn btn-primary btn-sm" data-action="responder-cita" data-id="${esc(e.EventoID)}" data-r="ASISTIRE">${ico('check')} Asistiré</button>
                <button type="button" class="btn btn-ghost btn-sm" data-action="responder-cita" data-id="${esc(e.EventoID)}" data-r="NO_PUEDO">No puedo</button></div></div>`;
        } else {
            const padres = padresDeCita(e);
            extra = `${donde}<h3 style="margin:14px 0 6px;font-size:15px">Respuestas de los padres</h3>
                ${padres.length ? `<ul class="item-list">${padres.map(pd => {
                    const r = e.Respuestas?.[pd.ID];
                    return `<li class="item-row">${avatar(pd, 'sm')}<div class="item-main"><strong>${esc(pd.Nombre)}</strong>${r?.Comentario ? `<div class="item-meta"><span>${esc(r.Comentario)}</span></div>` : ''}</div>
                        <div class="item-side">${r ? `${RESPUESTA_CITA[r.Respuesta]}<small class="muted">${fmtDateTime(r.Fecha)}</small>` : '<span class="badge">Sin responder</span>'}</div></li>`;
                }).join('')}</ul>` : '<p class="muted">Sin padres registrados.</p>'}`;
        }
    }
    const r = await openModal({
        title: cita ? `Cita: ${e.Titulo}` : e.Titulo,
        wide: cita,
        submitLabel: gestiona ? 'Editar' : 'Cerrar',
        body: `<p class="meta-line"><span class="ev-dot ev-${esc(e.Color || 'azul')}"></span>${ico('clock', 'icon-sm')} ${esc(cuandoEvento(e))}</p>
            ${!cita && e.Lugar ? `<p class="meta-line">${ico('map-pin', 'icon-sm')} ${esc(e.Lugar)}</p>` : ''}
            ${e.Descripcion ? `<p class="news-text">${esc(e.Descripcion)}</p>` : ''}
            ${extra}
            <p class="muted" style="font-size:13px">Para: ${esc(alcanceTexto(e))} · Creado por ${esc(e.AutorNombre)}</p>
            ${gestiona ? `<button type="button" class="btn btn-ghost btn-sm" data-action="delete-evento" data-id="${esc(e.EventoID)}">${ico('trash', 'icon-sm')} Eliminar ${cita ? 'cita' : 'evento'}</button>` : ''}`,
        onSubmit: async () => (gestiona ? 'editar' : true),
    });
    if (r === 'editar') openEventoModal(e);
}

/** Alumnos que quien crea el evento puede elegir (el maestro: los de sus cursos). */
function alumnosElegibles() {
    if (isAdmin()) return students();
    return [...new Map(cursosGestionables().flatMap(c => alumnosDe(c.CursoID)).map(a => [a.ID, a])).values()].sort(byName);
}

async function openEventoModal(e = null, { fecha = '', hora = '', tipo = '', estIds = [] } = {}) {
    const cursos = cursosGestionables();
    const t = e?.Tipo || tipo || 'EVENTO';
    const alcance = e?.Alcance || (estIds.length ? 'ALUMNOS' : 'COLEGIO');
    const sel = new Set(e?.CursoIDs || []);
    const selA = new Set(e?.EstudianteIDs || estIds);
    const todo = t === 'CITA' ? false : (e ? !!e.TodoElDia : !hora);
    const f = e?.Fecha || fecha || agenda().fecha || today();
    const ini = e?.HoraInicio || hora || (t === 'CITA' ? '15:00' : '08:00');
    const finDef = e?.HoraFin || `${String(Math.min(23, aMin(ini) / 60 + 1 | 0)).padStart(2, '0')}:${ini.slice(3, 5) || '00'}`;
    const color = e?.Color || (t === 'CITA' ? 'morado' : 'azul');
    const modalidad = e?.Modalidad || 'PRESENCIAL';
    const alumnos = alumnosElegibles();
    const conPadres = new Set(state.db.users.filter(u => u.Rol === ROLES.PADRE).flatMap(u => String(u.HijosIDs || '').split(',')));
    const esCita = t === 'CITA';
    await openModal({
        title: e ? (esCita ? 'Editar cita' : 'Editar evento') : (esCita ? 'Nueva cita con padres' : 'Nuevo evento'),
        wide: true,
        submitLabel: e ? 'Guardar cambios' : (esCita ? 'Crear cita' : 'Crear evento'),
        body: `<div class="form-grid" data-evento-form>
            ${e ? `<input type="hidden" name="Tipo" value="${t}">` : `<fieldset class="field span-all" style="border:0;padding:0;margin:0"><span>¿Qué vas a crear?</span>
                <div class="segmented" role="radiogroup" aria-label="Tipo">
                    <label><input type="radio" name="Tipo" value="EVENTO" data-change="evento-tipo" ${!esCita ? 'checked' : ''}><span>Evento</span></label>
                    <label><input type="radio" name="Tipo" value="CITA" data-change="evento-tipo" ${esCita ? 'checked' : ''}><span>Cita con padres</span></label>
                </div></fieldset>`}
            <label class="field span-all"><span>Título *</span><input name="Titulo" required maxlength="160" value="${esc(e?.Titulo)}" placeholder="${esCita ? 'Ej.: Reunión sobre el rendimiento de Ana' : 'Ej.: Reunión de padres'}"></label>
            <label class="field"><span>Fecha *</span><input type="date" name="Fecha" required value="${esc(f)}"></label>
            <label class="field" data-solo-evento ${esCita ? 'hidden' : ''}><span>Termina (si dura varios días)</span><input type="date" name="FechaFin" value="${esc(e?.FechaFin && e.FechaFin !== e.Fecha ? e.FechaFin : '')}"></label>
            <label class="check-item span-all" data-solo-evento ${esCita ? 'hidden' : ''}><input type="checkbox" name="TodoElDia" data-change="evento-todo" ${todo ? 'checked' : ''}><span><strong>Todo el día</strong></span></label>
            <label class="field" data-horas ${todo ? 'hidden' : ''}><span>Hora de inicio *</span><input type="time" name="HoraInicio" value="${esc(ini)}"></label>
            <label class="field" data-horas ${todo ? 'hidden' : ''}><span>Hora de fin</span><input type="time" name="HoraFin" value="${esc(finDef)}"></label>
            <fieldset class="field span-all" data-solo-cita style="border:0;padding:0;margin:0" ${esCita ? '' : 'hidden'}><span>Modalidad *</span>
                <div class="segmented" role="radiogroup" aria-label="Modalidad">
                    <label><input type="radio" name="Modalidad" value="PRESENCIAL" data-change="evento-modalidad" ${modalidad === 'PRESENCIAL' ? 'checked' : ''}><span>En persona</span></label>
                    <label><input type="radio" name="Modalidad" value="LLAMADA" data-change="evento-modalidad" ${modalidad === 'LLAMADA' ? 'checked' : ''}><span>Por llamada</span></label>
                </div></fieldset>
            <label class="field span-all" data-lugar ${esCita && modalidad === 'LLAMADA' ? 'hidden' : ''}><span>Lugar</span><input name="Lugar" maxlength="160" value="${esc(e?.Lugar)}" placeholder="Ej.: Salón de actos"></label>
            <label class="field span-all" data-contacto ${esCita && modalidad === 'LLAMADA' ? '' : 'hidden'}><span>Teléfono o enlace de la llamada *</span><input name="Contacto" maxlength="300" value="${esc(e?.Contacto)}" placeholder="Ej.: 5555-1234 o el enlace de la videollamada"></label>
            <label class="field span-all"><span>Descripción</span><textarea name="Descripcion" maxlength="2000" rows="3">${esc(e?.Descripcion)}</textarea></label>
            <fieldset class="field span-all" data-solo-evento style="border:0;padding:0;margin:0" ${esCita ? 'hidden' : ''}><span>Color</span>
                <div class="ev-colors">${AG_COLORES.map(([v, l]) => `<label class="ev-color" title="${l}"><input type="radio" name="Color" value="${v}" ${color === v ? 'checked' : ''}><span class="ev-swatch ev-${v}"></span><span class="sr-only">${l}</span></label>`).join('')}</div>
            </fieldset>
            <fieldset class="field span-all" style="border:0;padding:0;margin:0"><span data-para-label>${esCita ? '¿Con los padres de qué alumno(s)? *' : '¿Para quién? *'}</span>
                <div class="segmented" role="radiogroup" aria-label="Destinatarios" data-solo-evento ${esCita ? 'hidden' : ''}>
                    <label><input type="radio" name="Alcance" value="COLEGIO" data-change="evento-alcance" ${alcance === 'COLEGIO' ? 'checked' : ''}><span>Todo el colegio</span></label>
                    <label><input type="radio" name="Alcance" value="CURSOS" data-change="evento-alcance" ${alcance === 'CURSOS' ? 'checked' : ''}><span>Cursos</span></label>
                    <label><input type="radio" name="Alcance" value="ALUMNOS" data-change="evento-alcance" ${alcance === 'ALUMNOS' ? 'checked' : ''}><span>Alumnos específicos</span></label>
                </div>
                <div data-cursos style="margin-top:10px" ${!esCita && alcance === 'CURSOS' ? '' : 'hidden'}>
                    ${picker({ name: 'CursoIDs', items: cursos.map(itemCurso), selected: [...sel], filtros: [], placeholder: 'Buscar curso…', vacio: 'No tienes cursos asignados.' })}</div>
                <div data-alumnos style="margin-top:10px" ${esCita || alcance === 'ALUMNOS' ? '' : 'hidden'}>
                    ${picker({ name: 'EstudianteIDs', items: alumnos.map(a => ({ id: a.ID, nombre: a.Nombre, sub: `${a.Grado || 'Sin grado'}${conPadres.has(a.ID) ? '' : ' · sin padres registrados'}`, grado: a.Grado || '', user: a })),
                        selected: [...selA], placeholder: 'Buscar alumno por nombre…', vacio: 'No hay alumnos en tus cursos.' })}</div>
                <small class="field-hint" data-solo-cita ${esCita ? '' : 'hidden'}>La cita la ven solo los padres de los alumnos elegidos (el alumno no). Cada padre confirma si asistirá.</small>
            </fieldset>
        </div>`,
        onSubmit: async (fd) => {
            const tipoSel = fd.get('Tipo') || 'EVENTO';
            const cita = tipoSel === 'CITA';
            const alc = cita ? 'ALUMNOS' : fd.get('Alcance');
            const cursoIds = fd.getAll('CursoIDs');
            const est = fd.getAll('EstudianteIDs');
            if (alc === 'CURSOS' && !cursoIds.length) throw new Error('Selecciona al menos un curso.');
            if (alc === 'ALUMNOS' && !est.length) throw new Error('Selecciona al menos un alumno.');
            const todoDia = !cita && fd.get('TodoElDia') === 'on';
            await withBusy(() => api('saveEvento', {
                EventoID: e?.EventoID, Tipo: tipoSel, Titulo: fd.get('Titulo'), Fecha: fd.get('Fecha'), FechaFin: cita ? '' : fd.get('FechaFin'),
                TodoElDia: todoDia, HoraInicio: todoDia ? '' : fd.get('HoraInicio'), HoraFin: todoDia ? '' : fd.get('HoraFin'),
                Lugar: fd.get('Lugar'), Descripcion: fd.get('Descripcion'), Color: cita ? 'morado' : fd.get('Color'),
                Alcance: alc, CursoIDs: alc === 'CURSOS' ? cursoIds : [], EstudianteIDs: alc === 'ALUMNOS' ? est : [],
                Modalidad: fd.get('Modalidad'), Contacto: fd.get('Contacto'),
            }));
            agenda().fecha = fd.get('Fecha');
            toast(e ? 'Guardado.' : (cita ? 'Cita creada. Los padres la verán en su agenda.' : 'Evento creado.'), 'success');
            await refresh();
        },
    });
}

// --------------------------------------------------------------------------
// Buscador para elegir personas (u opciones) en listas largas.
// - Busca por nombre mientras escribes (sin importar tildes ni mayúsculas).
// - Filtra por grado y/o tipo de persona.
// - Muestra pocos resultados a la vez (los elegidos siempre arriba) y chips de lo
//   seleccionado para quitarlo con un clic.
// Los inputs siguen dentro del formulario (FormData los lee aunque estén ocultos).
// --------------------------------------------------------------------------

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const PICKER_MAX = 30;

/** items: [{ id, nombre, sub, grado, tipo, user }] */
function picker({ name, items, selected = [], multiple = true, filtros = ['grado'], placeholder = 'Buscar por nombre…', vacio = 'No hay opciones disponibles.', inputAttrs = () => '', required = false }) {
    if (!items.length) return `<p class="muted">${esc(vacio)}</p>`;
    const sel = new Set(selected);
    const orden = [...items].sort((a, b) => (sel.has(b.id) - sel.has(a.id)) || a.nombre.localeCompare(b.nombre, 'es'));
    const grados = [...new Set(items.map(i => i.grado).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    const tipos = [...new Set(items.map(i => i.tipo).filter(Boolean))];
    let visibles = 0;
    const filas = orden.map(it => {
        const marcado = sel.has(it.id);
        const ver = marcado || visibles < PICKER_MAX;
        if (ver && !marcado) visibles++;
        return `<li data-pk data-n="${esc(norm(`${it.nombre} ${it.sub || ''}`))}" data-grado="${esc(it.grado || '')}" data-tipo="${esc(it.tipo || '')}" ${ver ? '' : 'hidden'}>
            <label class="picker-item"><input type="${multiple ? 'checkbox' : 'radio'}" name="${esc(name)}" value="${esc(it.id)}" ${marcado ? 'checked' : ''} ${required && !multiple ? 'required' : ''} ${inputAttrs(it)}>
            ${it.user ? avatar(it.user, 'sm') : ''}<span><strong>${esc(it.nombre)}</strong>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></label></li>`;
    }).join('');
    const total = items.length;
    return `<div class="picker" data-picker data-multiple="${multiple ? 1 : 0}">
        ${total > 6 ? `<div class="picker-tools">
            <label class="picker-search">${ico('search', 'icon-sm')}<input type="search" placeholder="${esc(placeholder)}" data-input="picker" aria-label="${esc(placeholder)}" autocomplete="off"></label>
            ${filtros.includes('tipo') && tipos.length > 1 ? `<select data-picker-filtro="tipo" aria-label="Filtrar por tipo"><option value="">Todos</option>${tipos.map(t => `<option>${esc(t)}</option>`).join('')}</select>` : ''}
            ${filtros.includes('grado') && grados.length > 1 ? `<select data-picker-filtro="grado" aria-label="Filtrar por grado"><option value="">Todos los grados</option>${grados.map(g => `<option>${esc(g)}</option>`).join('')}</select>` : ''}
        </div>` : ''}
        ${multiple ? `<div class="picker-sel" data-picker-sel>${chipsPicker(orden.filter(i => sel.has(i.id)))}</div>` : ''}
        <ul class="picker-list">${filas}</ul>
        <div class="picker-foot"><small data-picker-foot>${pieTexto(Math.min(total, visibles + sel.size), total)}</small>
            ${multiple && total > 6 ? '<button type="button" class="btn btn-link" data-action="picker-visibles" hidden>Seleccionar los mostrados</button>' : ''}</div>
    </div>`;
}

const chipsPicker = (lista) => lista.map(i => `<span class="pk-chip">${esc(i.nombre)}<button type="button" data-action="picker-quitar" data-id="${esc(i.id)}" aria-label="Quitar ${esc(i.nombre)}">${ico('x', 'icon-xs')}</button></span>`).join('');
const pieTexto = (n, total) => (n >= total ? `${total} en total` : `Mostrando ${n} de ${total} · escribe un nombre o filtra para encontrar más`);

function filtrarPicker(root) {
    const q = norm(root.querySelector('[data-input="picker"]')?.value).split(/\s+/).filter(Boolean);
    const filtro = (k) => root.querySelector(`[data-picker-filtro="${k}"]`)?.value || '';
    const grado = filtro('grado'), tipo = filtro('tipo');
    const filas = [...root.querySelectorAll('[data-pk]')];
    let mostrados = 0, coinciden = 0;
    filas.forEach(li => {
        const ok = q.every(w => li.dataset.n.includes(w)) && (!grado || li.dataset.grado === grado) && (!tipo || li.dataset.tipo === tipo);
        const marcado = li.querySelector('input').checked;
        if (ok) coinciden++;
        const ver = ok && (marcado || mostrados < PICKER_MAX);
        if (ver && !marcado) mostrados++;
        li.hidden = !ver;
    });
    const pie = root.querySelector('[data-picker-foot]');
    if (pie) pie.textContent = coinciden ? pieTexto(filas.filter(li => !li.hidden).length, coinciden) : 'Sin resultados. Prueba con otro nombre o grado.';
    const btn = root.querySelector('[data-action="picker-visibles"]');
    if (btn) btn.hidden = !(q.length || grado || tipo) || !coinciden;
}

function actualizarChips(root) {
    const box = root.querySelector('[data-picker-sel]');
    if (!box) return;
    const elegidos = [...root.querySelectorAll('[data-pk] input:checked')].map(i => ({ id: i.value, nombre: i.closest('label').querySelector('strong').textContent }));
    box.innerHTML = chipsPicker(elegidos);
}

document.addEventListener('change', (ev) => {
    const root = ev.target.closest('[data-picker]');
    if (!root) return;
    if (ev.target.matches('[data-picker-filtro]')) filtrarPicker(root);
    else actualizarChips(root);
});

// ==========================================================================
// 9e. MENSAJES: conversaciones privadas, silenciar y bloquear
// ==========================================================================

const esFamiliaRol = (r) => r === ROLES.PADRE || r === ROLES.ESTUDIANTE;
const otroDe = (c) => (c.Miembros || []).find(id => id !== state.me.ID);
const soyMiembro = (c) => (c.Miembros || []).includes(state.me.ID);
const convSinLeer = (c) => soyMiembro(c) && c.UltimoAutorID !== state.me.ID && (c.Leido?.[state.me.ID] || 0) < (c.UltimoT || 0);
const convsSinLeer = () => state.db.conversaciones.filter(convSinLeer);

function convTitulo(c) {
    const nombre = (id) => idx.users.get(id)?.Nombre || c.Nombres?.[id] || 'Usuario';
    if (soyMiembro(c)) return nombre(otroDe(c));
    return (c.Miembros || []).map(nombre).join(' ↔ ');
}

function restriccionVigente(staffId, otroId) {
    const r = state.db.restricciones.find(x => x.StaffID === staffId && x.OtroID === otroId);
    if (!r) return null;
    if (r.Tipo === 'BLOQUEO' || (r.Tipo === 'SILENCIO' && r.Hasta >= today())) return r;
    return null;
}

function actualizarInsignia() {
    const n = convsSinLeer().length;
    $$('[data-nav-badge]').forEach(b => { b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n); });
}

// Se calcula una vez por cada carga de datos (las listas pueden tener cientos de filas).
let contactosCache = { db: null, ids: new Set() };
function puedoEscribirA(u) {
    if (contactosCache.db !== state.db) contactosCache = { db: state.db, ids: new Set(contactosDisponibles().map(c => c.ID)) };
    return !!u && contactosCache.ids.has(u.ID);
}

/** Con quién puede iniciar una conversación cada rol. */
function contactosDisponibles() {
    const me = state.me;
    const admins = state.db.contactosAdmin.filter(u => u.ID !== me.ID);
    let lista = [];
    if (isAdmin()) {
        lista = state.db.users.filter(u => u.ID !== me.ID);
    } else if (me.Rol === ROLES.TUTOR) {
        const alumnos = alumnosElegibles();
        const ids = new Set(alumnos.map(a => a.ID));
        const padres = state.db.users.filter(u => u.Rol === ROLES.PADRE && String(u.HijosIDs || '').split(',').some(h => ids.has(h)));
        lista = [...alumnos, ...padres, ...admins];
    } else {
        const hijos = me.Rol === ROLES.PADRE ? hijosDe().map(h => h.ID) : [me.ID];
        const tutores = new Set(hijos.flatMap(h => cursosDe(h)).map(c => c.TutorID));
        lista = [...[...tutores].map(id => idx.users.get(id)).filter(Boolean), ...admins];
    }
    return [...new Map(lista.map(u => [u.ID, u])).values()].sort(byName);
}

/** Personas como opciones del buscador. */
function itemPersona(u) {
    const tipo = { ESTUDIANTE: 'Alumnos', PADRE: 'Padres', TUTOR: 'Maestros', ADMIN: 'Administración' }[u.Rol] || '';
    let grado = u.Grado || '';
    if (u.Rol === ROLES.PADRE) {
        const hijos = String(u.HijosIDs || '').split(',').map(id => idx.users.get(id)).filter(Boolean);
        grado = hijos[0]?.Grado || '';
    }
    return { id: u.ID, nombre: u.Nombre, sub: etiquetaContacto(u), grado, tipo, user: u };
}
const itemCurso = (c) => ({ id: c.CursoID, nombre: c.NombreCurso, sub: tutorDe(c) });

function etiquetaContacto(u) {
    if (u.Rol === ROLES.PADRE) {
        const hijos = String(u.HijosIDs || '').split(',').map(id => idx.users.get(id)?.Nombre).filter(Boolean);
        return `Padre/Madre${hijos.length ? ' de ' + hijos.join(', ') : ''}`;
    }
    if (u.Rol === ROLES.TUTOR) {
        const cursos = state.db.cursos.filter(c => c.TutorID === u.ID).map(c => c.NombreCurso);
        return `Maestro${cursos.length ? ' · ' + cursos.join(', ') : ''}`;
    }
    if (u.Rol === ROLES.ADMIN) return 'Administración';
    return `Alumno${u.Grado ? ' · ' + u.Grado : ''}`;
}

const horaCorta = (s) => {
    if (!s) return '';
    return String(s).slice(0, 10) === today() ? String(s).slice(11, 16) : fmtDate(s);
};

function viewMensajes(convId) {
    const convs = state.db.conversaciones;
    const c = convId ? convs.find(x => x.ConvID === convId) : null;
    const lista = convs.length ? `<ul class="conv-list">${convs.map(x => `<li><a class="conv-item${x.ConvID === convId ? ' is-active' : ''}${convSinLeer(x) ? ' is-unread' : ''}" href="#/mensajes/${encodeURIComponent(x.ConvID)}">
            ${avatar(idx.users.get(otroDe(x)) || { Nombre: convTitulo(x) }, 'sm')}
            <span class="conv-main"><strong>${esc(convTitulo(x))}</strong><small>${x.UltimoAutorID === state.me.ID ? 'Tú: ' : ''}${esc(x.UltimoTexto || '')}</small></span>
            <span class="conv-side"><small>${esc(horaCorta(x.UltimoEn))}</small>${convSinLeer(x) ? '<span class="conv-dot" aria-label="Sin leer"></span>' : ''}</span></a></li>`).join('')}</ul>`
        : emptyState('Aún no tienes conversaciones.', 'message-square');
    return `<div class="chat${c ? ' has-thread' : ''}">
        <section class="card chat-list">
            <div class="card-head"><h2>Conversaciones</h2><button class="btn btn-primary btn-sm" data-action="nuevo-mensaje">${ico('plus')} Nuevo</button></div>
            ${lista}
            <p class="muted chat-aviso">${ico('info', 'icon-xs')} La administración del colegio puede ver las conversaciones.</p>
        </section>
        <section class="card chat-thread">${c ? hiloHtml(c) : emptyState(convId ? 'Esta conversación ya no está disponible.' : 'Elige una conversación o empieza una nueva.', 'message-square')}</section>
    </div>`;
}

function hiloHtml(c) {
    const otroId = otroDe(c);
    const otro = idx.users.get(otroId) || { Nombre: c.Nombres?.[otroId], Rol: c.Roles?.[otroId] };
    const miembro = soyMiembro(c);
    let acciones = '', aviso = '';
    if (miembro && esStaff() && esFamiliaRol(otro.Rol)) {
        const r = restriccionVigente(state.me.ID, otroId);
        acciones = `<button class="btn btn-ghost btn-sm" data-action="restringir" data-otro="${esc(otroId)}">${r ? 'Restricción' : 'Silenciar / bloquear'}</button>`;
        if (r) aviso = `<div class="chat-banner">${r.Tipo === 'BLOQUEO' ? 'Bloqueaste los mensajes de esta persona.' : `Silenciaste a esta persona hasta el ${fmtDate(r.Hasta)}.`}${r.Motivo ? ` Motivo: <em>${esc(r.Motivo)}</em>` : ''}</div>`;
    }
    let puedeEscribir = miembro;
    if (miembro && esFamiliaRol(state.me.Rol)) {
        const r = restriccionVigente(otroId, state.me.ID);
        if (r) {
            puedeEscribir = false;
            aviso = `<div class="chat-banner">${r.Tipo === 'BLOQUEO' ? `${esc(otro.Nombre)} no está recibiendo tus mensajes por ahora.` : `${esc(otro.Nombre)} pausó los mensajes contigo hasta el ${fmtDate(r.Hasta)}.`} Si es urgente, comunícate con la administración.</div>`;
        }
    }
    if (!miembro) aviso = `<div class="chat-banner">Solo lectura: ${esPadre() ? 'conversación de tu hijo/a con su maestro.' : 'supervisión de la administración.'}</div>`;
    if (isAdmin() && !miembro) {
        const rs = state.db.restricciones.filter(r => (c.Miembros || []).includes(r.StaffID) && (c.Miembros || []).includes(r.OtroID));
        rs.forEach(r => { aviso += `<div class="chat-banner">${esc(r.StaffNombre)} ${r.Tipo === 'BLOQUEO' ? 'bloqueó' : `silenció hasta ${fmtDate(r.Hasta)}`} a ${esc(r.OtroNombre)}. Motivo: <em>${esc(r.Motivo || '')}</em></div>`; });
    }
    return `<div class="chat-head">
            <a class="icon-btn chat-back" href="#/mensajes" aria-label="Volver a conversaciones">${ico('arrow-left')}</a>
            ${person(otro.Nombre ? otro : { Nombre: convTitulo(c) }, miembro ? etiquetaContacto(otro) : convTitulo(c))}
            <div class="row">${acciones}</div>
        </div>
        ${aviso}
        <div class="chat-body" data-chat-body data-conv="${esc(c.ConvID)}">${mensajesHtml(c.ConvID)}</div>
        ${puedeEscribir ? `<form class="chat-compose" data-submit="mensaje" data-conv="${esc(c.ConvID)}">
            <textarea name="Texto" rows="2" maxlength="2000" required placeholder="Escribe tu mensaje…" aria-label="Mensaje"></textarea>
            <button type="submit" class="btn btn-primary">Enviar</button>
        </form>` : ''}`;
}

function mensajesHtml(convId) {
    const lista = state.chat?.[convId];
    if (!lista) return `<p class="muted center" style="padding:24px">${ico('loader', 'spin')} Cargando mensajes…</p>`;
    if (!lista.length) return emptyState('Sin mensajes todavía.', 'message-square');
    let dia = '';
    return lista.map(m => {
        const d = String(m.Fecha).slice(0, 10);
        const sep = d !== dia ? `<div class="chat-day"><span>${esc(fmtDate(d))}</span></div>` : '';
        dia = d;
        const mio = m.AutorID === state.me.ID;
        return `${sep}<div class="msg${mio ? ' is-mine' : ''}">
            ${mio ? '' : `<small class="msg-autor">${esc(m.AutorNombre)}</small>`}
            <div class="msg-bubble">${esc(m.Texto)}</div>
            <small class="msg-time">${esc(String(m.Fecha).slice(11, 16))}</small></div>`;
    }).join('');
}

async function mensajesAfter(convId) {
    actualizarInsignia();
    if (!convId) return;
    const c = state.db.conversaciones.find(x => x.ConvID === convId);
    if (!c) return;
    const pintar = () => {
        const body = $(`[data-chat-body][data-conv="${CSS.escape(convId)}"]`);
        if (!body) return;
        body.innerHTML = mensajesHtml(convId);
        body.scrollTop = body.scrollHeight;
    };
    pintar();
    try {
        const r = await api('getMensajes', { ConvID: convId });
        state.chat = { ...(state.chat || {}), [convId]: r.mensajes };
        pintar();
        if (convSinLeer(c)) {
            await api('marcarLeida', { ConvID: convId });
            c.Leido = { ...(c.Leido || {}), [state.me.ID]: Date.now() };
            $$('.conv-item.is-active').forEach(a => { a.classList.remove('is-unread'); a.querySelector('.conv-dot')?.remove(); });
            actualizarInsignia();
        }
    } catch (e) {
        toast(e.message, 'error');
    }
}

async function enviarEnConversacion(form) {
    const convId = form.dataset.conv;
    const texto = form.Texto.value.trim();
    if (!texto) return;
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
        const r = await withBusy(() => api('enviarMensaje', { ConvID: convId, Texto: texto }));
        state.chat = { ...(state.chat || {}), [convId]: [...(state.chat?.[convId] || []), r] };
        form.Texto.value = '';
        await refresh();
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

async function nuevoMensaje(paraId = '') {
    // Si ya hay conversación con esa persona, se abre directamente.
    const existente = paraId && state.db.conversaciones.find(c => soyMiembro(c) && otroDe(c) === paraId);
    if (existente) return go(`mensajes/${encodeURIComponent(existente.ConvID)}`);
    const contactos = contactosDisponibles();
    if (!contactos.length) return toast('Aún no tienes contactos disponibles para escribir.', 'info');
    const r = await openModal({
        title: 'Nuevo mensaje',
        wide: true,
        submitLabel: 'Enviar',
        body: `<div class="field"><span>Para *</span>
                ${picker({ name: 'ParaID', items: contactos.map(itemPersona), selected: paraId ? [paraId] : [], multiple: false, filtros: ['tipo', 'grado'], placeholder: 'Buscar por nombre…' })}</div>
            <label class="field"><span>Mensaje *</span><textarea name="Texto" rows="5" maxlength="2000" required></textarea></label>
            <p class="muted" style="font-size:13px">La administración del colegio puede ver las conversaciones.</p>`,
        onSubmit: async (fd) => {
            if (!fd.get('ParaID')) throw new Error('Elige a quién escribir.');
            return withBusy(() => api('enviarMensaje', { ParaID: fd.get('ParaID'), Texto: fd.get('Texto') }));
        },
    });
    if (r && r.ConvID) {
        await refresh();
        go(`mensajes/${encodeURIComponent(r.ConvID)}`);
    }
}

async function restringir(otroId) {
    const otro = idx.users.get(otroId);
    const r = restriccionVigente(state.me.ID, otroId);
    const manana = isoDe(new Date(Date.now() + 7 * 86400000));
    await openModal({
        title: `Mensajes de ${otro?.Nombre || 'esta persona'}`,
        submitLabel: 'Guardar',
        body: `${r ? `<p>Estado actual: <strong>${r.Tipo === 'BLOQUEO' ? 'Bloqueado' : `Silenciado hasta el ${fmtDate(r.Hasta)}`}</strong></p>` : ''}
            <div class="segmented" role="radiogroup" aria-label="Acción">
                <label><input type="radio" name="Tipo" value="SILENCIO" data-change="restriccion-tipo" ${!r || r.Tipo === 'SILENCIO' ? 'checked' : ''}><span>Silenciar hasta una fecha</span></label>
                <label><input type="radio" name="Tipo" value="BLOQUEO" data-change="restriccion-tipo" ${r?.Tipo === 'BLOQUEO' ? 'checked' : ''}><span>Bloquear</span></label>
                ${r ? '<label><input type="radio" name="Tipo" value="NINGUNA" data-change="restriccion-tipo"><span>Quitar restricción</span></label>' : ''}
            </div>
            <label class="field" data-hasta style="margin-top:12px" ${r?.Tipo === 'BLOQUEO' ? 'hidden' : ''}><span>Silenciado hasta *</span><input type="date" name="Hasta" min="${today()}" value="${esc(r?.Hasta || manana)}"></label>
            <p class="muted" style="font-size:13px">Mientras dure, ${esc(otro?.Nombre || 'esta persona')} no podrá enviarte mensajes; tú sí puedes escribirle. Queda registrado en la bitácora y la administración lo ve.</p>
            ${justificationField('Explica el motivo. Lo verá la administración (no se le muestra a la otra persona).')}`,
        onSubmit: async (fd) => {
            await withBusy(() => api('setRestriccion', { OtroID: otroId, Tipo: fd.get('Tipo'), Hasta: fd.get('Hasta'), justificacion: fd.get('justificacion') }));
            toast('Listo.', 'success');
            await refresh();
        },
    });
}

// ==========================================================================
// 9f. MATERIAL DE APOYO y adjuntos de evaluaciones
// ==========================================================================

const tamano = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const dominio = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function materialLink(m, chip = false) {
    if (m.Tipo === 'ENLACE') {
        const url = safeUrl(m.URL);
        return url ? `<a class="${chip ? 'mat-chip' : 'btn btn-ghost btn-sm'}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(m.Descripcion || url)}">${ico('arrow-up-right', 'icon-sm')} ${esc(chip ? m.Titulo : 'Abrir')}</a>` : '';
    }
    return `<button type="button" class="${chip ? 'mat-chip' : 'btn btn-ghost btn-sm'}" data-action="download-material" data-id="${esc(m.MaterialID)}" title="${esc(m.ArchivoNombre)}">${ico('download', 'icon-sm')} ${esc(chip ? m.Titulo : 'Descargar')}</button>`;
}

/** Adjuntos de una evaluación como chips (con botón de quitar para quien gestiona). */
function adjuntosHtml(item, gestiona) {
    const adj = idx.adjuntosByItem.get(item.ItemID) || [];
    if (!adj.length) return '';
    return `<div class="mat-chips">${adj.map(m => `<span class="mat-chip-wrap">${materialLink(m, true)}${gestiona
        ? `<button type="button" class="icon-btn danger icon-btn-xs" data-action="delete-material" data-id="${esc(m.MaterialID)}" aria-label="Quitar adjunto ${esc(m.Titulo)}" title="Quitar">${ico('x', 'icon-xs')}</button>` : ''}</span>`).join('')}</div>`;
}

/** Lista de material de un curso. unidad: número, 0 = general, null = todo. */
function materialLista(cursoId, unidad, gestiona, compacto = false) {
    const lista = (idx.materialesByCurso.get(cursoId) || []).filter(m => unidad == null || +m.Unidad === +unidad);
    if (!lista.length) return '';
    const titulo = compacto ? `<h4 class="mat-title">${ico('folder-open', 'icon-sm')} ${unidad === 0 ? 'Material general del curso' : 'Material de apoyo'}</h4>` : '';
    return `${titulo}<ul class="item-list mat-list">${lista.map(m => `<li class="item-row">
        <span class="mat-icon">${ico(m.Tipo === 'ENLACE' ? 'arrow-up-right' : 'paperclip')}</span>
        <div class="item-main"><strong>${esc(m.Titulo)}</strong>
            <div class="item-meta">${m.Descripcion ? `<span>${esc(m.Descripcion)}</span>` : ''}<span>${m.Tipo === 'ENLACE' ? esc(dominio(m.URL)) : `${esc(m.ArchivoNombre)} · ${tamano(m.Tamano || 0)}`}</span>${!compacto ? `<span>${esc(m.AutorNombre)} · ${fmtDate(m.Fecha)}</span>` : ''}</div></div>
        <div class="item-side">${materialLink(m)}${gestiona ? `<button class="icon-btn danger" data-action="delete-material" data-id="${esc(m.MaterialID)}" aria-label="Eliminar material" title="Eliminar">${ico('trash')}</button>` : ''}</div>
    </li>`).join('')}</ul>`;
}

function cursoMaterial(c, m) {
    const units = Grades.units(c.CursoID);
    const grupos = [[0, 'General del curso'], ...units.map(u => [u.numero, `U${u.numero} · ${u.nombre}`])];
    const hay = (idx.materialesByCurso.get(c.CursoID) || []).length;
    return `<section class="card">
        <div class="card-head"><h2>Material de apoyo</h2>
            ${m ? `<button class="btn btn-primary btn-sm" data-action="new-material" data-curso="${esc(c.CursoID)}">${ico('plus')} Material</button>` : ''}</div>
        ${hay ? grupos.map(([n, nombre]) => {
            const html = materialLista(c.CursoID, n, m);
            return html ? `<div class="unit-block"><div class="unit-head"><h3>${esc(nombre)}</h3></div>${html}</div>` : '';
        }).join('') : emptyState('Sube guías, presentaciones, lecturas o enlaces a videos para que los alumnos estudien.', 'folder-open')}
        <p class="muted" style="font-size:13px;padding:0 22px 16px">Las hojas de trabajo o enunciados de una tarea se adjuntan desde la pestaña Evaluaciones (botón "Adjuntar").</p>
    </section>`;
}

async function openMaterialModal(cursoId, itemId = '') {
    const item = itemId ? idx.items.get(itemId) : null;
    const units = Grades.units(cursoId);
    await openModal({
        title: item ? `Adjuntar a "${item.Titulo}"` : 'Nuevo material de apoyo',
        wide: true,
        submitLabel: 'Guardar',
        body: `<div class="form-grid">
            <fieldset class="field span-all" style="border:0;padding:0;margin:0"><span>Tipo *</span>
                <div class="segmented" role="radiogroup" aria-label="Tipo de material">
                    <label><input type="radio" name="Tipo" value="ARCHIVO" data-change="material-tipo" checked><span>Archivo</span></label>
                    <label><input type="radio" name="Tipo" value="ENLACE" data-change="material-tipo"><span>Enlace</span></label>
                </div></fieldset>
            <label class="field span-all"><span>Título *</span><input name="Titulo" required maxlength="160" placeholder="${item ? 'Ej.: Hoja de trabajo' : 'Ej.: Guía de estudio de la unidad 1'}"></label>
            ${item ? '' : `<label class="field"><span>Unidad</span><select name="Unidad">${options([[0, 'General del curso'], ...units.map(u => [u.numero, `U${u.numero} · ${u.nombre}`])], 0)}</select></label>`}
            <label class="field span-all" data-mat-archivo><span>Archivo * <small class="muted">(máx. ${CONFIG.MAX_ENTREGA_MB} MB)</small></span>
                <input type="file" name="archivo" accept="${CONFIG.EXTENSIONES.map(e => '.' + e).join(',')}"></label>
            <label class="field span-all" data-mat-enlace hidden><span>Enlace *</span><input type="url" name="URL" maxlength="2000" placeholder="https://…"></label>
            <label class="field span-all"><span>Descripción</span><textarea name="Descripcion" rows="2" maxlength="1000"></textarea></label>
        </div>`,
        onSubmit: async (fd) => {
            const tipo = fd.get('Tipo');
            const payload = { CursoID: cursoId, ItemID: itemId, Unidad: fd.get('Unidad') ?? 0, Tipo: tipo, Titulo: fd.get('Titulo'), Descripcion: fd.get('Descripcion') };
            if (tipo === 'ENLACE') {
                payload.URL = fd.get('URL');
                if (!payload.URL) throw new Error('Escribe el enlace.');
            } else {
                const file = fd.get('archivo');
                if (!file || !file.size) throw new Error('Elige un archivo.');
                const ext = (file.name.split('.').pop() || '').toLowerCase();
                if (!CONFIG.EXTENSIONES.includes(ext)) throw new Error(`Tipo de archivo no permitido. Usa: ${CONFIG.EXTENSIONES.join(', ')}.`);
                if (file.size > CONFIG.MAX_ENTREGA_MB * 1024 * 1024) throw new Error(`El archivo supera ${CONFIG.MAX_ENTREGA_MB} MB.`);
                payload.nombre = file.name;
                payload.base64 = await fileToBase64(file);
            }
            await withBusy(() => api('saveMaterial', payload));
            toast(item ? 'Adjunto agregado.' : 'Material publicado.', 'success');
            await refresh();
        },
    });
}

// ==========================================================================
// 10. UI: MODALES, TOASTS, ARCHIVOS
// ==========================================================================

/**
 * Abre un modal con formulario. onSubmit(FormData, form) puede lanzar un error:
 * se muestra dentro del modal y el usuario puede corregir sin perder lo escrito.
 */
function openModal({ title, body, submitLabel = 'Guardar', danger = false, wide = false, onSubmit }) {
    const dlg = $('#modal');
    dlg.className = `modal${wide ? ' modal-wide' : ''}`;
    dlg.innerHTML = `<form class="modal-card" novalidate>
        <header class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">${ico('x')}</button></header>
        <div class="modal-body">${body}</div>
        <p class="form-error" role="alert" hidden></p>
        <footer class="modal-foot">
            <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
            <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submitLabel)}</button>
        </footer></form>`;

    return new Promise((resolve) => {
        const form = dlg.querySelector('form');
        let result = null;
        dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => dlg.close()));
        dlg.addEventListener('close', () => { dlg.innerHTML = ''; resolve(result); }, { once: true });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!form.checkValidity()) { form.reportValidity(); return; }
            const btn = form.querySelector('[type="submit"]');
            const err = form.querySelector('.form-error');
            btn.disabled = true; btn.classList.add('is-loading'); err.hidden = true;
            try {
                result = (await onSubmit?.(new FormData(form), form)) ?? true;
                dlg.close();
            } catch (ex) {
                if (ex.code === 'BAD_RESPONSE') {
                    // Puede que sí se haya guardado: se cierra y se recargan los datos para verlo.
                    dlg.close();
                    toast(ex.message, 'info', 9000);
                    refresh().catch(() => {});
                    return;
                }
                err.textContent = ex.message; err.hidden = false;
            } finally {
                btn.disabled = false; btn.classList.remove('is-loading');
            }
        });
        dlg.showModal();
        form.querySelector('input:not([disabled]):not([type=hidden]), select, textarea')?.focus();
    });
}

function toast(msg, type = 'info', ms = 4500) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 220); }, ms);
}

function pickFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.addEventListener('change', () => resolve(input.files[0] || null), { once: true });
        input.addEventListener('cancel', () => resolve(null), { once: true });
        input.click();
    });
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1] || '');
        r.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        r.readAsDataURL(file);
    });
}

async function uploadEntrega(btn) {
    const item = idx.items.get(btn.dataset.item);
    const file = await pickFile(CONFIG.EXTENSIONES.map(e => '.' + e).join(','));
    if (!file || !item) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!file.name.includes('.') || !CONFIG.EXTENSIONES.includes(ext)) {
        return toast(`Tipo de archivo no permitido. Usa: ${CONFIG.EXTENSIONES.join(', ')}.`, 'error', 7000);
    }
    if (!file.size) return toast('El archivo está vacío.', 'error');
    if (file.size > CONFIG.MAX_ENTREGA_MB * 1024 * 1024) return toast(`El archivo supera ${CONFIG.MAX_ENTREGA_MB} MB.`, 'error');

    const label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${ico('loader', 'spin')} Subiendo…`;
    try {
        const base64 = await fileToBase64(file);
        await withBusy(() => api('submitEntrega', { ItemID: item.ItemID, nombre: file.name, base64 }));
        toast(`Entrega de "${item.Titulo}" registrada.`, 'success');
        await refresh();
    } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = label;
    }
}

/** Descarga una entrega. Se fuerza como archivo adjunto (nunca se abre dentro de la app). */
async function downloadEntrega(btn, accion = 'getEntregaFile', payload = { EntregaID: btn.dataset.id }) {
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = btn.classList.contains('file-dot') ? ico('loader', 'spin') : `${ico('loader', 'spin')} Descargando…`;
    try {
        const f = await withBusy(() => api(accion, payload));
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = f.nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        if (!f.integro) toast('El archivo no coincide con el que se entregó originalmente. Pudo ser modificado después de la entrega.', 'error', 10000);
    } catch (e) {
        toast(e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = label;
    }
}

async function uploadPhoto(btn) {
    const file = await pickFile('image/jpeg,image/png,image/webp');
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Selecciona una imagen.', 'error');
    if (file.size > CONFIG.MAX_FOTO_MB * 1024 * 1024) return toast(`La imagen supera ${CONFIG.MAX_FOTO_MB} MB.`, 'error');

    btn.disabled = true;
    btn.textContent = 'Procesando…';
    try {
        const dataUrl = await imageToBase64(file);
        btn.textContent = 'Guardando…';
        await mutate('updateProfile', { FotoURL: dataUrl }, 'Foto actualizada.');
    } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = `${ico('camera')} Cambiar foto`;
    }
}

/**
 * Recorta la imagen al centro (cuadrado), la reduce a FOTO_PX y la codifica como
 * JPEG base64, bajando la calidad hasta que quepa en una celda de Sheets.
 * Re-dibujar en canvas también elimina metadatos EXIF (ubicación GPS, cámara…).
 */
async function imageToBase64(file) {
    const bitmap = await createImageBitmap(file).catch(() => {
        throw new Error('No se pudo leer la imagen. Prueba con otro archivo JPG o PNG.');
    });
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CONFIG.FOTO_PX;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';                       // fondo blanco para PNG con transparencia
    ctx.fillRect(0, 0, CONFIG.FOTO_PX, CONFIG.FOTO_PX);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
        0, 0, CONFIG.FOTO_PX, CONFIG.FOTO_PX);
    bitmap.close?.();

    for (let q = 0.85; q >= 0.4; q -= 0.1) {
        const dataUrl = canvas.toDataURL('image/jpeg', q);
        if (dataUrl.length <= CONFIG.FOTO_MAX_CHARS) return dataUrl;
    }
    throw new Error('No se pudo comprimir la imagen lo suficiente. Prueba con otra foto.');
}

// ==========================================================================
// 11. ACCIONES (delegación de eventos)
// ==========================================================================

const findUser = id => idx.users.get(id);

const ACTIONS = {
    'toggle-password': (btn) => setPasswordVisible(btn, btn.getAttribute('aria-pressed') !== 'true'),
    'open-sidebar': () => $('#screen-app').classList.add('sidebar-open'),
    'close-sidebar': () => { $('#screen-app').classList.remove('sidebar-open'); aplicarMenuOculto(); },
    'toggle-sidebar': () => {
        if (esEscritorio()) PREF.set('menu-oculto', !PREF.get('menu-oculto', false));
        else $('#screen-app').classList.toggle('sidebar-open');
        aplicarMenuOculto();
    },
    'nav-group': (el) => toggleGrupo(el.closest('.nav-group')),
    'logout': async () => {
        if (hasUnsavedWork() && !confirm('Tienes cambios sin guardar. ¿Cerrar sesión de todos modos?')) return;
        discardDrafts();
        await signOut(auth);
    },
    'sync': async () => {
        if (hasUnsavedWork() && !confirm('Recargar descartará los cambios sin guardar. ¿Continuar?')) return;
        discardDrafts();
        try { await refresh(); toast('Datos actualizados.'); } catch (e) { toast(e.message, 'error'); }
    },
    'forgot-password': async () => {
        const email = $('#login-form [name=email]').value.trim();
        if (!email) return showLoginError('Escribe tu correo y vuelve a presionar "¿Olvidaste tu contraseña?".');
        try {
            await sendPasswordResetEmail(auth, email);
            toast('Si el correo existe, recibirás un enlace para restablecer tu contraseña.', 'success', 7000);
        } catch (e) { showLoginError(authErrorMsg(e)); }
    },
    'resend-verification': async (btn) => {
        btn.disabled = true;
        try { await sendEmailVerification(auth.currentUser); toast('Correo de verificación enviado. Revisa tu bandeja.', 'success'); }
        catch (e) { toast(authErrorMsg(e), 'error'); btn.disabled = false; }
    },
    'retry-session': async () => {
        await auth.currentUser?.reload();
        bootSession(true);
    },

    // Usuarios
    'users-rol': (el) => { state.usersFilter.rol = el.dataset.rol; render(); },
    'new-user': () => openUserModal(),
    'edit-user': (el) => openUserModal(findUser(el.dataset.id)),
    'delete-user': (el) => deleteUserFlow(findUser(el.dataset.id)),

    // Cursos
    'new-course': () => openCourseModal(),
    'edit-course': (el) => openCourseModal(idx.cursos.get(el.dataset.id)),
    'delete-course': async (el) => {
        const c = idx.cursos.get(el.dataset.id);
        await openModal({
            title: `Eliminar "${c.NombreCurso}"`, danger: true, submitLabel: 'Eliminar curso',
            body: '<p>Se eliminarán sus unidades, pensum, evaluaciones e inscripciones. Solo es posible si el curso no tiene notas ni asistencia.</p>',
            onSubmit: async () => {
                await withBusy(() => api('deleteCourse', { CursoID: c.CursoID }));
                toast('Curso eliminado.', 'success');
                await refresh();
                go('cursos');
            },
        });
    },
    'curso-tab': (el) => { state.cursoTab = el.dataset.tab; render(); },
    'new-unit': (el) => openUnitModal(el.dataset.curso),
    'edit-unit': (el) => { const u = state.db.unidades.find(x => x.UnidadID === el.dataset.id); openUnitModal(u.CursoID, u); },
    'delete-unit': async (el) => {
        const u = state.db.unidades.find(x => x.UnidadID === el.dataset.id);
        await openModal({
            title: `Eliminar U${u.Unidad} · ${u.NombreUnidad}`, danger: true, submitLabel: 'Eliminar',
            body: '<p>Solo se puede eliminar si no tiene evaluaciones.</p>',
            onSubmit: async () => { await withBusy(() => api('deleteUnit', { UnidadID: u.UnidadID })); toast('Unidad eliminada.', 'success'); await refresh(); },
        });
    },
    'new-pensum': (el) => openPensumModal(el.dataset.curso),
    'edit-pensum': (el) => { const t = state.db.pensum.find(x => x.PensumID === el.dataset.id); openPensumModal(t.CursoID, t); },
    'delete-pensum': async (el) => {
        const t = state.db.pensum.find(x => x.PensumID === el.dataset.id);
        await openModal({
            title: 'Eliminar tema', danger: true, submitLabel: 'Eliminar', body: `<p>¿Eliminar "<strong>${esc(t.Tema)}</strong>" del pensum?</p>`,
            onSubmit: async () => { await withBusy(() => api('deletePensum', { PensumID: t.PensumID })); toast('Tema eliminado.', 'success'); await refresh(); },
        });
    },
    'new-item': (el) => openItemModal(el.dataset.curso),
    'edit-item': (el) => { const it = idx.items.get(el.dataset.id); openItemModal(it.CursoID, it); },
    'delete-item': (el) => deleteItemFlow(idx.items.get(el.dataset.id)),

    // Calificaciones
    'open-gradebook': (el) => { state.gb.cursoId = el.dataset.curso; state.gb.unidad = 'all'; go('calificaciones'); },
    'gb-save': () => gbSave(),
    'gb-discard': () => { state.gb.draft.clear(); render(); },

    // Asistencia
    'att-all-present': () => {
        alumnosDe(state.att.cursoId).forEach(a => state.att.draft.set(a.ID, 'Presente'));
        render();
    },
    'att-save': () => attSave(),

    // Estudiante / Padre
    'student-course': (el) => { state.studentCurso = el.dataset.curso; render(); },
    'open-student-course': (el) => { state.studentCurso = el.dataset.curso; go('mis-cursos'); },
    'upload-entrega': (el) => uploadEntrega(el),
    'download-entrega': (el) => downloadEntrega(el),
    'verify-audit': async (el) => {
        el.disabled = true;
        el.classList.add('is-loading');
        try {
            state.auditCheck = await withBusy(() => api('verifyAudit'));
            $('#audit-check').innerHTML = auditCheckHtml(state.auditCheck);
        } catch (e) { toast(e.message, 'error'); }
        finally { el.disabled = false; el.classList.remove('is-loading'); }
    },
    'upload-photo': (el) => uploadPhoto(el),
    'pick-child': (el) => { state.childId = el.dataset.id; render(); },
    // Muro
    'new-noticia': () => openNoticiaModal(),
    'edit-noticia': (el) => openNoticiaModal(state.db.noticias.find(n => n.NoticiaID === el.dataset.id)),
    'detalle-noticia': (el) => detalleNoticia(el.dataset.id),
    'delete-noticia': async (el) => {
        const n = state.db.noticias.find(x => x.NoticiaID === el.dataset.id);
        await openModal({
            title: `Eliminar "${n?.Titulo || 'noticia'}"`, danger: true, submitLabel: 'Eliminar',
            body: '<p>La noticia desaparecerá del muro de todos. Queda registro en la bitácora.</p>',
            onSubmit: async () => { await withBusy(() => api('deleteNoticia', { NoticiaID: el.dataset.id })); toast('Noticia eliminada.', 'success'); await refresh(); },
        });
    },
    'leer-noticia': async (el) => {
        el.disabled = true;
        try {
            const r = await withBusy(() => api('marcarNoticia', { NoticiaID: el.dataset.id }));
            if (!state.db.lecturas.some(l => l.LecturaID === r.LecturaID)) state.db.lecturas.push(r);
            render();
        } catch (e) { toast(e.message, 'error'); el.disabled = false; }
    },
    'noticia-foto': async (el) => {
        const file = await pickFile('image/jpeg,image/png,image/webp');
        if (!file) return;
        if (!file.type.startsWith('image/')) return toast('Selecciona una imagen.', 'error');
        if (file.size > 15 * 1024 * 1024) return toast('La imagen supera 15 MB.', 'error');
        try {
            const dataUrl = await comprimirFoto(file);
            const form = el.closest('form');
            form.dataset.foto = dataUrl;
            const prev = form.querySelector('[data-foto-preview]');
            prev.src = dataUrl;
            prev.hidden = false;
            form.querySelector('[data-foto-estado]').textContent = 'Foto lista para publicar';
        } catch (e) { toast(e.message, 'error'); }
    },
    'marcar-tarea': async (el) => {
        el.disabled = true;
        try {
            const est = el.dataset.est || state.me.ID;
            const r = await withBusy(() => api('marcarTarea', { ItemID: el.dataset.item, EstudianteID: est, accion: el.dataset.accion }));
            actualizarEntrega(est, el.dataset.item, r);
            render();
        } catch (e) { toast(e.message, 'error'); el.disabled = false; }
    },
    'ver-entregas': (el) => verEntregas(el.dataset.id),
    'nuevo-mensaje': (el) => nuevoMensaje(el.dataset.para || ''),
    'users-mas': () => { state.usersFilter.limite = (state.usersFilter.limite || 50) + 50; $('#users-table').innerHTML = usersTable(); },
    'picker-quitar': (el) => {
        const root = el.closest('[data-picker]');
        const input = [...root.querySelectorAll('[data-pk] input')].find(i => i.value === el.dataset.id);
        if (input) { input.checked = false; input.dispatchEvent(new Event('change', { bubbles: true })); }
        filtrarPicker(root);
    },
    'picker-visibles': (el) => {
        const root = el.closest('[data-picker]');
        root.querySelectorAll('[data-pk]:not([hidden]) input:not(:checked):not(:disabled)').forEach(i => {
            i.checked = true;
            i.dispatchEvent(new Event('change', { bubbles: true }));
        });
    },
    'restringir': (el) => restringir(el.dataset.otro),
    'cita-alumno': (el) => openEventoModal(null, { tipo: 'CITA', estIds: [el.dataset.est] }),
    'responder-cita': async (el) => {
        const e = state.db.eventos.find(x => x.EventoID === el.dataset.id);
        if (el.dataset.r === 'ASISTIRE') {
            await withBusy(() => api('responderCita', { EventoID: el.dataset.id, respuesta: 'ASISTIRE' }));
            $('#modal').close();
            toast('Confirmaste tu asistencia.', 'success');
            return refresh();
        }
        await openModal({
            title: `No puedo asistir · ${e?.Titulo || 'cita'}`, submitLabel: 'Enviar respuesta',
            body: `<label class="field"><span>Comentario para el maestro *</span><textarea name="comentario" required maxlength="500" rows="3" placeholder="Ej.: ¿Podría ser el viernes a la misma hora?"></textarea></label>`,
            onSubmit: async (fd) => {
                await withBusy(() => api('responderCita', { EventoID: el.dataset.id, respuesta: 'NO_PUEDO', comentario: fd.get('comentario') }));
                toast('Respuesta enviada al maestro.', 'success');
                await refresh();
            },
        });
    },
    'new-material': (el) => openMaterialModal(el.dataset.curso, el.dataset.item || ''),
    'download-material': (el) => downloadEntrega(el, 'getMaterialFile', { MaterialID: el.dataset.id }),
    'delete-material': async (el) => {
        const m = state.db.materiales.find(x => x.MaterialID === el.dataset.id);
        await openModal({
            title: `Eliminar "${m?.Titulo || 'material'}"`, danger: true, submitLabel: 'Eliminar',
            body: '<p>Dejará de estar disponible para alumnos y padres. Queda registro en la bitácora.</p>',
            onSubmit: async () => { await withBusy(() => api('deleteMaterial', { MaterialID: el.dataset.id })); toast('Material eliminado.', 'success'); await refresh(); },
        });
    },

    'agenda-nav': (el) => { agendaNav(Number(el.dataset.dir)); render(); },
    'agenda-ir': (el) => { Object.assign(agenda(), { modo: 'dia', fecha: el.dataset.fecha }); render(); },
    'new-evento': (el) => openEventoModal(null, { fecha: el.dataset.fecha || '', hora: el.dataset.hora || '' }),
    'ver-evento': (el) => verEvento(el.dataset.tipo, el.dataset.id),
    'delete-evento': async (el) => {
        const e = state.db.eventos.find(x => x.EventoID === el.dataset.id);
        await openModal({
            title: `Eliminar "${e?.Titulo || 'evento'}"`, danger: true, submitLabel: 'Eliminar',
            body: '<p>El evento desaparecerá de la agenda de todos. Queda registro en la bitácora.</p>',
            onSubmit: async () => { await withBusy(() => api('deleteEvento', { EventoID: el.dataset.id })); toast('Evento eliminado.', 'success'); await refresh(); },
        });
    },

    'nota-aprobacion': async (el) => {
        const c = idx.cursos.get(el.dataset.curso);
        await openModal({
            title: `Nota mínima para aprobar · ${c.NombreCurso}`,
            submitLabel: 'Guardar',
            body: `<label class="field"><span>Nota mínima (sobre 100) *</span><input type="number" name="NotaAprobacion" min="0" max="100" step="0.01" required value="${esc(aprobDe(c.CursoID))}"></label>
                <p class="muted" style="font-size:13px">Los resultados, el libro de notas y los perfiles mostrarán "Aprobado" o "Reprobado" según este valor. El cambio queda en la bitácora.</p>`,
            onSubmit: async (fd) => {
                await withBusy(() => api('saveCourseSettings', { CursoID: c.CursoID, NotaAprobacion: fd.get('NotaAprobacion') }));
                toast('Nota mínima actualizada.', 'success');
                await refresh();
            },
        });
    },
    'excepcion': async (el) => {
        const it = idx.items.get(el.dataset.item);
        const est = idx.users.get(el.dataset.est);
        const quitar = el.dataset.quitar === '1';
        const r = await openModal({
            title: `${quitar ? 'Retirar excepción' : 'Excepción por entrega tarde'} · ${est?.Nombre || ''}`,
            submitLabel: quitar ? 'Retirar excepción' : 'Conceder excepción',
            body: `<p><strong>${esc(it.Titulo)}</strong> · ${esc(reglaTexto(it))}</p>
                <p class="muted" style="font-size:13px">${quitar ? 'Se volverá a aplicar la penalización.' : 'La nota no tendrá penalización por haberse entregado tarde.'} Queda registrado en la bitácora y lo verán los padres.</p>
                ${justificationField(quitar ? 'Explica por qué se retira la excepción.' : 'Explica el motivo de la excepción (por ejemplo, enfermedad con constancia).')}`,
            onSubmit: async (fd) => api('setExcepcion', {
                ItemID: it.ItemID, EstudianteID: est.ID, excepcion: !quitar, justificacion: fd.get('justificacion'),
            }),
        });
        if (r && r !== true && 'Excepcion' in r) {
            actualizarEntrega(est.ID, it.ItemID, { Excepcion: r.Excepcion });
            toast(quitar ? 'Excepción retirada.' : 'Excepción concedida.', 'success');
        }
        verEntregas(it.ItemID); // vuelve a la lista de entregas (el modal se reemplazó)
    },

    'new-anotacion': async (el) => {
        const est = idx.users.get(el.dataset.est);
        await openModal({
            title: `Nueva anotación · ${est?.Nombre || ''}`,
            submitLabel: 'Registrar',
            body: `<label class="field"><span>Tipo *</span><select name="Tipo" required>${options(TIPOS_ANOTACION.map(t => [t, t]), 'Académica')}</select></label>
                <label class="field"><span>Anotación *</span><textarea name="Texto" required maxlength="3000" rows="4" placeholder="Describe lo observado y, si aplica, lo que se espera en casa."></textarea></label>
                <p class="muted" style="font-size:13px">Los padres la verán en su muro y deberán confirmar "Enterado".</p>`,
            onSubmit: async (fd) => {
                await withBusy(() => api('saveAnotacion', { EstudianteID: el.dataset.est, Tipo: fd.get('Tipo'), Texto: fd.get('Texto') }));
                toast('Anotación registrada.', 'success');
                await refresh();
            },
        });
    },
    'confirmar-anotacion': async (el) => {
        el.disabled = true;
        try {
            const r = await withBusy(() => api('confirmarAnotacion', { AnotacionID: el.dataset.id }));
            const a = state.db.anotaciones.find(x => x.AnotacionID === el.dataset.id);
            if (a) a.Confirmaciones = r.Confirmaciones;
            render();
        } catch (e) { toast(e.message, 'error'); el.disabled = false; }
    },
    'delete-anotacion': async (el) => {
        await openModal({
            title: 'Eliminar anotación', danger: true, submitLabel: 'Eliminar',
            body: `<p>La anotación dejará de mostrarse. Su contenido queda guardado en la bitácora.</p>${justificationField('Explica por qué se elimina.')}`,
            onSubmit: async (fd) => {
                await withBusy(() => api('deleteAnotacion', { AnotacionID: el.dataset.id, justificacion: fd.get('justificacion') }));
                toast('Anotación eliminada.', 'success');
                await refresh();
            },
        });
    },

};

const INPUTS = {
    'users-q': (el) => { state.usersFilter.q = el.value; state.usersFilter.limite = 50; $('#users-table').innerHTML = usersTable(); },
    'gb-cell': (el) => gbOnInput(el),
    'picker': (el) => filtrarPicker(el.closest('[data-picker]')),
};

const CHANGES = {
    'users-grado': (el) => { state.usersFilter.grado = el.value; state.usersFilter.limite = 50; $('#users-table').innerHTML = usersTable(); },
    'gb-curso': (el) => {
        if (state.gb.draft.size && !confirm('Hay notas sin guardar en este curso. ¿Descartarlas?')) { el.value = state.gb.cursoId; return; }
        state.gb.draft.clear(); state.gb.cursoId = el.value; state.gb.unidad = 'all'; render();
    },
    'gb-unidad': (el) => { state.gb.unidad = el.value; render(); },
    'att-curso': (el) => {
        if (state.att.draft.size && !confirm('Hay asistencia sin guardar. ¿Descartarla?')) { el.value = state.att.cursoId; return; }
        state.att.draft.clear(); state.att.cursoId = el.value; render();
    },
    'att-fecha': (el) => {
        if (!el.value) return;
        if (state.att.draft.size && !confirm('Hay asistencia sin guardar. ¿Descartarla?')) { el.value = state.att.fecha; return; }
        state.att.draft.clear(); state.att.fecha = el.value; render();
    },
    'att-mark': (el) => {
        const prev = state.db.asistencia.find(a => a.CursoID === state.att.cursoId && a.Fecha === state.att.fecha && a.EstudianteID === el.dataset.est)?.Estado;
        if (prev === el.value) state.att.draft.delete(el.dataset.est); else state.att.draft.set(el.dataset.est, el.value);
        render();
    },
    'audit-est': (el) => { state.auditEst = el.value; render(); },
    'enroll-check': (el) => {
        // Al llegar al cupo se bloquean los demás; al liberar un lugar se vuelven a habilitar.
        const form = el.form;
        const marcados = $$('input[name="est"]:checked', form).length;
        $$('input[name="est"]', form).forEach(i => { if (!i.checked) i.disabled = marcados >= CONFIG.MAX_ALUMNOS_CURSO; });
        const badge = form.querySelector('[data-cupo]');
        if (badge) {
            badge.textContent = `${cupoTexto(marcados)} cupos usados`;
            badge.className = `badge ${marcados >= CONFIG.MAX_ALUMNOS_CURSO ? 'badge-warn' : 'badge-brand'}`;
        }
    },
    'penalizacion': (el) => {
        const box = el.form.querySelector('[data-pct]');
        if (box) box.hidden = el.value !== 'PORCENTAJE';
    },
    'agenda-modo': (el) => { agenda().modo = el.value; render(); },
    'agenda-entregas': (el) => { agenda().entregas = el.checked; render(); },
    'evento-tipo': (el) => {
        const f = el.form, cita = el.value === 'CITA';
        f.querySelectorAll('[data-solo-evento]').forEach(x => { x.hidden = cita; });
        f.querySelectorAll('[data-solo-cita]').forEach(x => { x.hidden = !cita; });
        f.querySelector('[data-para-label]').textContent = cita ? '¿Con los padres de qué alumno(s)? *' : '¿Para quién? *';
        const alc = f.querySelector('input[name=Alcance]:checked')?.value;
        f.querySelector('[data-cursos]').hidden = cita || alc !== 'CURSOS';
        f.querySelector('[data-alumnos]').hidden = !cita && alc !== 'ALUMNOS';
        if (cita) {
            f.TodoElDia.checked = false;
            f.querySelectorAll('[data-horas]').forEach(x => { x.hidden = false; });
        }
        const llamada = cita && f.querySelector('input[name=Modalidad]:checked')?.value === 'LLAMADA';
        f.querySelector('[data-lugar]').hidden = llamada;
        f.querySelector('[data-contacto]').hidden = !llamada;
    },
    'evento-alcance': (el) => {
        el.form.querySelector('[data-cursos]').hidden = el.value !== 'CURSOS';
        el.form.querySelector('[data-alumnos]').hidden = el.value !== 'ALUMNOS';
    },
    'evento-modalidad': (el) => {
        el.form.querySelector('[data-lugar]').hidden = el.value === 'LLAMADA';
        el.form.querySelector('[data-contacto]').hidden = el.value !== 'LLAMADA';
    },
    'restriccion-tipo': (el) => { el.form.querySelector('[data-hasta]').hidden = el.value !== 'SILENCIO'; },
    'material-tipo': (el) => {
        el.form.querySelector('[data-mat-archivo]').hidden = el.value !== 'ARCHIVO';
        el.form.querySelector('[data-mat-enlace]').hidden = el.value !== 'ENLACE';
    },
    'evento-todo': (el) => { el.form.querySelectorAll('[data-horas]').forEach(x => { x.hidden = el.checked; }); },
    'noticia-alcance': (el) => {
        const box = el.form.querySelector('[data-cursos]');
        if (box) box.hidden = el.value !== 'CURSOS';
    },
    'recibido': async (el) => {
        el.disabled = true;
        try {
            const r = await api('marcarRecibido', { ItemID: el.dataset.item, EstudianteID: el.dataset.est, recibido: el.checked });
            actualizarEntrega(el.dataset.est, el.dataset.item, r);
            const it = idx.items.get(el.dataset.item);
            const tasa = document.querySelector('#modal [data-tasa]');
            if (tasa) tasa.innerHTML = tasaTexto(it);
            const filas = document.querySelector('#modal [data-filas]');
            if (filas) filas.innerHTML = filasEntregas(it);
        } catch (e) {
            el.checked = !el.checked;
            toast(e.message, 'error');
        } finally { el.disabled = false; }
    },
    'user-form-rol': (el) => {
        const fs = el.form.querySelector('[data-role-only="PADRE"]');
        if (fs) fs.hidden = el.value !== ROLES.PADRE;
    },
};

const SUBMITS = {
    login: async (form) => {
        const email = form.email.value.trim();
        const password = form.password.value;
        if (!form.checkValidity()) return form.reportValidity();
        hideAllPasswords();
        const btn = form.querySelector('[type=submit]');
        btn.classList.add('is-loading'); btn.disabled = true;
        showLoginError('');
        try { await signInWithEmailAndPassword(auth, email, password); }
        catch (e) { showLoginError(authErrorMsg(e)); }
        finally { btn.classList.remove('is-loading'); btn.disabled = false; }
    },
    profile: async (form) => {
        if (!form.checkValidity()) return form.reportValidity();
        const btn = form.querySelector('[type=submit]');
        btn.classList.add('is-loading'); btn.disabled = true;
        const ok = await mutate('updateProfile', {
            Nombre: form.Nombre.value, FechaNacimiento: form.FechaNacimiento.value, Grado: form.Grado.value,
        }, 'Perfil actualizado.');
        if (ok) renderChrome();
        else { btn.classList.remove('is-loading'); btn.disabled = false; }
    },
    enrollment: (form) => saveEnrollment(form),
    mensaje: (form) => enviarEnConversacion(form),
    'change-password': async (form) => {
        const err = form.querySelector('.form-error');
        const fail = (msg) => { err.textContent = msg; err.hidden = false; };
        err.hidden = true;
        const p1 = form.p1.value;
        const problema = passwordProblem(p1);
        if (problema) return fail(problema);
        if (p1 !== form.p2.value) return fail('Las contraseñas no coinciden.');

        const btn = form.querySelector('[type=submit]');
        btn.classList.add('is-loading'); btn.disabled = true;
        try {
            await updatePassword(auth.currentUser, p1);
            // El servidor confirma el cambio consultando a Firebase, no confía en el navegador.
            await api('passwordChanged', {}, { forceRefresh: true });
            form.reset();
            toast('Contraseña actualizada. ¡Bienvenido!', 'success');
            await bootSession(true);
        } catch (e) {
            if (e.code === 'auth/requires-recent-login') {
                fail('Por seguridad, vuelve a iniciar sesión con la contraseña temporal y cámbiala de inmediato.');
                setTimeout(() => signOut(auth), 3000);
            } else if (e.code === 'auth/weak-password') {
                fail('Esa contraseña es demasiado débil. Elige otra.');
            } else {
                fail(String(e.code || '').startsWith('auth/') ? authErrorMsg(e) : (e.message || authErrorMsg(e)));
            }
        } finally {
            btn.classList.remove('is-loading'); btn.disabled = false;
        }
    },
};

/** Muestra u oculta la contraseña del campo asociado al botón del ojo. */
function setPasswordVisible(btn, visible) {
    const input = btn.closest('.password-field')?.querySelector('input');
    if (!input) return;
    input.type = visible ? 'text' : 'password';
    btn.innerHTML = ico(visible ? 'eye-off' : 'eye');
    btn.setAttribute('aria-pressed', String(visible));
    const label = visible ? 'Ocultar contraseña' : 'Mostrar contraseña';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    input.focus({ preventScroll: true });
}

/** Vuelve a ocultar todas las contraseñas (al enviar o cambiar de pantalla). */
function hideAllPasswords() {
    $$('.password-toggle[aria-pressed="true"]').forEach(btn => {
        const input = btn.closest('.password-field')?.querySelector('input');
        if (input) input.type = 'password';
        btn.innerHTML = ico('eye');
        btn.setAttribute('aria-pressed', 'false');
        btn.setAttribute('aria-label', 'Mostrar contraseña');
        btn.title = 'Mostrar contraseña';
    });
}

function passwordProblem(pw) {
    if (pw.length < CONFIG.MIN_CLAVE) return `Debe tener al menos ${CONFIG.MIN_CLAVE} caracteres.`;
    if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(pw) || !/\d/.test(pw)) return 'Debe combinar letras y números.';
    const local = String(auth.currentUser?.email || '').split('@')[0].toLowerCase();
    if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'No uses tu correo dentro de la contraseña.';
    if (/^(.)\1+$/.test(pw) || /1234567|abcdefg|qwerty|password|contrase/i.test(pw)) return 'Esa contraseña es demasiado fácil de adivinar.';
    return '';
}

// Al pasar de celular a escritorio (o al revés) el menú toma el estado que corresponde.
matchMedia('(min-width: 961px)').addEventListener('change', () => {
    $('#screen-app').classList.remove('sidebar-open');
    if (state.me) aplicarMenuOculto();
});

document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.action];
    if (!fn) return;
    ev.preventDefault();
    fn(el, ev);
});
document.addEventListener('input', (ev) => {
    const el = ev.target.closest('[data-input]');
    if (el) INPUTS[el.dataset.input]?.(el, ev);
});
document.addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-change]');
    if (el) CHANGES[el.dataset.change]?.(el, ev);
});
document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('form[data-submit]');
    if (!form) return;
    ev.preventDefault();
    SUBMITS[form.dataset.submit]?.(form, ev);
});

// Libro de calificaciones: Enter baja a la siguiente fila (misma evaluación).
document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || !ev.target.matches?.('.grade-input')) return;
    ev.preventDefault();
    const inputs = $$(`.grade-input[data-item="${CSS.escape(ev.target.dataset.item)}"]`);
    const next = inputs[inputs.indexOf(ev.target) + (ev.shiftKey ? -1 : 1)];
    if (next) { next.focus(); next.select(); }
});

// ==========================================================================
// 12. AUTENTICACIÓN Y ARRANQUE
// ==========================================================================

function authErrorMsg(e) {
    const map = {
        'auth/invalid-credential': 'Correo o contraseña incorrectos.',
        'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
        'auth/wrong-password': 'Correo o contraseña incorrectos.',
        'auth/user-not-found': 'Correo o contraseña incorrectos.',
        'auth/invalid-email': 'El correo no es válido.',
        'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e intenta de nuevo.',
        'auth/network-request-failed': 'Sin conexión. Revisa tu internet.',
        'auth/user-disabled': 'Esta cuenta está deshabilitada.',
    };
    if (!map[e?.code]) console.error('[Plataforma] Error de autenticación:', e);
    return map[e?.code] || 'No se pudo completar la operación. Intenta de nuevo.';
}

function showLoginError(msg) {
    const el = $('#login-form .form-error');
    el.textContent = msg;
    el.hidden = !msg;
}

function showDenied(title, text, actionsHtml = '') {
    $('#denied-title').textContent = title;
    $('#denied-text').textContent = text;
    $('#denied-actions').innerHTML = actionsHtml;
    showScreen('denied');
}

function showPasswordScreen() {
    $('#password-email').textContent = auth.currentUser?.email || '';
    $('#password-form .form-error').hidden = true;
    showScreen('password');
}

async function bootSession(forceRefresh = false) {
    showScreen('loading');
    $('#loading-text').textContent = 'Cargando tu información…';
    try {
        await loadSnapshot({ forceRefresh });
        if (state.me.DebeCambiarClave === 'SI') return showPasswordScreen();
        renderChrome();
        showScreen('app');
        if (!location.hash || !VIEWS[parseHash().view]) history.replaceState(null, '', `#/${HOME[state.me.Rol]}`);
        render();
        escucharCambios();
    } catch (e) {
        if (e.code === 'NOT_REGISTERED') {
            showDenied('Cuenta sin acceso', `${auth.currentUser?.email || ''} no está registrado en la Plataforma Educativa. Solicita tu acceso a la administración.`);
        } else if (e.code === 'EMAIL_NOT_VERIFIED') {
            showDenied('Verifica tu correo', `Para activar la cuenta de tutor, verifica ${auth.currentUser?.email}. Luego presiona "Ya verifiqué".`,
                `<button class="btn btn-primary btn-block" data-action="resend-verification">Enviar correo de verificación</button>
                 <button class="btn btn-ghost btn-block" data-action="retry-session">Ya verifiqué</button>`);
        } else {
            // Solo se muestran mensajes propios; un error técnico (TypeError, etc.) va a la consola.
            if (!(e instanceof ApiError)) console.error('[Plataforma] Error al cargar la sesión:', e);
            showDenied('No se pudo conectar', e instanceof ApiError ? e.message : MSG.BAD_RESPONSE,
                '<button class="btn btn-primary btn-block" data-action="retry-session">Reintentar</button>');
        }
    }
}

// Cierre de sesión automático por inactividad (equipos compartidos en colegios o cafés internet).
let lastActivity = Date.now();
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(type =>
    window.addEventListener(type, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
setInterval(() => {
    if (!auth.currentUser || Date.now() - lastActivity < CONFIG.INACTIVIDAD_MIN * 60000) return;
    discardDrafts();
    signOut(auth);
    toast(`Tu sesión se cerró tras ${CONFIG.INACTIVIDAD_MIN} minutos de inactividad.`, 'info', 10000);
}, 30000);

onAuthStateChanged(auth, (user) => {
    state.user = user;
    lastActivity = Date.now();
    if (!user) {
        dejarDeEscuchar();
        state.me = null;
        state.db = emptyDb();
        discardDrafts();
        $('#login-form').reset();
        showScreen('login');
        return;
    }
    bootSession();
});
