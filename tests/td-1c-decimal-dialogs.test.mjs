import fs from 'node:fs';
import { createTranchenPageDom, MockElement, createLocalStorageMock, installGlobals, waitFor } from './tranchen-manager-page.test.mjs';
import { openEditTrancheModal, openCreateTrancheModal, resetTrancheForm, cancelTrancheDetails,
    readTrancheFromForm, captureManagerModalSubmission, showTrancheQuoteCheck, revealTrancheSharesCorrection } from '../app/tranches/tranchen-manager-modal.js';
import { bindDecimalInputDisplay, readMoneyText, isMoneyInput } from '../app/tranches/tranchen-manager-decimal-input.js';
import { tqfChoice, correctedTranche, trancheDetailFigures } from '../app/tranches/tranche-detail-model.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { memoryStorage, prepareTrancheDetailWrite } from '../app/tranches/household-sale-writer.js';
import { initTranchenManagerPage } from '../app/tranches/tranchen-manager-page.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { buildTranchenTableHtml } from '../app/tranches/tranchen-manager-renderer.js';
import { closeTrancheModal } from '../app/tranches/tranchen-manager-modal.js';
import { euro } from '../app/tranches/sale-flow-steps.js';
import { exactShares } from '../app/tranches/tranche-detail-view.js';

/* TD-1c, vollständige Breitensuche (Tranchen/Kauf/Verkauf und Personen & Vermögen).
 * Behobene Fundstellen und ihre Rückleser:
 * - tranchen-manager-modal.js: setFieldValue(#tqf) → syncTrancheTypeOptions/renderTqfChoices → tqfChoice
 *   (tranche-detail-model.js); außerdem refreshDetailTax. Versteckter Träger jetzt kanonisch, Leser dezimalfest.
 * - openCreateTrancheModal: vorbelegten tqf vor sync setzen, Auswahl und Steuerfreiheit synchronisieren.
 * - cancelTrancheDetails: Teilfreistellung, Preispräzision, Bestand, Steuerfreiheit und Kursstatus wiederherstellen.
 * - #shares: formSignature, renderTrancheFormPreview, readTrancheFromForm sowie Vorschau/Speichern in
 *   tranchen-manager-page/tranches.js lesen readMoneyText; bindFieldFormats und bindDecimalInputDisplay
 *   formatieren beim Verlassen deutsch ohne Rundung (weder Betragsfeld noch Centformatierung).
 * - tranchen-manager-partnership.js: paint/updateTestament → Erbanteil-Inputlistener;
 *   Number(replace) durch readDecimalInput ersetzt. Testamentbeträge bleiben beim vorhandenen Reader.
 * - tranchen-manager-profiles.js: syncManagerProfileControls/syncPersonSegments lesen Rentensatz und
 *   Kirchensteuersatz mit readDecimalInput statt Number(replace); Vergleiche verwenden kanonische Zahlen.
 * Unbedenkliche Fundstellen, jeweils Darstellung → Rückleser:
 * - tranchen-manager-modal.js: setFieldValue in reset/openCreate/openEdit/acceptTrancheCorrection/cancel,
 *   openCashPostingModal und bindFieldFormats → readTrancheFromForm/readCashPostingForm und formSignature;
 *   Kaufpreis/Kurs mit readDecimalInput samt Feld, Cash mit demselben Adapter; exakter Kaufpreis separat.
 *   Übrige setFieldValue-Felder sind Text, Datum oder feste Kategorie-/Typcodes, keine Dezimalanzeige.
 * - tranchen-manager-decimal-input.js: displayDecimalInput und Fokusadapter → canonicalDecimalInput;
 *   Number folgt erst auf kanonischen Text. Keine parseFloat-Rückleser von Dezimalfeldern gefunden.
 * - tranche-detail-model.js trancheDetailFigures und tranche-detail-view.js renderTrancheDetail lesen
 *   kanonische Records; renderTqfChoices vergleicht Optionszahlen erst nach tqfChoice/readDecimalInput.
 * - buy-flow-steps/dialog.js und sale-flow-steps/dialog.js: keine displayDecimalInput/setFieldValue-Aufrufe;
 *   lokalisierte Stück-/Kurs-/Betragsfelder → parseShares/readMoneyText, parseQuantity/readDecimalInput,
 *   parseMoney/readMoneyText (auch Abrechnung, Vorschlag, Vorbelegung, Tagesgeld). Number liest nur
 *   kanonische Datenattribute, Optionswerte, Plan-/Recordzahlen; Vergleiche folgen auf die Parser.
 * - profile/profile-asset-values.js: applyProfileAssetValuesToDom → readProfileAssetValuesFromDom
 *   mit canonicalDecimalInput vor validateProfileAssetValues; aktives Feld vergleicht kanonische Zahlen.
 * - tranchen-manager-income.js: applyPersonIncomeToDom/Rentenvorbelegung → canonicalDecimalInput
 *   in Editorlistener und Rentensummen; income-fields.js bindEditorCommit verwendet denselben Adapter.
 * - tranchen-manager-planned-expenses.js: createManagerPlannedExpenses/render → canonicalDecimalInput vor Number.
 * - tranchen-manager-immobilien.js: editor/render und Formatierung beim Verlassen/Wiederherstellen →
 *   Editorlistener mit canonicalDecimalInput vor Number, auch ortsübliche Miete und Wiederherstellung.
 * - tranchen-manager-care-values.js: renderManagerCareValues → bindManagerCareValues (canonicalDecimalInput
 *   vor Grenzvergleichen); care.js careResult ebenso. Pflegegrad-Select hat ganzzahlige Optionswerte.
 * - tranchen-manager-testament.js: testamentFields und Vorbelegung aus partnership.js →
 *   readTestamentFields/readDecimalInput mit Feldbindung für Mindestbetrag, ohne Gruppierung für Prozent.
 * - tranchen-manager-cash-metric.js und page/profile-values.js: Vorbelegung/Rücksetzen →
 *   readDecimalInput mit Feld bzw. readProfileAssetValuesFromDom; page/helpers.js managerDecimalSignatureValue
 *   kanonisiert vor Signatur/Number. household-plan.js nutzt readHouseholdPlanField aus shared/household-plan-fields.js.
 * - Übrige Number/parseFloat/Vergleiche in diesen Bereichen lesen kanonische Records, feste Optionswerte,
 *   Datums-/Textcodes oder CSS-Geometrie (tranchen-history-svg.js), keine displayDecimalInput-Ausgabe.
 */

