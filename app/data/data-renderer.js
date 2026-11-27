import { storageBackendText } from './data-storage.js';
import { isVisibleRestorePoint } from '../shared/snapshot-archive.js';
import { snapshotTitle, snapshotTime } from './data-restoration.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';
import { PROBELAUF_RESTORE_HINT } from '../shared/probelauf-runtime.js';

const date = raw => new Date(raw).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const bytes = value => value === null || value === undefined ? 'nicht verfügbar' : value > 0 && value < 100000 ? '< 0,1 MB' : formatDisplayNumber(value / 1000000, { fractionDigits: 1 }) + ' MB';
const day = raw => new Date(raw).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const count = (value, one, many) => `${value} ${value === 1 ? one : many}`;
const AREA_NAMES = Object.freeze({ plan: 'Haushalt & Plan', income: 'Einkünfte', partnership: 'Partnerschaft und Erbe', care: 'Pflege' });
const list = (/** @type {string[]} */ items) => items.length > 1
    ? `${items.slice(0, -1).join(', ')} ${items.some(item => item.includes(' und ')) ? 'sowie' : 'und'} ${items.at(-1)}` : items[0] || '';
const DATIVE = Object.freeze(/** @type {Record<string, string>} */ ({ 'Monatsabschlüsse': 'Monatsabschlüssen', 'Tagesgeld-Einträge': 'Tagesgeld-Einträgen', 'Einkünfte': 'Einkünften' }));

/** Gemeinsame Auswertung für Text und Überschrift: genannte Änderungen, geprüfte und nicht feststellbare Bereiche.
 * @param {any} changes */
function backupChangeParts(changes) {
    const names = { months: ['Monatsabschluss', 'Monatsabschlüsse'], cash: ['Tagesgeld-Eintrag', 'Tagesgeld-Einträge'], tranches: ['Tranche', 'Tranchen'] };
    const parts = [];
    for (const key of Object.keys(names)) {
        const change = changes?.[key] || {};
        for (const [field, label] of [['added', 'neu'], ['changed', 'geändert'], ['removed', 'entfernt']]) {
            if (change[field]) parts.push(`${count(change[field], .../** @type {[string,string]} */ (names[/** @type {keyof typeof names} */ (key)]))} ${label}`);
        }
    }
    const areas = changes?.areas || null;
    const areaKeys = /** @type {(keyof typeof AREA_NAMES)[]} */ (Object.keys(AREA_NAMES));
    const changedAreas = areas ? areaKeys.filter(key => areas[key] === 'changed').map(key => AREA_NAMES[key]) : [];
    const unknownAreas = areas ? areaKeys.filter(key => areas[key] === 'unknown').map(key => AREA_NAMES[key]) : areaKeys.map(key => AREA_NAMES[key]);
    if (changedAreas.length) parts.push(`${list(changedAreas)} geändert`);
    const checked = ['Monatsabschlüsse', 'Tagesgeld-Einträge', 'Tranchen', ...areaKeys.filter(key => !unknownAreas.includes(AREA_NAMES[key])).map(key => AREA_NAMES[key])];
    return { parts, checked, unknownAreas };
}

/** GH-1 Punkt 5 (F-06): Änderungen seit der letzten Sicherung, auch an Haushalts- und Planwerten. Kennt die alte Sicherung (Version 1) diese
 * Bereiche nicht, heißt es „seit der letzten Sicherung nicht feststellbar“ statt einer Entwarnung.
 * @param {any} changes @returns {string} */
export function backupChangesText(changes) {
    const { parts, checked, unknownAreas } = backupChangeParts(changes);
    const unknown = unknownAreas.length ? ` ${list(unknownAreas)}: seit der letzten Sicherung nicht feststellbar.` : '';
    return parts.length ? `${parts.join(', ')}. Geprüft: ${list(checked)}.${unknown}`
        : `Keine Änderungen in ${list(checked.map(name => DATIVE[name] || name))}.${unknown}`;
}

