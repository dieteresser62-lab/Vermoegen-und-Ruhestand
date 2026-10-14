import fs from 'node:fs';
import { buildTranchenStatsHtml, buildTranchenTableHtml, buildReconciliationCashStatusesHtml } from '../app/tranches/tranchen-manager-renderer.js';
import { ensureCashPostingModal } from '../app/tranches/tranchen-manager-modal.js';
import { renderTranchenStatusBadge, getTranchenStatus } from '../app/tranches/depot-tranchen-status.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { readSources, validateManager, validateManagerMarkup, validateFoundation, validatePersonenVermoegenLayout, MANAGER_RENDERERS, createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { validateAnchorEvidence } from './funktionsinventar-contract.mjs';

const sources = readSources();
assertEqual(validatePersonenVermoegenLayout(sources).join(','), '', 'Personenseite verwendet Haushalt/Reiter/Profilkarten und vorhandene Typografietokens');
assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html'].replace('<div class="container">', '<div class="container ds-card">') }).includes('Personenseite: äußerer Kartenrahmen'), 'Beiger Gesamtrahmen darf nicht wieder als äußere Karte erscheinen');
assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html'].replace('id="managerPageTitle"', 'id="entfernterKopf"') }).includes('Personenseite: Kopfhost fehlt: managerPageTitle'), 'Tatsächlicher Einzel-/Mehrprofiltitel bleibt im Kopf ansprechbar');
const peopleButton = sources['depot-tranchen-manager.html'].match(/<button[^>]*id="managePeopleBtn"[^>]*>[\s\S]*?<\/button>/)[0];
const movedPeopleOpener = sources['depot-tranchen-manager.html'].replace(peopleButton, '').replace(/(<nav[^>]*id="managerSectionNav"[^>]*>)<\/nav>/, '$1' + peopleButton + '</nav>');
assert(movedPeopleOpener !== sources['depot-tranchen-manager.html'], 'Gegenprobe verschiebt den echten Verwaltungsöffner in die Tabrollen');
assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': movedPeopleOpener }).includes('Personenseite: Verwaltungsöffner außerhalb der Reiter fehlt'), 'Verwaltungsöffner gehört außerhalb der Personen-Tabrollen');
for (const mutate of [html => html.replace('role="tablist"', 'role="navigation"'), html => html + '<nav role="tablist"></nav>']) {
    assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': mutate(sources['depot-tranchen-manager.html']) }).includes('Personenseite: einzige Ansichtsreiterliste fehlt'), 'Entfernte oder verdoppelte Ansichtsreiterliste scheitert');
}
for (const id of ['managerPlanPanel', 'managerPersonPanel']) {
    const visible = sources['depot-tranchen-manager.html'].replace(new RegExp(`<div[^>]*id="${id}"[^>]*>`), opening => opening.replace(/\s+hidden\b/, ''));
    assert(visible !== sources['depot-tranchen-manager.html'], 'Gegenprobe entfernt die tatsächliche anfängliche Panelgrenze: ' + id);
    assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': visible }).includes('Personenseite: verborgenes Ansichtspanel fehlt'), 'Anfänglich sichtbares Panel scheitert: ' + id);
}

const navAfterCards = sources['depot-tranchen-manager.html'].replace('id="managerSectionNav"', 'id="lateNav"').replace('id="managerHousehold"', 'id="managerSectionNav"');
assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': navAfterCards }).includes('Personenseite: Reiter vor Haushalts-/Profilkarten fehlen'), 'Gegenprobe erkennt Reiter unterhalb der großen Karten');
const swappedPanels = sources['depot-tranchen-manager.html'].replace('id="managerPlanPanel"', 'id="swapPanel"').replace('id="managerPersonPanel"', 'id="managerPlanPanel"').replace('id="swapPanel"', 'id="managerPersonPanel"');
const swappedErrors = validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': swappedPanels });
assert(swappedErrors.includes('Personenseite: Planhost außerhalb des Planpanels: managerHouseholdPlan')
    && swappedErrors.includes('Personenseite: Personenhost außerhalb des Personenpanels: managerProfileValues'), 'Vertauschte Panels scheitern an der wirklichen Hostzuordnung');
