import { storageBackendText } from './data-storage.js';
import { snapshotOccasion } from '../shared/snapshot-retention.js';
import { snapshotTitle, snapshotBlockReason } from './data-snapshot-presentation.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { bindInfoPopovers } from '../shared/designsystem-info-popover.js';

const date = raw => new Date(raw).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const bytes = value => value === null || value === undefined ? 'nicht verfügbar' : formatDisplayNumber(value / 1000000, { fractionDigits: 1 }) + ' MB';
const day = raw => new Date(raw).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const count = (value, one, many) => `${value} ${value === 1 ? one : many}`;
export function renderDataPage(doc, model) {
    const set = (id, text) => { const host = doc.getElementById(id); if (host) host.textContent = text; };
    const warning = model.age.warning;
    const backupState = model.backupUnknown ? 'unknown' : warning ? 'warning' : model.lastBackup ? 'ok' : 'unknown';
    for (const id of ['dataBackupTile', 'dataBackupBox', 'dataBackupContextChip']) {
        const node = doc.getElementById(id); if (node) node.dataset.state = backupState;
    }
    const days = model.age.days === null ? null : Math.floor(model.age.days);
    const ageText = days === null ? (model.backupUnknown ? 'Sicherungszeit unbekannt' : 'Noch keine Vollsicherung') : days === 0 ? 'heute' : `vor ${count(days, 'Tag', 'Tagen')}`;
    set('dataBackupAge', ageText);
    set('dataBackupDate', model.lastBackup ? date(model.lastBackup) : model.backupUnknown ? 'Sicherungsdatum nicht verlässlich lesbar.' : 'Sichere deine Daten als Datei.');
    set('dataBackupTitle', model.changes ? 'Seit der letzten Sicherung geändert:' : 'Vollsicherung als Datei');
    set('dataBackupContext', model.lastBackup ? 'Gesichert am ' + day(model.lastBackup) : ageText);
    set('dataHouseholdContext', model.householdNames ? 'Haushalt: ' + (model.householdNames.join(' + ') || 'Noch keine Personen') : 'Haushalt: nicht verfügbar');
    const names = { months: ['Monatsabschluss', 'Monatsabschlüsse'], cash: ['Tagesgeld-Eintrag', 'Tagesgeld-Einträge'], tranches: ['Tranche', 'Tranchen'] };
    const changes = [];
    for (const [key, change] of Object.entries(model.changes || {})) {
        for (const [field, label] of [['added', 'neu'], ['changed', 'geändert'], ['removed', 'entfernt']]) {
            if (change[field]) changes.push(`${count(change[field], ...names[key])} ${label}`);
        }
    }
    set('dataBackupChanges', model.changes ? changes.length
        ? changes.join(', ') + '. Geprüft: Monatsabschlüsse, Tagesgeld-Einträge und Tranchen.'
        : 'Keine Änderungen in Monatsabschlüssen, Tagesgeld-Einträgen und Tranchen.' : '');
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
    const snapshotTile = doc.getElementById('dataSnapshotTile');
    const blockedPoints = model.snapshots.filter(point => snapshotBlockReason(point, model)).length;
    if (snapshotTile) snapshotTile.dataset.state = model.archiveError || !model.snapshots.length ? 'unknown' : blockedPoints ? 'warning' : 'ok';
    set('dataSnapshotCount', model.archiveError ? 'Nicht verfügbar' : model.snapshots.length
        ? `${model.snapshots.length - blockedPoints} verfügbar · ${blockedPoints} gesperrt` : '0 Punkte');
    const oldest = model.snapshots.reduce((old, point) => !old || Date.parse(point.createdAt) < Date.parse(old.createdAt) ? point : old, null);
    set('dataSnapshotDetail', model.archiveError ? 'Frühere Stände nicht verlässlich lesbar.' : oldest ? 'Ältester Punkt: ' + day(oldest.createdAt) : 'Noch keine Wiederherstellungspunkte.');
    const preview = doc.getElementById('dataRestorePreview');
    if (preview) { preview.hidden = true; doc.getElementById('dataRestorePreviewHome').appendChild(preview); }
    const list = doc.getElementById('dataSnapshotList'); list.replaceChildren();
    doc.getElementById('dataRetentionPreview').disabled = Boolean(model.archiveError);
    if (model.archiveError) set('dataRestoreStatus', 'Frühere Stände sind nicht verlässlich lesbar. Zurückholen und Aufräumen bleiben gesperrt.');
    set('dataRestoreTechnical', model.archiveError || '');
    for (const point of model.snapshots) {
        const item = doc.createElement('li'); item.className = 'data-timeline-row';
        const title = doc.createElement('b'); title.textContent = snapshotTitle(point);
        const detail = doc.createElement('span'); detail.className = 'data-muted';
        const occasion = snapshotOccasion(point), permanent = occasion.includes('dauerhaft');
        if (permanent) item.dataset.permanent = 'true';
        const time = new Date(point.createdAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
        detail.textContent = `${day(point.createdAt)} · ${time} · ${occasion === 'Manuell' ? 'manuell' : 'automatisch'}`
            + (model.profileIds?.length > 1 && point.activeProfileName?.trim() ? ' · ' + point.activeProfileName.trim() : '');
        item.appendChild(title); item.appendChild(detail);
        if (permanent) { const pill = doc.createElement('span'); pill.className = 'data-permanent-pill'; pill.textContent = 'dauerhaft'; item.appendChild(pill); }
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'data-text-action data-restore-action';
        button.dataset.restorePreview = point.id; button.textContent = 'Zurückholen …'; button.setAttribute('aria-expanded', 'false');
        const reason = snapshotBlockReason(point, model);
        button.disabled = Boolean(reason);
        if (reason && reason !== 'archive') {
            const hint = doc.createElement('span'); hint.className = 'data-muted data-point-blocked';
            hint.textContent = reason === 'probelauf' ? 'Nur über „Spielbereich beenden“ zurückholbar.'
                : reason === 'unassigned' ? 'Personenzuordnung fehlt. Hier nicht zurückholbar.' : 'Person nicht mehr im Bestand. Hier nicht zurückholbar.';
            if (reason !== 'probelauf') {
                const info = doc.createElement('span'); info.className = 'ds-info';
                const infoButton = doc.createElement('button'); infoButton.type = 'button'; infoButton.className = 'ds-info-button'; infoButton.textContent = 'ⓘ';
                infoButton.setAttribute('aria-label', 'Warum ist dieser Punkt gesperrt?');
                const explanation = doc.createElement('span'); explanation.className = 'ds-info-pop';
                explanation.textContent = reason === 'unassigned'
                    ? 'Bei diesem Punkt fehlt die Zuordnung zu einer Person. Du kannst diese Zuordnung hier nicht nachtragen und den Punkt deshalb nicht direkt zurückholen.'
                    : 'Dieser Punkt gehört zu einer Person, die es im aktuellen Bestand nicht mehr gibt. Du kannst ihn hier nicht direkt zurückholen. Eine neu angelegte Person mit demselben Namen hat eine andere Zuordnung und hebt die Sperre nicht auf.';
                info.appendChild(infoButton); info.appendChild(explanation); hint.appendChild(info);
            }
            item.appendChild(hint);
        }
        item.appendChild(button);
        const remove = doc.createElement('button'); remove.type = 'button'; remove.className = 'ds-button ds-button-secondary';
        remove.dataset.deletePoint = point.id; remove.textContent = 'Punkt löschen …'; remove.disabled = Boolean(model.archiveError);
        const more = doc.createElement('details'); more.className = 'data-point-more';
        const summary = doc.createElement('summary'); summary.textContent = 'Weitere Aktionen';
        more.appendChild(summary); more.appendChild(remove); item.appendChild(more); list.appendChild(item);
    }
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
        ? `Aktuelle Kurse holt die App beim Öffnen, Tageskurse für den Vermögensverlauf seit ${day(coverage.startDate)} ebenfalls – nur fehlende Tage.`
        : 'Aktuelle Kurse holt die App beim Öffnen. Für Tageskurse im Vermögensverlauf fehlt noch ein verlässlicher Beginn.');
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
        entry.textContent = `${label} ${bytes(value)}`; legend.appendChild(entry);
    }
}