/** AK-1: Die Überschrift passt zum Text darunter. „geändert:“ nur, wenn der Text Änderungen nennt; „unverändert“ nur,
 * wenn alle Bereiche geprüft sind. Ohne Sicherung oder mit nicht feststellbaren Bereichen bleibt die allgemeine Überschrift.
 * @param {any} changes @returns {string} */
export function backupChangesTitle(changes) {
    if (!changes) return 'Vollsicherung als Datei';
    const { parts, unknownAreas } = backupChangeParts(changes);
    return parts.length ? 'Seit der letzten Sicherung geändert:'
        : unknownAreas.length ? 'Vollsicherung als Datei' : 'Seit der letzten Sicherung unverändert';
}

/** ST7-FIX (Gutachten ST7 P2-1, Befund 1047): Der Kopf nennt, was eingespielt wurde. Nur eine Vollsicherung trägt ihr Dateidatum als
 * Sicherungszeit. Bei einer Übergabe- oder Wiederherstellungsdatei folgt die letzte Vollsicherung wie auf der Karte.
 * @param {import("../../typcheck/data-ui.js").DataModel} model @param {{at: string, importedAt: string}} imported @returns {string} */
function backupImportText(model, imported) {
    const when = `vom ${day(imported.at)} eingespielt am ${day(imported.importedAt)}`;
    if (model.lastBackup && Date.parse(model.lastBackup) === Date.parse(imported.at)) return `Sicherung ${when}`;
    return `Datei ${when} · ${model.lastBackup ? `letzte Vollsicherung: ${day(model.lastBackup)}`
        : model.backupUnknown ? 'Sicherungszeit unbekannt' : 'noch keine Vollsicherung'}`;
}

/**
 * @param {Document} doc
 * @param {import("../../typcheck/data-ui.js").DataModel} model
 * @returns {void} Aktualisierte Datenanzeige.
 */
