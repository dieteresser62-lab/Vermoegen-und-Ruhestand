/** Die Bridge enthält keine Zielparameter: das native Programm bestimmt den Ordner. */
export function createPersistenceLocation({ win = globalThis.window, invoke = win?.__TAURI__?.core?.invoke, desktop = Boolean(win?.__TAURI__ || win?.__TAURI_INTERNALS__) } = {}) {
    const available = typeof invoke === 'function';
    return {
        mode: available ? 'desktop' : desktop ? 'unavailable' : 'browser',
        async read() {
            if (!available) return { status: desktop ? 'unavailable' : 'browser', path: null };
            try {
                const path = await invoke('get_app_data_directory');
                if (typeof path !== 'string' || !path.trim() || /[\u0000-\u001f]/.test(path)) throw new Error('Ungültige Ordnerauskunft.');
                return { status: 'ready', path };
            } catch (error) { return { status: 'error', path: null, error: String(error?.message || error) }; }
        },
        async open() {
            if (!available) return { status: desktop ? 'unavailable' : 'browser' };
            try { await invoke('open_app_data_directory'); return { status: 'opened' }; }
            catch (error) { return { status: 'error', error: String(error?.message || error) }; }
        }
    };
}
export async function bindPersistenceLocation(doc, options = {}) {
    const service = createPersistenceLocation(options), button = doc.getElementById('dataStorageOpen'), host = doc.getElementById('dataStorageLocation');
    if (!button || !host) return;
    const status = doc.getElementById('dataStorageLocationStatus'), detail = doc.getElementById('dataStorageLocationTechnical');
    const set = (node, text) => { if (node) node.textContent = text; };
    button.hidden = true; button.disabled = true;
    const report = await service.read();
    const locationDetails = doc.getElementById('dataStorageLocationDetails');
    if (locationDetails) locationDetails.hidden = report.status !== 'ready';
    host.hidden = report.status !== 'ready';
    host.textContent = report.status === 'ready' ? report.path : '';
    set(status, report.status === 'error' || report.status === 'unavailable' ? 'Der Datenordner ist gerade nicht zugänglich.' : '');
    set(detail, report.status === 'browser' ? 'Der Browser verwaltet die Daten für diese Adresse; ein Dateipfad ist nicht verfügbar.'
        : report.status === 'ready' ? 'Die Desktop-App verteilt die Daten auf zwei Dateien im bestätigten App-Datenordner.'
            : report.error || 'Die Verbindung zur Desktop-App ist nicht verfügbar.');
    if (report.status !== 'ready') return;
    button.hidden = false; button.disabled = false;
    button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        const opened = await service.open();
        set(status, opened.status === 'opened' ? 'Ordneröffnung angestoßen.' : 'Der Ordner konnte nicht geöffnet werden. Versuche es erneut.');
        if (opened.status !== 'opened') set(detail, opened.error || 'Die Ordneröffnung wurde nicht bestätigt.');
        button.disabled = false;
    });
}