assert(validatePersonenVermoegenLayout({ ...sources, 'css/personen-vermoegen.css': sources['css/personen-vermoegen.css'].replace('font-size: var(--balance-h2)', 'font-size: 30px') }).includes('Personenseite: Typografietoken fehlt'), 'Neue Pixelschrift wird in der Personenseite abgewiesen');
assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html'].replace('id="trancheFormPreview"', 'id="entfernt"') }).includes('Personenseite: Depot-/Dialoghost fehlt: trancheFormPreview'), 'Fehlender tatsächlicher Vorschauhost scheitert');
assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html'].replace('id="type" required class="ds-select" hidden', 'id="type" required class="ds-select"') }).includes('Personenseite: nativer Segmentwertträger fehlt'), 'Verlorene Wertträgertrennung scheitert');
const codeBlock = sources['depot-tranchen-manager.html'].match(/\.code-block\s*\{[^}]*\}/)?.[0];
assert(codeBlock?.includes('color: var(--text-main);'), 'Codeblock verwendet die Haupttextrolle auf der abgesenkten Fläche');
for (const token of ['--border', '--border-strong']) {
    const mutatedBlock = codeBlock.replace('color: var(--text-main);', `color: var(${token});`);
    assert(mutatedBlock !== codeBlock, `${token}: Gegenprobe verändert den tatsächlichen Codeblock`);
    const mutated = { ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html'].replace(codeBlock, mutatedBlock) };
    assert(validateManager(mutated).includes('Manager-Rahmentoken als Textfarbe'), `${token}: Rollenverwechslung im Codeblock scheitert`);
}
assertEqual(JSON.stringify(validateManager(sources)), '[]', 'Manager und Status verwenden ausschließlich gemeinsame Rollen');
assertEqual(JSON.stringify(validateFoundation(sources)), '[]', 'Neue Managerconsumer halten Alias- und Prioritätsvertrag ein');
for (const path of ['depot-tranchen-manager.html', ...MANAGER_RENDERERS]) {
    for (const addition of ['<p style="color: #764ba2;">Probe</p>', '<p style="opacity: .8;">Probe</p>', "probe.style.color = 'purple';"]) {
        assert(validateManager({ ...sources, [path]: sources[path] + '\n' + addition }).length > 0, `${path}: Altfarbe/Deckkraft wird abgewiesen`);
    }
    assert(validateFoundation({ ...sources, [path]: sources[path] + '\n<p style="color: var(--unbekannt);">Probe</p>' }).length > 0, `${path}: unbekannter Alias scheitert`);
    for (const token of ['--border', '--border-strong']) {
        for (const addition of [`<p style="color: var(${token});">Probe</p>`, `probe.style.color = 'var(${token})';`]) {
            assert(validateManager({ ...sources, [path]: sources[path] + '\n' + addition }).includes('Manager-Rahmentoken als Textfarbe'), `${path}: ${token} ist keine Textrolle`);
        }
    }
    assertEqual(JSON.stringify(validateManager({ ...sources, [path]: sources[path] + '\n<p style="color: var(--text-main); border: 1px solid var(--border); border-color: var(--border-strong);">Probe</p>' })), '[]', `${path}: Rahmentokens bleiben für Rahmen erlaubt`);
}
const lots = [
    { trancheId: 'a', name: 'Synthetische Aktie', purchaseDate: '2024-01-02', shares: 10, purchasePrice: 100, currentPrice: 120, costBasis: 1000, marketValue: 1200, type: 'aktien_neu', category: 'equity', tqf: .3 },
    { trancheId: 'b', name: 'Synthetisches Gold', purchaseDate: '2023-01-02', shares: 10, purchasePrice: 90, currentPrice: 80, costBasis: 900, marketValue: 800, type: 'gold', category: 'gold', tqf: 1 }
];
const before = JSON.stringify(lots);
const fragments = [buildTranchenStatsHtml([]), buildTranchenStatsHtml(lots), buildTranchenTableHtml([]), buildTranchenTableHtml(lots), buildReconciliationCashStatusesHtml([]), buildReconciliationCashStatusesHtml([], { errorMessage: 'Synthetischer Auditfehler' })];
// Slice 8 ändert ausschließlich die deutsche Anzeige und die sichtbaren Datenbezüge.
const text = html => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
for (const [index, expected] of [
    [0, ['Gesamtwert der Tranchen (ohne Tagesgeld)', '0 €', '0,0 %']],
    [1, ['2.000 €', '1.900 €', '+100 €', '+5,3 %']],
    [2, ['Keine Tranchen vorhanden']],
    [3, ['02.01.2024', '02.01.2023', '100,00 €/Stück', '120,00 €/Stück', '+20,0 %', '-11,1 %', 'Kaufpreis (€/Stück)']],
    [4, ['Noch keine dokumentierten Realverkäufe']],
    [5, ['Synthetischer Auditfehler', 'Cashstatus-Audit nicht lesbar']]
]) for (const value of expected) assert(text(fragments[index]).includes(value), `Manageranzeige ${index}: ${value}`);
assertEqual(JSON.stringify(lots), before, 'Renderer mutieren keine Lots und keine Sortierreihenfolge');
const doc = createPresentationTestDocument();
ensureCashPostingModal(doc);
fragments.push(doc.body.children[0].innerHTML);
for (const [html, id, hostId] of [
    [sources['depot-tranchen-manager.html'], 'retryTrancheDialogSaveBtn', 'trancheFormError'],
    [doc.body.children[0].innerHTML, 'retryCashPostingSaveBtn', 'cashPostingFormError']
]) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>[\\s\\S]*?</button>`))?.[0];
    assert(button?.includes('type="button"') && button.includes('Speichern erneut versuchen') && button.includes('ds-button-secondary'),
        `${id}: benannte native Tastatur-/Mausaktion im echten Dialogmarkup`);
    const host = html.match(new RegExp(`<div[^>]*id="${hostId}"[^>]*>[\\s\\S]*?</div>`))?.[0];
    assert(host && !host.includes(id), `${id}: ersetzbarer Fehlerhost enthält keinen Wiederholenknopf`);
}
const cash = buildReconciliationCashStatusesHtml([
    { targetActionId: 'sale-open', cashStatus: 'pending_manual_posting', statusLabel: 'Offen – manuell nachführen', confirmedNetProceedsEur: 500, cashBalanceAfterPostingEur: null, isPending: true, canConfirm: true },
    { targetActionId: 'sale-legacy', cashStatus: 'legacy_unknown', statusLabel: 'Altfall – Cashstatus nicht dokumentiert', confirmedNetProceedsEur: 50, cashBalanceAfterPostingEur: null, isLegacy: true, canConfirm: true },
    { targetActionId: 'sale-confirmed', cashStatus: 'confirmed_corrected', statusLabel: 'Cash bestätigt – korrigiert', confirmedNetProceedsEur: 95, cashBalanceAfterPostingEur: 10090, correctionRevision: 1, correctionReason: 'Synthetische Korrektur', effectiveActionId: 'cash-correction:v1:sale-confirmed:1', canCorrect: true }
]);
fragments.push(cash);
assert(cash.includes('data-cash-status="pending_manual_posting" class="ds-note ds-note-warning"'), 'Offene Cashbuchung hat Warnrolle und bleibt operativ unterscheidbar');
assert(cash.includes('data-cash-status="legacy_unknown" class="ds-note "') && cash.includes('nicht als cashbestätigt'), 'Altverkäufe bleiben neutral und nicht cashbestätigt');
assert(cash.includes('data-cash-status="confirmed_corrected"') && cash.includes('Revision 1') && cash.includes('10.090,00'), 'Cashkorrektur behält wirksamen Nachweis und bestätigten Betrag');

assertEqual(JSON.stringify(validateManager(sources, fragments)), '[]', 'Tatsächlich erzeugte Statistik-, Tabellen-, Leer-, Fehler- und Dialogfragmente erfüllen Rollen');
const table = fragments[3];
assert(validateManagerMarkup(table.replace(/ aria-label="[^"]*"/g, '')).includes('Manager-Symbolaktion ohne Namen'), 'Unbenannte Symbolaktionen scheitern');
assert(validateManagerMarkup(table.replace('ds-table-scroll', '')).length > 0, 'Fehlende additive Scrollrolle scheitert');

// Inventargate: additive Klassen stehen an den tatsächlichen Erzeugerstellen.
const inventory = JSON.parse(fs.readFileSync(new URL('../docs/design/funktionsinventar.json', import.meta.url), 'utf8'));
for (const id of ['V11', 'V12', 'V24']) {
    const entry = inventory.pages.flatMap(page => page.entries).find(entry => entry.id === id);
    const roles = entry.selectors.dynamic.filter(record => record.selector.includes('.ds-'));
    assert(roles.length > 0, `${id}: additive Erzeugerbelege vorhanden`);
    for (const record of roles) {
        assert(validateAnchorEvidence(record, sources, { id, page: entry.page }).ok, `${id}: Rollen am echten Erzeuger geschützt`);
        const module = record.producer.module;
        const mutated = { ...sources, [module]: sources[module].replaceAll('ds-', 'entfernt-') };
        assert(!validateAnchorEvidence(record, mutated, { id, page: entry.page }).ok, `${id}: fehlende additive Rolle scheitert im Inventargate`);
    }
}

// Tatsächlicher Statusrenderer mit unveränderten Bestands-/Cashsperrzweigen.
const saved = { window: globalThis.window, document: globalThis.document, localStorage: globalThis.localStorage };
const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
const container = { innerHTML: '' };
globalThis.localStorage = storage; globalThis.window = {}; globalThis.document = { getElementById: () => container };
PersistenceFacade.resetPersistenceRuntimeForTests();
try {
    for (const [raw, state, text] of [[null, 'not_loaded', 'Keine detaillierten Tranchen geladen'], ['[]', 'empty', 'Tranchenbestand ist leer'], ['kaputt', 'error', 'Tranchenbestand ist fehlerhaft'], [JSON.stringify(lots), 'valid', 'FIFO aktiv']]) {
        if (raw === null) values.delete('depot_tranchen'); else values.set('depot_tranchen', raw);
        const statusBefore = JSON.stringify(getTranchenStatus());
        renderTranchenStatusBadge('status');
        assert(container.innerHTML.includes(`data-tranchen-state="${state}"`) && container.innerHTML.includes(text), `${state}: bestehender Statuszweig mit benannter Darstellung`);
        assertEqual(JSON.stringify(validateManagerMarkup(container.innerHTML)), '[]', `${state}: Statusmarkup tokenisiert`);
        assertEqual(JSON.stringify(getTranchenStatus()), statusBefore, `${state}: Renderer ändert keine Bestandswerte/Sperren`);
        assertEqual(values.get('depot_tranchen') ?? null, raw, `${state}: Rohspeicher bleibt bytegleich`);
    }
} finally {
    Object.assign(globalThis, saved); PersistenceFacade.resetPersistenceRuntimeForTests();
}

for (const gain of [0, -0, 200, -200, .00001, -.00001]) {
    const lots = [{ trancheId: 'r8', name: 'R8-Muster', marketValue: 1000 + gain, costBasis: 1000 }];
    const before = JSON.stringify(lots), table = buildTranchenTableHtml(lots), stats = buildTranchenStatsHtml(lots);
    const gainRow = table.match(/<tr class="tranche-row"[^>]*>([\s\S]*?)<\/tr>/)[1];
    const gainCell = [...gainRow.matchAll(/<td(?: class="([^"]*)")?>([\s\S]*?)<\/td>/g)][8];
    assertEqual(gainCell[1], gain === 0 ? '' : gain > 0 ? 'positive' : 'negative', 'Managergewinn folgt dem Rohvorzeichen, Null bleibt neutral');
    assertEqual(/class="[^"]*(?:positive|negative)/.test(stats), gain !== 0, 'Gewinnstatistik folgt dem Rohvorzeichen; exakte Null bleibt neutral');
    assertEqual(JSON.stringify(lots), before, 'R8-Renderer erhalten die Lots');
}
assert(!sources['depot-tranchen-manager.html'].includes('profileRenteHelp'), 'Statischer Rentenhinweis und alte ARIA-Referenz fehlen');

assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html'].replace('id="saleStep2"', 'id="fehlenderCashschritt"') }).length > 0, 'Fehlender tatsächlicher Cashschritt scheitert');
assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html'].replace('id="managerPeopleList"', 'id="fehlendePersonenliste"') }).length > 0, 'Fehlender tatsächlicher Personenhost scheitert');

for (const id of ['profileGoldAktiv', 'profileGoldSteuerfrei', 'profileHealthBucketEnabled']) {
    const mutated = { ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html'].replace(`id="${id}Toggle"`, `id="entfernt${id}"`) };
    assert(validatePersonenVermoegenLayout(mutated).includes(`Personenseite: Schalterwertträger fehlt: ${id}`), 'Entfernter sichtbarer Schalter scheitert am tatsächlichen Quellvertrag');
}
const unlockedPensionValue = sources['depot-tranchen-manager.html'].replace(/<input\b[^>]*id="profileRenteAktiv"[^>]*>/, input => input.replace(/\sdisabled\b/, ''));
assert(unlockedPensionValue !== sources['depot-tranchen-manager.html'], 'Gegenprobe entsperrt den tatsächlichen versteckten Rentenwertträger');
assert(validatePersonenVermoegenLayout({ ...sources, 'depot-tranchen-manager.html': unlockedPensionValue }).includes('Personenseite: abgeleitete Rente nicht gesperrt'), 'Entsperrte Rentenableitung scheitert');
assert(!buildReconciliationCashStatusesHtml([]).includes('<h3>'), 'Renderer verdoppelt keine Verkaufsüberschrift');

// Die neuen Darstellungsrollen bleiben an ihren tatsächlichen Erzeugern nachweisbar.
for (const [name, module, producer] of [
    ['pv-course-chart', 'app/tranches/tranchen-history-ui.js', 'buildTrancheHistoryDetail'],
    ['pv-history-placeholder', 'app/tranches/tranchen-history-ui.js', 'buildPersonHistoryHtml'],
    ['pv-person-card', 'app/tranches/tranchen-manager-renderer.js', 'renderManagerProfiles']
]) {
    const result = validateAnchorEvidence({ selector: '.' + name, status: 'geschützt', anchor: { kind: 'class', value: name },
        producer: { kind: 'function', module, name: producer } }, new Map([[module, fs.readFileSync(module, 'utf8')]]), { id: 'P8b', page: 'depot-tranchen-manager.html' });
    assert(result.ok, 'P8b: echte Darstellungsrolle am Erzeuger belegt: ' + name);
}
const personStyles = fs.readFileSync('css/personen-vermoegen.css', 'utf8'), historyStyles = fs.readFileSync('css/wealth-history.css', 'utf8');
assert(/\.pv-person-history \.history-sparkline\s*\{[^}]*width:\s*100%;[^}]*height:\s*40px/.test(personStyles), 'Personenverlauf erhält volle Innenbreite und eine flache 40-px-Linie');
assert(/\.history-course\s*\{[^}]*stroke:\s*var\(--accent\)/.test(historyStyles) && /\.pv-course-change strong\s*\{[^}]*font-weight:\s*600/.test(personStyles), 'Kurslinie nutzt Messingtoken und Entwicklung halbfettes Gewicht');

assert(['positive', 'negative', 'neutral'].every(state => historyStyles.includes('.pv-history-change.history-' + state)), 'Kartenfarbe überstimmt den allgemein gedämpften Absatzstil');

console.log('Personendatenkarten besitzen native Steuerung und vollständige ARIA-Bezüge');
{
    const { tokenizeHTML } = await import('./funktionsinventar-contract.mjs');
    const elements = tokenizeHTML(sources['depot-tranchen-manager.html']).elements;
    const node = id => elements.find(el => el.attrs.id === id);
    for (const card of ['Person', 'Assets', 'Care']) {
        const button = node(`manager${card}Toggle`), region = node(`manager${card}Body`);
        assert(button.tag === 'button' && button.attrs.type === 'button', 'Native Enter/Space/Klick-Steuerung: ' + card);
        assert(button.attrs['aria-expanded'] === 'false' && button.attrs['aria-controls'] === region.attrs.id, 'Geschlossene Kartensteuerung mit vollständigem Ziel: ' + card);
        assert(Object.hasOwn(region.attrs, 'hidden') && region.attrs['aria-labelledby'] === button.attrs.id, 'Region benennt ihren Öffner und beginnt verborgen: ' + card);
        let parent = button.parent;
        while (parent) { assert(parent.tag !== 'button', 'Keine verschachtelten Buttons: ' + card); parent = parent.parent; }
    }
    for (const id of ['profileGeburtsdatum', 'profileGeschlecht', 'profileRentenbeginn', 'profileRenteMonatlich', 'profileSparerPauschbetrag', 'profileKirchensteuerPct', 'profileSonstigeEinkuenfte']) {
        let parent = node(id).parent;
        const host = ['profileRenteMonatlich', 'profileSonstigeEinkuenfte'].includes(id) ? 'managerPersonGlance' : 'managerPersonBody';
        while (parent && parent.attrs.id !== host) parent = parent.parent;
        assert(Boolean(parent), 'Bestehender Personenfeldanker liegt in der Personregion: ' + id);
        assertEqual(elements.filter(el => el.attrs.id === id).length, 1, 'Keine duplizierten Wertträger: ' + id);
    }
    assert(!Object.hasOwn(node('personendaten').attrs, 'hidden') && node('personendaten').parent.attrs.id === 'managerPersonGlance', 'Sprungziel und Gesamtknopf bleiben im offenen Kartenkopf außerhalb der Klappen');
    assert(Object.hasOwn(node('managerBirthSupplement').attrs, 'hidden') && node('managerBirthDate').attrs['aria-describedby'].includes('managerBirthError'), 'Ergänzung hat einen eigenen verknüpften Fehlerhost');
    assert(sources['css/personen-vermoegen.css'].includes('.pv-person-disclosure { grid-column: 1 / -1; }'), 'Personkarte spannt volle Breite');
    const binder = fs.readFileSync(new URL('../app/tranches/tranchen-manager-person-cards.js', import.meta.url), 'utf8');
    assert(!binder.includes("addEventListener('keydown'") && !binder.includes('sessionStorage'), 'Native Tastatursteuerung erzeugt keinen zusätzlichen Togglehandler und speichert keine Klappzustände');
}
