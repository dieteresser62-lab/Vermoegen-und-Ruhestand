import { wealthInfo, propertyHistoryNotice } from '../app/shared/wealth-display.js';
import { BalanceImportError } from '../app/balance/balance-binder-imports.js';

const previousCash = '<span class="ds-info"><button type="button" class="ds-info-button" aria-label="Aufteilung des Vermögens" aria-expanded="false">i</button><span class="ds-info-pop" role="tooltip"><span class="ds-wealth-allocation"><span>Tagesgeld</span><span class="ds-wealth-amount">100\u00a0€</span><span class="ds-wealth-share">100,0\u00a0%</span></span></span></span>';
const previousEmpty = '<span class="ds-info"><button type="button" class="ds-info-button" aria-label="Aufteilung des Vermögens" aria-expanded="false">i</button><span class="ds-info-pop" role="tooltip">Alle Anlageklassen 0 €</span></span>';
assertEqual(wealthInfo({ cash: 100 }), previousCash, 'Ohne Hinweis bleibt das vorhandene Markup zeichengleich');
assertEqual(wealthInfo({}), previousEmpty, 'Auch die leere Aufteilung bleibt ohne Hinweis zeichengleich');
for (const notice of [undefined, null, '']) {
    assertEqual(wealthInfo({ cash: 100 }, {}, notice), previousCash, 'Ein fehlender oder leerer Hinweis verändert das Markup nicht');
}
const managerNotice = 'Geldvermögen enthält Tagesgeld und Depot; Immobilien zählen zum Gesamtvermögen.';
for (const notice of [managerNotice, propertyHistoryNotice]) {
    const html = wealthInfo({ cash: 100 }, {}, notice);
    assert(html.includes(notice), 'Der übergebene Hinweis erscheint im Popover');
    assert(html.indexOf(notice) > html.indexOf('ds-wealth-share'), 'Der Hinweis folgt unter der Aufteilung');
    assert(html.endsWith(`${notice}</small></span></span>`), 'Der kleine Erklärtext bleibt im selben Popover');
}
assert(wealthInfo({}, {}, managerNotice).includes(managerNotice), 'Auch ohne Bestände erscheint der Hinweis');
const escaped = wealthInfo({ cash: 100 }, {}, '<img src=x onerror="alert(1)"> & Hinweis');
assert(!escaped.includes('<img') && escaped.includes('&lt;img') && escaped.includes('&amp; Hinweis'), 'Hinweistexte werden als Text maskiert');

const cause = new Error('Synthetischer Rollbackfehler');
const message = 'Import und Rollback fehlgeschlagen. Punkt „fs-1-recovery“ unter Daten & Sicherung zurückholen.';
const error = new BalanceImportError('rollback_failed', message, { originalError: cause });
assertEqual(error.message, message, 'Die Nutzermeldung bleibt unverändert');
assertEqual(error.cause, cause, 'Die ursprüngliche Fehlerinstanz bleibt als cause erhalten');
assertEqual(error.code, 'rollback_failed', 'Der Fehlercode bleibt erhalten');
assertEqual(error.name, 'BalanceImportError', 'Der Fehlername bleibt erhalten');
assertEqual(Object.getOwnPropertyDescriptor(error, 'cause')?.enumerable, false, 'cause verwendet die nicht aufzählbare Standard-Error-Eigenschaft');
assert(!Object.hasOwn(new BalanceImportError('dry_run_failed', 'Unverändert'), 'cause'), 'Ohne Diagnoseparameter wird keine cause ergänzt');