const html = fs.readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
function dialog() {
    const doc = createTranchenPageDom();
    doc.querySelectorAll = () => [];
    const enhance = element => {
        element.replaceChildren = (...children) => { element.children = [...children]; };
        element.focus = () => { doc.activeElement = element; };
        return element;
    };
    const create = doc.createElement.bind(doc);
    doc.createElement = tag => enhance(create(tag));
    const markup = html.slice(html.indexOf('    <!-- Modal für Tranche'));
    for (const [, tag, attrs, id] of markup.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
        const element = enhance(doc.getElementById(id) || doc.register(new MockElement(id, tag)));
        element.tagName = tag.toUpperCase();
        element.type = attrs.match(/type="([^"]+)"/)?.[1] || '';
        if (attrs.includes('inputmode="decimal"')) element.setAttribute('inputmode', 'decimal');
        element.hidden = /\bhidden\b/.test(attrs);
    }
    bindDecimalInputDisplay(doc);
    return doc;
}
const field = (doc, id) => doc.getElementById(id);
const change = (doc, id, value) => { field(doc, id).value = value; field(doc, id).dispatchEvent({ type: 'change' }); };
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
const taxTile = doc => text(field(doc, 'trancheDetailKpis').children[4]);
const context = { personName: 'Martin', history: [], deletion: { allowed: true, reason: '' } };
const source = createMusterHaushaltRecords('2026-11-15', 'martin-petra', 'grund');
const profileId = 'muster_martin';
const initial = JSON.parse(source.depot_tranchen).find(lot => lot.type === 'aktien_neu');
const original = { ...initial, shares: 3460.931, purchasePrice: 300000 / 3460.931,
    currentPrice: 150, purchaseDate: '2020-05-18', tqf: 0.3, ticker: 'TEST.DE', asOf: Date.parse('2026-11-13T12:00:00Z') };
function storageWith(tranche) {
    const records = { ...source }, registry = JSON.parse(records.rs_profiles_v1);
    records.depot_tranchen = JSON.stringify(JSON.parse(records.depot_tranchen).map(lot => lot.trancheId === tranche.trancheId ? tranche : lot));
    registry.profiles[profileId].data.depot_tranchen = records.depot_tranchen;
    records.rs_profiles_v1 = JSON.stringify(registry);
    return memoryStorage(records);
}
async function savedDetails(doc, tranche) {
    const read = readTrancheFromForm(tranche.trancheId, doc, { existingTranche: tranche, detailsOnly: true });
    const prepared = await prepareTrancheDetailWrite({ storage: storageWith(tranche), profileId, tranche: read });
    return JSON.parse(prepared.records.depot_tranchen).find(lot => lot.trancheId === tranche.trancheId);
}