export function renderDataPage(doc, model) {
    const set = (id, text) => { const host = doc.getElementById(id); if (host) host.textContent = text; };
    const warning = model.age.warning;
    const backupState = model.trialActive || model.backupUnknown ? 'unknown' : warning ? 'warning' : model.lastBackup ? 'ok' : 'unknown';
    for (const id of ['dataBackupTile', 'dataBackupBox', 'dataBackupContextChip']) {
        const node = doc.getElementById(id); if (node) node.dataset.state = backupState;
    }
    const days = model.age.days === null ? null : Math.floor(model.age.days);
    const ageText = model.trialActive ? 'Im Spielbereich gesperrt'
        : days === null ? (model.backupUnknown ? 'Sicherungszeit unbekannt' : 'Noch keine Vollsicherung') : days === 0 ? 'heute' : days === 1 ? 'gestern' : `vor ${days} Tagen`;
    set('dataBackupAge', ageText);
    for (const id of ['fullBackupBtn', 'fullBackupImportBtn']) {
        const button = /** @type {HTMLButtonElement} */ (doc.getElementById(id));
        if (model.trialActive || button.dataset.trialBlocked === 'true') button.disabled = Boolean(model.trialActive);
        button.dataset.trialBlocked = String(Boolean(model.trialActive));
    }
    set('dataBackupReason', model.trialActive ? 'Im Spielbereich nicht möglich. Deine echten Daten bleiben unverändert.' : '');
    doc.getElementById('dataBackupReason').hidden = !model.trialActive;
    // Eine nur angestoßene Sicherung zählt, die Ablage hat aber niemand bestätigt.
    const triggered = Boolean(model.lastBackup) && model.backupDelivery === 'angestossen';
    set('dataBackupDate', model.trialActive ? 'Deine echten Daten bleiben unverändert.' : model.lastBackup ? date(model.lastBackup) + (triggered ? ' · Sicherung angestoßen – bitte Ablage prüfen' : '') : model.backupUnknown ? 'Sicherungsdatum nicht verlässlich lesbar.' : 'Sichere deine Daten als Datei.');
    set('dataBackupTitle', backupChangesTitle(model.changes));
    set('dataBackupContext', model.trialActive ? 'Vollsicherung im Spielbereich gesperrt'
        : model.backupImport ? backupImportText(model, model.backupImport)
        : model.lastBackup ? (triggered ? 'Sicherung angestoßen am ' : 'Gesichert am ') + day(model.lastBackup) : ageText);
    set('dataHouseholdContext', model.householdNames ? 'Haushalt: ' + (model.householdNames.join(' + ') || 'Noch keine Personen') : 'Haushalt: nicht verfügbar');
    set('dataBackupChanges', model.changes ? backupChangesText(model.changes) : '');
    const backupChanges = doc.getElementById('dataBackupChanges');
    if (backupChanges) backupChanges.hidden = !model.changes;
    const content = doc.getElementById('dataContent'); content.replaceChildren();
    if (model.counts) {
        const c = model.counts, years = model.expenseYears || [];
        const contiguous = years.length > 1 && years.every((year, i) => !i || year === years[i - 1] + 1);
        const labels = [c.persons ? count(c.persons, 'Person', 'Personen') : null,
            c.tranches ? count(c.tranches, 'Tranche', 'Tranchen') : null,
            years.length ? 'Ausgaben ' + (contiguous ? `${years[0]}–${years.at(-1)}` : years.join(', ')) : null,
            model.hasCashHistory ? 'Tagesgeld-Historie' : null, c.prices ? count(c.prices, 'Tageskurs', 'Tageskurse') : null,
            model.hasPlans ? 'Pläne & Annahmen' : null];
        for (const label of labels.filter(Boolean)) { const chip = doc.createElement('span'); chip.textContent = label; content.appendChild(chip); }
        if (!content.children.length) content.textContent = 'Noch keine Fachdaten vorhanden.';
    } else content.textContent = 'Inhalt nicht verlässlich lesbar.';
    set('dataModelTechnical', model.error || '');
    set('dataTechnicalProfile', model.activeProfileId ? `Profil-Kennung: ${model.activeProfileId}` : 'Profil-Kennung nicht verfügbar');
    renderRestorePoints(doc, model);
    bindInfoPopovers(doc);
    const coverage = model.priceCoverage;
    const state = coverage?.state || 'unknown';
    const unusable = coverage?.unreadable || coverage?.missingHistory || coverage?.usableQuoteCount < coverage?.quoteCount;
    const priceState = unusable ? 'error' : state === 'offline' || state === 'partial' || coverage?.openIntervals > 0 ? 'warning' : state;
    doc.getElementById('dataPriceTile').dataset.state = priceState;
    const failed = state === 'offline' && coverage?.serviceReport?.kind !== 'health';
    set('dataPriceCount', unusable ? coverage.unreadable ? 'Kursdaten nicht lesbar' : 'Kursdaten fehlen oder sind unbrauchbar'
        : coverage?.total === null || !coverage ? 'Nicht verfügbar'
            : state === 'offline' ? failed ? 'Letzter Kursabruf fehlgeschlagen' : 'Kursdienst nicht erreichbar'
                : state === 'current' || state === 'partial' ? `${coverage.updatedCount} von ${coverage.quoteCount} aktuell` : 'Kurslage unbekannt');
    const gaps = coverage?.openIntervals === null || !coverage ? 'Lücken unbekannt'
        : coverage.openIntervals ? count(coverage.openIntervals, 'offener Zeitraum', 'offene Zeiträume') : 'keine Lücken';
    const priceTime = coverage?.quoteAt ? 'Gespeicherte Kurse vom ' + day(coverage.quoteAt) : 'Gespeicherter Kursstand unbekannt';
    const dailyStatus = coverage?.total === null || !coverage ? 'Tageskurse nicht verfügbar'
        : coverage.missingHistory ? 'Tageskurse fehlen'
            : coverage.issues?.length ? 'Tageskurse teilweise nicht prüfbar'
                : coverage.openIntervals === 0 ? 'Tageskurse vollständig' : gaps;
    set('dataPriceDetail', `${priceTime} · ${dailyStatus}`);
    // Die Auswirkung steht einmal in der Statuskachel; die Dienstzeile bleibt neutral.
    const serviceText = doc.getElementById('dataPriceServiceText');
    serviceText.hidden = state === 'offline';
    set('dataPriceServiceText', state === 'offline' ? '' : coverage?.serviceReport?.status === 'available'
        ? 'Dienst erreichbar (keine Kursaktualisierung)' : 'Eine Dienstprüfung ruft keine neuen Kurse ab.');
    if (coverage?.serviceReport?.status === 'offline') {
        const action = doc.getElementById('dataPriceActionStatus');
        if (action.textContent === 'Kursdienst nicht erreichbar. Bitte versuche es später erneut.') action.textContent = '';
        else action.textContent = action.textContent.replace('Nachladen: Kursdienst nicht erreichbar · ', 'Nachladen: ');
    }
    set('dataPriceIntroduction', coverage?.startDate
        ? `Aktuelle Kurse holt die App beim Öffnen, in der EXE werktags von 8 bis 22 Uhr zusätzlich alle 15 Minuten, solange Übersicht oder Personen & Vermögen offen sind (nicht im Spielbereich). Tageskurse für den Vermögensverlauf seit ${day(coverage.startDate)} holt sie nur für fehlende Tage.`
        : 'Aktuelle Kurse holt die App beim Öffnen, in der EXE werktags von 8 bis 22 Uhr zusätzlich alle 15 Minuten, solange Übersicht oder Personen & Vermögen offen sind (nicht im Spielbereich). Für Tageskurse im Vermögensverlauf fehlt noch ein verlässlicher Beginn.');
    const intervals = items => items.map(([a, b]) => a === b ? day(a) : `${day(a)} – ${day(b)}`).join(', ');
    set('dataPriceIssues', [coverage?.attemptedAt ? 'Letzter Versuch: ' + date(coverage.attemptedAt) : 'Versuchszeit unbekannt',
        ...(coverage?.issues || []), ...(coverage?.rows || []).map(row =>
        `${row.symbol}: angefordert ${intervals(row.requested) || 'unbekannt'}; offen ${row.gaps === null ? 'unbekannt' : intervals(row.gaps) || 'keine'}${row.error ? '; ' + row.error : ''}`)].join(' · '));
    const rows = doc.getElementById('dataPriceRows'); rows.replaceChildren();
    for (const row of coverage?.rows || []) {
        const tr = doc.createElement('tr');
        for (const text of [row.names, row.symbol, String(row.count), row.first ? day(row.first) : 'noch keine',
            row.gaps === null ? 'unbekannt' : row.gaps.length ? count(row.gaps.length, 'offener Zeitraum', 'offene Zeiträume')
                : row.confirmed ? 'keine' : 'noch nicht fällig']) {
            const cell = doc.createElement('td'); cell.textContent = text; tr.appendChild(cell);
        }
        rows.appendChild(tr);
    }
    if (!coverage?.rows?.length) {
        const tr = doc.createElement('tr'), cell = doc.createElement('td'); cell.colSpan = 5;
        cell.textContent = 'Keine Wertpapiere mit Ticker oder gespeicherten Tageskursen.'; tr.appendChild(cell); rows.appendChild(tr);
    }
    const fetchButton = doc.getElementById('dataPriceFetch');
    // Laufende Jobs behalten die Sperre auch bei einer parallelen lesenden Aktualisierung.
    if (doc.getElementById('dataPriceCancel').hidden) fetchButton.disabled = !(coverage?.openIntervals > 0) || Boolean(model.error);
    const complete = model.totalBytes !== null && model.totalBytes !== undefined;
    set('dataStorageSize', complete ? bytes(model.totalBytes) : 'Nicht verfügbar');
    set('dataStorageTotal', complete ? bytes(model.totalBytes) + ' lokal gespeichert' : 'Speichergröße nicht vollständig verfügbar');
    const storageTile = doc.getElementById('dataStorageTile'); if (storageTile) storageTile.dataset.state = complete ? 'ok' : 'unknown';
    set('dataStorageSummary', complete ? 'Daten auf diesem Rechner' : model.knownBytes === null || model.knownBytes === undefined
        ? 'Datengröße nicht verlässlich lesbar.' : bytes(model.knownBytes) + ' bekannt · Teilgröße unbekannt');
    set('dataStorageBackend', 'Alle Daten liegen auf diesem Rechner – nichts in einer Cloud.');
    set('dataStorageTechnical', [storageBackendText(model.backend, doc.defaultView?.location?.origin),
        Number.isInteger(model.recordCount) ? `Gespeicherte Einträge: ${model.recordCount}` : null,
        model.migrationWarning ? `Hinweis zur Wiederherstellung: ${model.migrationWarning.message}` : null,
        model.liveError, model.priceError, model.archiveError].filter(Boolean).join(' · '));
    const legend = doc.getElementById('dataStorageDetail'); legend.replaceChildren();
    for (const [label, value] of [['Fachdaten', model.liveBytes], ['Tageskurse', model.priceBytes], ['Wiederherstellungspunkte', model.archiveBytes]]) {
        const entry = doc.createElement('span'); entry.className = 'data-storage-category';
        entry.textContent = `${label} ${bytes(/** @type {number|null} */ (value))}`; legend.appendChild(entry);
    }
}

