import { isTauriRuntime } from './runtime-env.js';

// SD-1: Gemeinsamer Weg für Sicherungen und Exporte. Die Desktop-App öffnet den Windows-Dialog „Speichern unter“
// (Befehl `save_file_with_dialog` in src-tauri). Der Browser lädt die Datei wie bisher herunter.

/** Meldungen, wenn der Nutzer den Dialog ohne Speichern schließt. */
export const SAVE_CANCELLED_TEXT = 'Speichern abgebrochen – keine Datei erstellt.';
export const BACKUP_SAVE_CANCELLED_TEXT = 'Speichern abgebrochen – keine Sicherung erstellt.';

/** @typedef {{saved: true, path: string|null} | {saved: false}} SaveResult */
/** @typedef {(command: string, args: Record<string, unknown>) => Promise<unknown>} TauriInvoke */

/**
 * @param {string} filename
 * @returns {string[]}
 */
function extensionOf(filename) {
    const match = /\.([A-Za-z0-9]+)$/.exec(filename);
    return match ? [match[1].toLowerCase()] : [];
}

/**
 * @param {any} win
 * @returns {TauriInvoke}
 */
function tauriInvoke(win) {
    const invoke = win?.__TAURI__?.core?.invoke;
    if (typeof invoke !== 'function') throw new Error('Speichern in der Desktop-App ist nicht verfügbar (Tauri invoke fehlt).');
    return invoke;
}

/**
 * Bisheriger Browserweg: Blob, Link mit `download`, Klick. Läuft synchron.
 * @param {{filename: string, content: string, mime: string, doc: Document, urlApi: typeof URL, BlobCtor: typeof Blob}} options
 * @returns {void}
 */
function browserDownload({ filename, content, mime, doc, urlApi, BlobCtor }) {
    if (!doc?.createElement || typeof urlApi?.createObjectURL !== 'function' || typeof BlobCtor !== 'function') {
        throw new Error('Der Browserdownload ist in dieser Umgebung nicht verfügbar.');
    }
    const url = urlApi.createObjectURL(new BlobCtor([content], { type: mime }));
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    try {
        doc.body?.appendChild?.(anchor);
        anchor.click();
    } finally {
        if (typeof anchor.remove === 'function') anchor.remove();
        else doc.body?.removeChild?.(anchor);
        urlApi.revokeObjectURL?.(url);
    }
}

/**
 * Sperrt die freien Knöpfe, bis `saving` erledigt ist; ein Doppelklick öffnet so keinen zweiten Dialog „Speichern unter“.
 * Gibt nur Knöpfe frei, die es selbst gesperrt hat.
 * @template T
 * @param {Array<{disabled: boolean} | null | undefined>} buttons
 * @param {Promise<T>} saving
 * @returns {Promise<T>}
 */
export function lockWhileSaving(buttons, saving) {
    const locked = buttons.filter(button => button && !button.disabled);
    locked.forEach(button => { if (button) button.disabled = true; });
    return saving.finally(() => locked.forEach(button => { if (button) button.disabled = false; }));
}

/**
 * Speichert Text als Datei. Desktop-App: Dialog „Speichern unter“, Ergebnis erst nach dem Schreiben.
 * Browser: Download wie bisher; er startet noch im Aufruf, `path` bleibt null.
 * @param {{filename: string, content: string, mime?: string, filterName?: string, extensions?: string[],
 *   doc?: Document, win?: any, invoke?: TauriInvoke, urlApi?: typeof URL, BlobCtor?: typeof Blob}} options
 * @returns {Promise<SaveResult>} `{saved: false}` heißt: Dialog abgebrochen, nichts geschrieben.
 */
export async function saveTextFile({ filename, content, mime = 'application/octet-stream', filterName, extensions,
    doc = globalThis.document, win = doc?.defaultView ?? globalThis.window, invoke, urlApi = globalThis.URL, BlobCtor = globalThis.Blob }) {
    if (typeof filename !== 'string' || !filename) throw new TypeError('Dateiname fehlt.');
    if (typeof content !== 'string') throw new TypeError('Dateiinhalt muss Text sein.');
    if (invoke || isTauriRuntime(win)) {
        const list = extensions ?? extensionOf(filename);
        let path;
        try {
            path = await (invoke || tauriInvoke(win))('save_file_with_dialog', {
                defaultName: filename, content, filterName: filterName ?? (list.length ? `${list[0].toUpperCase()}-Datei` : null), extensions: list
            });
        } catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
        }
        return typeof path === 'string' && path ? { saved: true, path } : { saved: false };
    }
    browserDownload({ filename, content, mime, doc, urlApi, BlobCtor });
    return { saved: true, path: null };
}