// TD-1h: Widerspruch sichtbar in beiden Richtungen, unabhängig von Gewinn und Steuerfreiheit.
for (const [type, purchaseDate, stored, expected] of [
    ['aktien_alt', '2020-05-18', 'Altbestand', 'Neubestand'],
    ['aktien_neu', '2008-12-31', 'Neubestand', 'Altbestand']
]) for (const taxExempt of [false, true]) for (const currentPrice of [150, 50]) {
    const tranche = { ...original, type, purchaseDate, taxExempt, currentPrice }, doc = dialog();
    openEditTrancheModal(tranche, doc, null, context);
    assertEqual(field(doc, 'trancheStockWarning').hidden, false, 'Bestandswarnung sofort sichtbar');
    const warning = field(doc, 'trancheStockWarningText').textContent;
    assert(warning.startsWith('Bestand passt nicht zum Kaufdatum: gespeichert ist ' + stored), 'Warnung nennt gespeicherten Bestand');
    assert(warning.includes('spricht für ' + expected), 'Warnung nennt erwarteten Bestand');
    assert(warning.includes(purchaseDate === '2020-05-18' ? '18.05.2020' : '31.12.2008'), 'Warnung nennt Kaufdatum');
    assertEqual(field(doc, 'trancheDetailsFields').hidden, true, 'Angaben zunächst geschlossen');
    await field(doc, 'trancheStockCheckBtn').click();
    assertEqual(field(doc, 'trancheDetailsFields').hidden, false, 'Prüfen öffnet Angaben');
    assertEqual(doc.activeElement.id, 'trancheStockAdoptBtn', 'Prüfen fokussiert Übernahmeknopf');
    assertEqual(field(doc, 'type').value, type, 'Prüfen ändert keinen Bestand');
    const row = buildTranchenTableHtml([tranche]);
    assert(row.includes('<span class="ds-badge ds-chip-warning">Bestand prüfen</span>'), 'Zeile zeigt Warnchip als Text');
    if (type === 'aktien_alt') {
        const explanation = field(doc, 'trancheTaxText').textContent;
        assert(explanation.includes('Gespeichert als Altbestand. Das ändert die Steuer in der App nicht'), 'Altbestand ehrlich erklärt');
        assert(!explanation.includes('rechnet hier ohne Steuer'), 'Falsche Altbestandsbefreiung entfernt');
        if (!taxExempt && currentPrice === 150) assert(explanation.includes('30 % davon steuerfrei') && explanation.includes(`also etwa ${euro(trancheDetailFigures(tranche).tax)}`), 'Altbestand erklärt Teilfreistellung und denselben Steuerbetrag wie die Kachel');
    }
    await field(doc, 'trancheStockAdoptBtn').click();
    assertEqual(field(doc, 'trancheStockWarning').hidden, true, 'Übernahme löst Formularwiderspruch');
    assertEqual(tranche.type, type, 'Übernahme schreibt gespeicherte Tranche nicht still um');
    cancelTrancheDetails(doc);
    assertEqual(field(doc, 'trancheStockWarning').hidden, false, 'Abbrechen stellt gespeicherten Widerspruch wieder her');
}
for (const tranche of [original, { ...original, type: 'aktien_alt', purchaseDate: '2008-12-31' },
    { ...original, purchaseDate: '' }, { ...original, category: 'gold', type: 'gold' }]) {
    const doc = dialog(); openEditTrancheModal(tranche, doc, null, context);
    assertEqual(field(doc, 'trancheStockWarning').hidden, true, 'Ohne Widerspruch keine Warnung');
    assert(!buildTranchenTableHtml([tranche]).includes('Bestand prüfen'), 'Ohne Widerspruch kein Chip');
}
// Verlauf: drei/vier vollständig, sieben zunächst neueste drei plus Kauf, Öffnen setzt zurück.
for (const count of [3, 4, 7]) {
    const history = Array.from({ length: count }, (_, i) => ({ kind: i === count - 1 ? 'buy' : 'correction',
        date: '2026-10-23', sharesBefore: 100 - i, shares: 101 - i, price: 10, amount: 1000, reason: 'depotauszug' }));
    const doc = dialog(), view = { ...context, history };
    const open = () => openEditTrancheModal(original, doc, null, view);
    open();
    const list = field(doc, 'trancheHistoryList');
    const rows = () => list.children.filter(item => item.dataset.trancheHistory);
    assertEqual(rows().length, Math.min(4, count), 'Verlauf startet mit höchstens vier Einträgen');
    assertEqual(rows().at(-1).dataset.kind, 'buy', 'Kauf bleibt unten sichtbar');
    if (count <= 4) { assertEqual(list.children.length, count, 'Kurzer Verlauf ohne Knopf'); continue; }
    const first = rows().slice(0, 3).map(text).join('|');
    let toggle = list.children[3].children[0];
    assertEqual(toggle.textContent, 'alle 7 Einträge zeigen', 'Knopf nennt Gesamtzahl');
    await toggle.click();
    assertEqual(rows().length, 7, 'Aufgeklappt alle Einträge');
    assertEqual(rows().slice(0, 3).map(text).join('|'), first, 'Neueste drei bleiben oben');
    assertEqual(toggle.textContent, 'Verlauf verkürzen', 'Aufgeklappter Knopf heißt Verlauf verkürzen');
    await toggle.click(); assertEqual(rows().length, 4, 'Erneuter Klick verkürzt');
    await toggle.click(); await closeTrancheModal(doc); open();
    assertEqual(rows().length, 4, 'Wiederöffnen startet verkürzt');
}
// Geänderte Stückkorrektur nutzt beim Hintergrundklick dieselbe Rückfrage wie Schließen.
{
    const doc = dialog(), modal = field(doc, 'trancheModal');
    const prompt = field(doc, 'navigationGuardDialog');
    prompt.showModal = () => { prompt.open = true; };
    prompt.close = () => { prompt.open = false; };
    doc.removeEventListener = (type, listener) => { doc.listeners[type] = (doc.listeners[type] || []).filter(item => item !== listener); };
    for (const element of doc.elements.values()) element.removeEventListener = (type, listener) => {
        element.listeners[type] = (element.listeners[type] || []).filter(item => item !== listener);
    };
    openEditTrancheModal(original, doc, null, context);
    revealTrancheSharesCorrection(doc);
    field(doc, 'shares').value = '55'; field(doc, 'shares').dispatchEvent({ type: 'input' });
    const mouse = target => modal.dispatchEvent({ type: 'mousedown', target, preventDefault() {} });
    const click = () => modal.dispatchEvent({ type: 'click', target: modal });
    mouse(field(doc, 'shares')); click();
    assert(!prompt.open && modal.classList.contains('active'), 'Markieren bis auf Hintergrund schließt nicht und fragt nicht');
    mouse(modal); click();
    assert(prompt.open, 'Vollständiger Hintergrundklick fragt bei Stückentwurf');
    assertEqual(field(doc, 'navigationGuardTitle').textContent, 'Änderungen verwerfen?', 'Dieselbe Verwerfrückfrage');
    await field(doc, 'navigationGuardStay').click();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    assert(modal.classList.contains('active'), 'Bleiben erhält Stückentwurf');
    assertEqual(field(doc, 'shares').value, '55', 'Bleiben bewahrt Zahl');
    mouse(modal); click(); await field(doc, 'navigationGuardLeave').click();
    for (let i = 0; i < 12; i++) await Promise.resolve();
    assert(!modal.classList.contains('active'), 'Verwerfen schließt Stückentwurf');
}