/** SV-1: Eine Liste ohne Gruppen und Zähler; jeder lesbare Punkt lässt sich zurückholen, beschädigte nicht.
 * @param {Document} doc @param {import("../../typcheck/data-ui.js").DataModel} model */
function renderRestorePoints(doc, model) {
    const notice = doc.getElementById('dataRestorePointsNotice');
    if (notice) notice.hidden = !model.restoreNotice;
    const list = doc.getElementById('dataSnapshotList'); list.replaceChildren();
    const empty = text => { const item = doc.createElement('li'); item.className = 'data-muted'; item.textContent = text; list.appendChild(item); };
    if (model.trialActive) { empty(PROBELAUF_RESTORE_HINT); return; }
    if (model.archiveError) {
        doc.getElementById('dataRestoreStatus').textContent = 'Frühere Stände sind nicht verlässlich lesbar. Zurückholen bleibt gesperrt.';
        doc.getElementById('dataRestoreTechnical').textContent = model.archiveError;
        return;
    }
    const points = model.snapshots.filter(isVisibleRestorePoint)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.id).localeCompare(String(a.id)));
    if (!points.length) { empty('Noch keine Wiederherstellungspunkte.'); return; }
    const damaged = new Set(model.damagedSnapshotIds || []);
    for (const point of points) {
        const item = doc.createElement('li'); item.className = 'data-timeline-row';
        const title = doc.createElement('b'); title.textContent = snapshotTitle(point);
        const detail = doc.createElement('span'); detail.className = 'data-muted'; detail.textContent = snapshotTime(point.createdAt);
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'data-text-action data-restore-action';
        button.dataset.restorePoint = point.id; button.textContent = 'Zurückholen …';
        item.append(title, detail);
        if (damaged.has(point.id)) {
            button.disabled = true;
            const hint = doc.createElement('span'); hint.className = 'data-muted data-point-blocked'; hint.textContent = 'beschädigt – nicht zurückholbar';
            item.appendChild(hint);
        }
        item.appendChild(button); list.appendChild(item);
    }
}
