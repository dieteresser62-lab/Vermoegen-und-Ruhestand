export const CANDIDATE_IDENTIFIER = 'com.dieter.ruhestandsapp.kandidat';

/** Erkannte Laufzeiten sind unabhängig von Kennung und URL-Parametern verfügbar. */
export async function resolveProbelaufRuntime({ win = globalThis.window, state = null } = {}) {
    const tauri = Boolean(win && ('__TAURI__' in win || '__TAURI_INTERNALS__' in win || '__TAURI_METADATA__' in win));
    if (tauri) {
        let identifier = null;
        try { identifier = await win.__TAURI__?.app?.getIdentifier?.(); } catch { /* Kennung ist nur Laufzeitinformation. */ }
        return { kind: 'tauri', identifier, canStart: true, canContinue: true, canRecover: true };
    }
    let url;
    try { url = new URL(win?.location?.href); } catch { return { kind: 'unknown', canStart: false, canContinue: false, canRecover: false }; }
    const browser = ['http:', 'https:', 'file:'].includes(url.protocol);
    return { kind: browser ? 'browser' : 'unknown', canStart: browser, canRecover: browser, canContinue: browser };
}