// Abbrechen nach Namensänderung: Standardwerte und eigener Wert bleiben auch im echten Schreibauftrag erhalten.
for (const tqf of [0.3, 0.6, 0.15, 0]) for (const taxExempt of [false, true]) {
    const doc = dialog(), tranche = { ...original, tqf, taxExempt };
    openEditTrancheModal(tranche, doc, null, context);
    const before = taxTile(doc), quote = field(doc, 'trancheQuoteText').textContent;
    const signature = captureManagerModalSubmission('tranche', doc).signature;
    field(doc, 'name').value = 'Geänderter Name';
    cancelTrancheDetails(doc);
    assertEqual(field(doc, 'tqf').value, String(tqf), 'Abbrechen bewahrt kanonischen tqf ' + tqf);
    assertEqual(field(doc, 'trancheTqfChoices').children[0].value, String(tqf), 'Auswahl bleibt synchron');
    assertEqual(taxTile(doc), before, 'Steuerkennzahl bleibt nach Namensabbruch unverändert');
    assertEqual(field(doc, 'trancheQuoteText').textContent, quote, 'Gespeicherter Kursstatus bleibt');
    assertEqual(captureManagerModalSubmission('tranche', doc).signature, signature, 'Angaben vollständig wiederhergestellt');
    assertEqual(field(doc, 'trancheDetailsFields').hidden, true, 'Abbrechen klappt Angaben ein');
    assert(field(doc, 'trancheModal').classList.contains('active'), 'Detaildialog bleibt offen');
    const stored = await savedDetails(doc, tranche);
    assertEqual(stored.tqf, tqf, 'Angaben speichern schreibt alten tqf ' + tqf);
    assertEqual(stored.purchasePrice, tranche.purchasePrice, 'Ungerundeter Kaufpreis bleibt');
    assertEqual(trancheDetailFigures(stored).tax, trancheDetailFigures(tranche).tax, 'Gespeicherte Steuer bleibt');
}

// Alle Angaben, einschließlich Widerspruch beim Bestand, Handkurs, Abrufstand und Steuerfreiheit zurücksetzen.
for (const quoted of [false, true]) {
    const doc = dialog(), tranche = { ...original, ticker: quoted ? original.ticker : '',
        asOf: quoted ? original.asOf : undefined, purchaseDate: '2008-12-31', taxExempt: true, tqf: 0.6 };
    openEditTrancheModal(tranche, doc, null, context);
    const before = taxTile(doc), quote = field(doc, 'trancheQuoteText').textContent;
    const reason = field(doc, 'trancheTickerReason').textContent;
    field(doc, 'name').value = 'Entwurf'; field(doc, 'ticker').value = 'NEU.DE';
    field(doc, 'currentPrice').value = '1.234,5678'; field(doc, 'purchasePrice').value = '9,99';
    field(doc, 'purchaseDate').value = '2026-01-01';
    change(doc, 'category', 'gold'); field(doc, 'taxExempt').checked = false;
    field(doc, 'taxExempt').dispatchEvent({ type: 'change' });
    showTrancheQuoteCheck(doc, { status: quoted ? 'failed' : 'ok', price: 999, asOf: Date.parse('2026-11-14'), symbol: 'NEU.DE' });
    revealTrancheSharesCorrection(doc); field(doc, 'shares').value = '1.255,935'; field(doc, 'notes').value = 'Eigene Notiz';
    cancelTrancheDetails(doc);
    assertEqual(taxTile(doc), before, 'Alle Steuerangaben samt Bestand wiederhergestellt');
    assertEqual(field(doc, 'type').value, tranche.type, 'Gespeicherter Datumswiderspruch bleibt erhalten');
    assertEqual(field(doc, 'trancheStockAdoptBtn').hidden, false, 'Widerspruch bleibt sichtbar');
    assertEqual(field(doc, 'trancheManualPriceGroup').hidden, quoted, 'Handkurs hat ursprüngliche Sichtbarkeit');
    assertEqual(field(doc, 'currentPrice').value, '150', 'Kursfeld wiederhergestellt');
    assertEqual(field(doc, 'trancheQuoteText').textContent, quote, 'Kursstatus wiederhergestellt');
    assertEqual(field(doc, 'trancheTickerReason').textContent, reason, 'Abrufdatum wiederhergestellt');
    assertEqual(field(doc, 'shares').value, '1.255,935', 'Offene Stückkorrektur bleibt Entwurf');
    assertEqual(field(doc, 'trancheSharesGroup').hidden, false, 'Korrektur bleibt offen');
    assertEqual(field(doc, 'notes').value, 'Eigene Notiz', 'Notiz bleibt unabhängig');
    assert(getPageNavigationGuard(doc).reasons().some(reason => reason.dirty), 'Stückentwurf bleibt geschützt');
}

// Leser akzeptieren deutsches Komma auch dann, wenn der versteckte Träger von einem Altpfad so belegt wurde.
for (const tqf of [0.3, 0.6]) {
    assertEqual(tqfChoice(String(tqf).replace('.', ',')).value, tqf, 'tqfChoice liest deutsches Komma');
    const doc = dialog(); openEditTrancheModal({ ...original, tqf }, doc, null, context);
    const before = taxTile(doc); field(doc, 'tqf').value = String(tqf).replace('.', ',');
    field(doc, 'purchaseDate').dispatchEvent({ type: 'change' });
    assertEqual(taxTile(doc), before, 'Steueraktualisierung liest deutsches Komma');
    openCreateTrancheModal(doc, null, { tranche: { ...original, tqf, taxExempt: true }, amount: 10000 });
    assertEqual(field(doc, 'tqf').value, String(tqf), 'Vorbelegter Kauf hält tqf kanonisch');
    assertEqual(field(doc, 'trancheTqfChoices').children[0].value, String(tqf), 'Vorbelegter Kauf synchronisiert Auswahl');
    assertEqual(field(doc, 'taxExempt').checked, true, 'Vorbelegter Kauf übernimmt Steuerfreiheit');
}

// Nicht-Aktien: keine Fondsfrage/-hilfe; feste Steuerzeile nur ohne explizite Steuerfreiheit.
for (const [category, type] of [['gold', 'gold'], ['money_market', 'geldmarkt'], ['bonds', 'anleihe']]) {
    const doc = dialog(), tranche = { ...original, category, type, tqf: 0, taxExempt: false };
    openEditTrancheModal(tranche, doc, null, context);
    for (const id of ['trancheTqfLabel', 'trancheTqfReason', 'trancheTqfChoices']) assertEqual(field(doc, id).hidden, true, category + ': Fondsangabe verborgen');
    assertEqual(field(doc, 'trancheTqfFixed').hidden, false, 'Feste Steuerzeile sichtbar');
    field(doc, 'taxExempt').checked = true; field(doc, 'taxExempt').dispatchEvent({ type: 'change' });
    assertEqual(field(doc, 'trancheTqfFixed').hidden, true, 'Ganz steuerfrei verbirgt widersprüchliche Zeile');
    cancelTrancheDetails(doc);
    assertEqual(field(doc, 'trancheTqfFixed').hidden, false, 'Abbrechen stellt feste Zeile wieder her');
    openEditTrancheModal({ ...tranche, taxExempt: true }, doc, null, context);
    assertEqual(field(doc, 'trancheTqfFixed').hidden, true, 'Öffnen übernimmt Steuerfreiheit');
    change(doc, 'category', 'equity');
    assertEqual(field(doc, 'trancheTqfLabel').hidden, false, 'Wechsel zu Aktien zeigt Fondsfrage');
    change(doc, 'category', category);
    assertEqual(field(doc, 'trancheTqfReason').hidden, true, 'Rückwechsel verbirgt Fondshilfe');
    assertEqual(field(doc, 'trancheTqfFixed').hidden, true, 'Rückwechsel berücksichtigt Steuerfreiheit');
    resetTrancheForm(doc);
    assertEqual(field(doc, 'trancheTqfLabel').hidden, false, 'Reset zeigt Fondsfrage für Aktien');
    assertEqual(field(doc, 'trancheTqfReason').hidden, false, 'Reset zeigt Fondshilfe für Aktien');
    assertEqual(field(doc, 'trancheTqfFixed').hidden, true, 'Reset verbirgt feste Zeile');
}

const shareCases = [['7.5', 7.5, '7,5'], ['1255.935', 1255.935, '1.255,935'],
    ['1.255,935', 1255.935, '1.255,935'], ['2.500', 2500, '2.500'], ['1255,935', 1255.935, '1.255,935'],
    ['0.1234567890123456789', 0.1234567890123456789, '0,1234567890123456789']];
const leaveShares = doc => {
    field(doc, 'shares').dispatchEvent({ type: 'blur' });
    for (const handler of doc.listeners.focusout) handler({ target: field(doc, 'shares') });
};
// Deutsche Darstellung ohne Rundung; Vorschau, Signatur und Schreibauftrag rechnen denselben Wert.
for (const [raw, expected, displayed] of shareCases) {
    const doc = dialog(), tranche = { ...original, shares: expected };
    openEditTrancheModal(tranche, doc, null, context);
    revealTrancheSharesCorrection(doc);
    const baseline = captureManagerModalSubmission('tranche', doc).signature;
    field(doc, 'shares').value = raw;
    field(doc, 'shares').dispatchEvent({ type: 'input' });
    leaveShares(doc);
    assertEqual(field(doc, 'shares').value, displayed, 'Verlassen zeigt Stückeingabe deutsch ohne Rundung');
    assertEqual(isMoneyInput(field(doc, 'shares')), false, 'Stück ist kein Betragsfeld');
    assertEqual(captureManagerModalSubmission('tranche', doc).signature, baseline, 'Schreibweise allein erzeugt keinen Entwurf');
    assert(!getPageNavigationGuard(doc).reasons().some(reason => reason.dirty), 'Bloßes Verlassen erzeugt keinen Änderungshinweis');
    const read = readTrancheFromForm(tranche.trancheId, doc, { existingTranche: tranche });
    assertEqual(read.shares, expected, raw + ' ergibt richtige Stückzahl');
    assertEqual(read.costBasis, expected * tranche.purchasePrice, 'Formularvorschau und Record nutzen richtige Stückzahl');
    assert(!field(doc, 'trancheFormPreview').textContent.includes('gültiger Eingabe'), 'Vorschau ist berechnet');
    const correction = correctedTranche(original, readMoneyText(raw), 'difference');
    const prepared = await prepareTrancheDetailWrite({ storage: storageWith(original), profileId, tranche: correction, correction: true, correctionReason: 'depotauszug' });
    const stored = JSON.parse(prepared.records.depot_tranchen).find(lot => lot.trancheId === original.trancheId);
    assertEqual(stored.shares, expected, 'Korrekturschreiber speichert richtige Stückzahl');
    assertEqual(stored.correctionHistory.at(-1).sharesAfter, expected, 'Verlauf erhält richtige Stückzahl');
    field(doc, 'shares').value = '1.256,935';
    assert(getPageNavigationGuard(doc).reasons().some(reason => reason.dirty), 'Geänderte Stückzahl bleibt geschützt');
}

// Anlegen: Verlassen ändert weder Wert, Vorschau noch Signatur; ungültiger Text bleibt zur Korrektur stehen.
for (const [raw, expected, displayed] of shareCases) {
    const doc = dialog(); openCreateTrancheModal(doc);
    field(doc, 'shares').value = raw; field(doc, 'shares').dispatchEvent({ type: 'input' });
    const before = captureManagerModalSubmission('tranche', doc).signature;
    const preview = field(doc, 'trancheFormPreview').textContent;
    leaveShares(doc);
    assertEqual(field(doc, 'shares').value, displayed, 'Anlegen zeigt Stückzahl deutsch');
    assertEqual(readMoneyText(field(doc, 'shares').value), expected, 'Anlegen bewahrt Zahlenwert');
    assertEqual(captureManagerModalSubmission('tranche', doc).signature, before, 'Anlegen bewahrt Signatur beim Verlassen');
    assertEqual(field(doc, 'trancheFormPreview').textContent, preview, 'Anlegen bewahrt Vorschau beim Verlassen');
    leaveShares(doc);
    assertEqual(field(doc, 'shares').value, displayed, 'Erneutes Verlassen bewahrt Darstellung');
}
for (const raw of ['', '7,5.0', 'abc']) {
    const doc = dialog(); openCreateTrancheModal(doc); field(doc, 'shares').value = raw;
    leaveShares(doc);
    assertEqual(field(doc, 'shares').value, raw, 'Leerer oder ungültiger Stücktext bleibt stehen');
}

// Vollständiger Korrekturweg über die Seitenfassade: Vorschau und Klick schreiben denselben Wert, der Dialog bleibt offen.
const previousGlobals = Object.fromEntries(['document', 'window', 'localStorage', 'confirm', 'alert', 'URL', 'Blob'].map(key => [key, global[key]]));
try {
    // TD-1f: lesbare Vorbelegung, Bestätigung schreibfrei, echte Eingabe mit voller Genauigkeit.
    for (const action of ['button', 'enter', 'split', 'edited', 'same-display', 'precise', 'integer']) {
        const tranche = { ...original, shares: action === 'integer' ? 1176 : 1176.4853503176805 };
        const doc = dialog(); installGlobals(doc, createLocalStorageMock());
        PersistenceFacade.resetPersistenceForTests(); await PersistenceFacade.init();
        for (const [key, value] of Object.entries(storageWith(tranche).copy)) persistenceStorage.setItem(key, value);
        await initTranchenManagerPage({ profileId });
        const button = new MockElement('open-detail', 'button');
        button.dataset = { action: 'edit-tranche', trancheId: tranche.trancheId };
        field(doc, 'tranchenTable').dispatchEvent({ type: 'click', target: button });
        const signature = captureManagerModalSubmission('tranche', doc).signature;
        const before = persistenceStorage.getItem('depot_tranchen');
        field(doc, 'trancheDetailKpis').dispatchEvent({ type: 'click', target: { closest: selector => selector === '[data-tranche-shares-edit]' } });
        assertEqual(field(doc, 'shares').value, action === 'integer' ? '1.176' : '1.176,485', 'Vorbelegung wie Stückkachel');
        assertEqual(captureManagerModalSubmission('tranche', doc).signature, signature, 'Vorbelegung ist keine Formularänderung');
        leaveShares(doc);
        assertEqual(captureManagerModalSubmission('tranche', doc).signature, signature, 'Verlassen rundet keinen gespeicherten Wert');
        assert(field(doc, 'trancheCorrectionPreview').textContent.includes('unverändert'), 'Vorbelegung zeigt unverändert');
        if (action === 'split') {
            const split = new MockElement('split', 'button'); split.dataset = { correction: 'split' };
            split.closest = () => split;
            field(doc, 'trancheCorrectionReasons').dispatchEvent({ type: 'click', target: split });
            assert(field(doc, 'trancheCorrectionPreview').textContent.includes('unverändert'), 'Grundwechsel allein ändert nichts');
        }
        const raw = { edited: '1.176,5', 'same-display': '1.176,485', precise: '1.176,4853503176815' }[action];
        if (raw) {
            field(doc, 'shares').value = raw; field(doc, 'shares').dispatchEvent({ type: 'input' });
            assert(field(doc, 'trancheCorrectionPreview').textContent.startsWith(`Danach: ${exactShares(readMoneyText(raw))} Stück`), 'Echte Eingabe aktualisiert sofort die Vorschau');
        }
        if (action === 'enter') field(doc, 'shares').dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {}, stopPropagation() {} });
        else await field(doc, 'trancheCorrectionSaveBtn').click();
        await waitFor(() => field(doc, 'trancheSharesGroup').hidden, 'Korrektur abgeschlossen');
        const stored = JSON.parse(persistenceStorage.getItem('depot_tranchen')).find(lot => lot.trancheId === tranche.trancheId);
        if (raw) {
            assertEqual(stored.shares, readMoneyText(raw), 'Echte Eingabe wird genau übernommen');
            assertEqual(stored.correctionHistory.length, 1, 'Echte Änderung erzeugt einen Eintrag');
        } else {
            assertEqual(persistenceStorage.getItem('depot_tranchen'), before, 'Bestätigung bewahrt vollständigen Record ohne Korrektureintrag');
            assertEqual(stored.shares, tranche.shares, 'Interne Stückgenauigkeit bleibt erhalten');
            assertEqual(captureManagerModalSubmission('tranche', doc).signature, signature, 'Bestätigung bewahrt Formularschutz');
        }
    }
    for (const [raw, expected, displayed] of shareCases) {
        const doc = dialog(); installGlobals(doc, createLocalStorageMock());
        PersistenceFacade.resetPersistenceForTests(); await PersistenceFacade.init();
        for (const [key, value] of Object.entries(storageWith(original).copy)) persistenceStorage.setItem(key, value);
        await initTranchenManagerPage({ profileId });
        const button = new MockElement('open-detail', 'button');
        button.dataset = { action: 'edit-tranche', trancheId: original.trancheId };
        field(doc, 'tranchenTable').dispatchEvent({ type: 'click', target: button });
        field(doc, 'trancheDetailKpis').dispatchEvent({ type: 'click', target: { closest: selector => selector === '[data-tranche-shares-edit]' } });
        field(doc, 'shares').value = raw; field(doc, 'shares').dispatchEvent({ type: 'input' });
        assert(field(doc, 'trancheCorrectionPreview').textContent.startsWith(`Danach: ${exactShares(expected)} Stück`), 'Korrekturvorschau verwendet deutsche Stückzahl');
        const signature = captureManagerModalSubmission('tranche', doc).signature;
        leaveShares(doc);
        assertEqual(field(doc, 'shares').value, displayed, 'Korrekturbereich zeigt Stückzahl deutsch');
        assertEqual(captureManagerModalSubmission('tranche', doc).signature, signature, 'Korrekturbereich bewahrt Signatur');
        await field(doc, 'trancheCorrectionSaveBtn').click();
        const stored = () => JSON.parse(persistenceStorage.getItem('depot_tranchen')).find(lot => lot.trancheId === original.trancheId);
        await waitFor(() => stored().shares === expected && field(doc, 'trancheSharesGroup').hidden, 'Stückkorrektur bestätigt');
        assertEqual(stored().shares, expected, 'Speicherknopf übernimmt deutsche Stückzahl');
        assert(field(doc, 'trancheModal').classList.contains('active'), 'Stückzahl speichern lässt Detaildialog offen');
        assertEqual(text(field(doc, 'trancheDetailKpis').children[0]).includes(exactShares(expected)), true, 'Kennzahl zeigt neue Stückzahl');
    }
} finally {
    PersistenceFacade.resetPersistenceForTests();
    for (const [key, value] of Object.entries(previousGlobals)) {
        if (value === undefined) delete global[key]; else global[key] = value;
    }
}
