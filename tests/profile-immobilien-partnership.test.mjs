import { bindManagerPartnership, renderManagerPartnership } from '../app/tranches/tranchen-manager-partnership.js';
import { renderPartnershipSummary } from '../app/simulator/simulator-partnership-ui.js';
import { readWidowOptions } from '../app/simulator/simulator-input-pension.js';
import { IMMOBILIEN_KEY, readImmobilien, writeImmobilien, immobilienIncome } from '../app/profile/profile-immobilien.js';
import { PARTNERSHIP_KEY, readPartnership, inheritancePreview } from '../app/profile/household-partnership.js';
import { INCOME_KEY, writeIncome } from '../app/profile/profile-income.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { loadProfileAssetValues, saveProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { captureProfileData } from '../app/profile/profile-live-storage.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { exportProfilesBundle, importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { EngineAPI } from '../engine/index.mjs';
import { backtest } from './helpers/ek-1b-measurement.mjs';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { previewPersonExport, previewPersonImport, importPersonFile } from '../app/profile/profile-person-file.js';

const same = (a, b, label) => assert(JSON.stringify(a) === JSON.stringify(b), label);
// VF-2l ergänzt allein den Anzeigewert; alle bisherigen Ergebnisfelder bleiben im Vergleich.
const financialBytes = value => JSON.stringify(value, (key, item) => ['immobilien_wert_end', 'immobilien_selbst_end', 'immobilien_vermietet_end', 'displayWealth'].includes(key) || key.includes('displayHomeValue') ? undefined : item);
const sameFinancial = (a, b, label) => assertEqual(financialBytes(a), financialBytes(b), label);
const storageOf = (records = {}) => ({ records: { ...records }, get length() { return Object.keys(this.records).length; },
    key(i) { return Object.keys(this.records)[i] ?? null; }, getItem(key) { return this.records[key] ?? null; },
    setItem(key, value) { this.records[key] = String(value); }, removeItem(key) { delete this.records[key]; } });
const homes = [{ id: 'haus', bezeichnung: 'Haus', nutzung: 'selbst', wert: 450000, stand: '2026-10', mieteNetto: 0, anpassung: 'keine' },
    { id: 'wohnung', bezeichnung: 'Wohnung Leipzig', nutzung: 'vermietet', wert: 210000, stand: '2026-10', mieteNetto: 650, anpassung: 'inflation' }];
// UI-Projektion sperrt den Editor, ohne den bisherigen Rechenvertrag umzuschreiben.
{
    const fields = Object.fromEntries(['simPartnershipNotice', 'simPartnershipPending', 'simPartnershipText', 'simUnmarriedPensionMode', 'simUnmarriedPensionPct',
        'widowPensionMode', 'widowPensionPct', 'widowMarriageOffsetYears', 'widowMinMarriageYears', 'survivorFloorPercent'].map(id => [id, { value: '', closest: () => ({ classList: { toggle() {} } }) }]));
    Object.assign(fields.widowPensionMode, { value: 'percent' }); Object.assign(fields.widowPensionPct, { value: '55' });
    Object.assign(fields.survivorFloorPercent, { value: '70' });
    const doc = { getElementById: id => fields[id] || null }, before = readWidowOptions(doc);
    const status = { schemaVersion: 1, status: 'unmarried', inheritance: { max: 100 } };
    const storage = { getItem: () => JSON.stringify(status) };
    renderPartnershipSummary(doc, { simulationPeople: [{ profileId: 'max', name: 'Max' }, { profileId: 'erika', name: 'Erika' }] }, storage);
    assert(fields.widowPensionMode.disabled && fields.widowPensionPct.disabled && fields.widowPensionMode.hidden, 'Nicht verheiratet sperrt Renteneditor und zeigt die vorbereitete Anzeige');
    assert(!fields.survivorFloorPercent.disabled, 'Grundbedarf nach dem Tod bleibt einstellbar');
    assert(fields.simPartnershipText.textContent.includes('Erika 100 % von Max'), 'Simulatorband nennt die tatsächlichen Erbanteile');
    same(readWidowOptions(doc), before, 'Partnerschaftsanzeige verändert den bisherigen Renten-Rechenvertrag nicht');
    status.status = 'married'; renderPartnershipSummary(doc, { simulationPeople: [{}, {}] }, storage);
    assert(!fields.widowPensionPct.disabled && !fields.widowPensionPct.hidden && fields.simPartnershipNotice.hidden, 'Verheiratet stellt den ursprünglichen Editor wieder her');
}
const initial = createMusterHaushaltRecords('2026-10-20'), storage = storageOf(initial);
assertEqual(readPartnership(null).status, 'married', 'Bestehender Haushalt bleibt verheiratet');
same(readImmobilien(null), [], 'Fehlende Liste bedeutet keine Immobilie');
same(readImmobilien(writeImmobilien(homes)), homes, 'Immobilienliste behält alle Angaben');
same(inheritancePreview(414000, 660000, 100), { remains: 97800, leaves: 0, home: 660000, tax: 316200, taxable: 1054000, rate: .3, shortfall: 0 }, 'Steuervorschau entspricht freigegebenem Entwurf mit Immobilien');
assertEqual(inheritancePreview(414000, 0, 0).tax, 0, 'Ohne Erbe keine Steuer');
assertEqual(inheritancePreview(7000000, 0, 100).rate, .5, 'Oberhalb 6 Mio. steuerpflichtig gelten 50 Prozent');
assertEqual(inheritancePreview(10000, 900000, 100).shortfall, 257000, 'Steuerlücke bleibt sichtbar, Immobilie wird nicht verwertet');
const partnership = { schemaVersion: 1, status: 'unmarried', maritalPropertyRegime: 'community', inheritance: { muster_a: 100, muster_b: 0 } };
saveProfileAssetValues({ ...loadProfileAssetValues(storage), immobilien: homes }, storage);
storage.setItem(PARTNERSHIP_KEY, JSON.stringify(partnership));
const registry = JSON.parse(storage.getItem('rs_profiles_v1')), id = storage.getItem('rs_current_profile');
registry.profiles[id].data = captureProfileData(storage); storage.setItem('rs_profiles_v1', JSON.stringify(registry));
const bundle = exportProfilesBundle({ storage }), target = storageOf(initial);
assert(importProfilesBundle(bundle, { storage: target }).ok, 'Profilbundle mit Partnerschaft und Immobilien importierbar');
same(readImmobilien(target.getItem(IMMOBILIEN_KEY)), homes, 'Profilbundle erhält Immobilien');
same(readPartnership(target.getItem(PARTNERSHIP_KEY)), partnership, 'Profilbundle erhält Partnerschaft');
for (const schemaVersion of [1, 2]) {
    const backup = buildFullPersistenceBackup({ storage }); backup.schemaVersion = schemaVersion;
    const normalized = normalizeFullPersistenceBackup(backup);
    assert(normalized.ok, `Vollsicherung Schema ${schemaVersion} importierbar`);
    assertEqual(normalized.backup.records[IMMOBILIEN_KEY], writeImmobilien(homes), 'Sicherung erhält Immobilienbytes');
    assertEqual(normalized.backup.records[PARTNERSHIP_KEY], JSON.stringify(partnership), 'Sicherung erhält Partnerschaftsbytes');
}
for (const value of [-1, 101, null, '100']) assertEqual(validatePersistenceDomainRecords({ ...storage.records,
    [PARTNERSHIP_KEY]: JSON.stringify({ ...partnership, inheritance: { muster_a: value } }) }).ok, false, 'Import verwirft ungültige Erbquote');
for (const patch of [{ wert: -1 }, { stand: '2026-13' }, { nutzung: 'fremd' }, { mieteNetto: -1 }, { anpassung: 'lohn' }]) {
    assertEqual(validatePersistenceDomainRecords({ ...storage.records, [IMMOBILIEN_KEY]: JSON.stringify({ schemaVersion: 1, entries: [{ ...homes[0], ...patch }] }) }).ok, false, 'Import verwirft ungültige Immobilie');
}
const rent = immobilienIncome(homes);
const incomeRecords = { ...initial, [INCOME_KEY]: writeIncome(rent) };
const balanceRent = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 }).engineInput;
const balanceIncome = buildBalanceEngineInputFromStorage({ storage: storageOf(incomeRecords), referenceYear: 2026 }).engineInput;
same(balanceRent, balanceIncome, 'Balance: 650 Euro Miete entspricht vollständig derselben festen Einkunft');
const read = data => buildSimulatorInputsFromProfileData(data, { referenceYear: 2026, planValues: null });
const readPair = data => combineSimulatorProfiles(Object.entries(registry.profiles).map(([profileId, person]) => ({ profileId,
    name: person.meta.name, inputs: read(profileId === id ? data : person.data) })), id).combined;
const withHomes = readPair(registry.profiles[id].data);
const fixedData = { ...registry.profiles[id].data, [INCOME_KEY]: writeIncome(rent) }; delete fixedData[IMMOBILIEN_KEY];
const withIncome = readPair(fixedData);
assertEqual(withHomes.home[0].profileId, id, 'Simulator erhält Immobilien mit Personenkennung');
assertEqual(withHomes.home.length, 2, 'Auch selbst genutztes Haus wird übergeben');
same(withHomes.fixedIncome, withIncome.fixedIncome, 'Zentrale Ableitung verwendet denselben Einkunftsvertrag');
const noHome = { ...registry.profiles[id].data }; delete noHome[IMMOBILIEN_KEY];
const baseline = readPair(noHome), emptyHomes = readPair({ ...noHome, [IMMOBILIEN_KEY]: writeImmobilien([]) });
same(baseline, emptyHomes, 'Ohne Immobilien bleiben Simulator-Eingaben bytegleich');
prepareHistoricalDataOnce();
const mc = inputs => runMonteCarloChunk({ inputs, widowOptions: inputs.widowOptions, useCapeSampling: false, engine: EngineAPI,
    monteCarloParams: { anzahl: 2, maxDauer: 6, blockSize: 3, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' },
    runRange: { start: 0, count: 2 }, logIndices: [0, 1] });
const rentalMc = await mc(withHomes);
assertEqual(rentalMc.technicalInventory.technicalError, 0, 'Mietpfade ohne technische Fehler');
sameFinancial(rentalMc, await mc(withIncome), 'Monte Carlo: Miete und feste Einkunft bleiben bis auf den Immobilien-Anzeigewert bytegleich');
sameFinancial(backtest(withHomes, 2000, 2005).rows, backtest(withIncome, 2000, 2005).rows, 'Backtest: Miete und feste Einkunft bleiben bis auf den Immobilien-Anzeigewert bytegleich');
same(await mc(baseline), await mc(emptyHomes), 'Monte Carlo ohne Immobilien bleibt bytegleich');
same(backtest(baseline, 2000, 2005), backtest(emptyHomes, 2000, 2005), 'Backtest ohne Immobilien bleibt bytegleich');
{
    const f = await playFixture('tauri', storage.records); let controller = await f.boot();
    const exported = await previewPersonExport(id);
    assertEqual(exported.file.registry.profiles[id].data[IMMOBILIEN_KEY], writeImmobilien(homes), 'Personendatei enthält Immobilien');
    assertEqual(Object.keys(exported.file.globals).length, 0, 'Personendatei übernimmt keine Partnerschaft');
    const draft = await previewPersonImport(exported.file); const imported = await importPersonFile(draft);
    assertEqual(JSON.parse(P.getItemSync('rs_profiles_v1')).profiles[imported.id].data[IMMOBILIEN_KEY], writeImmobilien(homes), 'Personenimport erhält Immobilien');
    const baseline = f.realBytes();
    await controller.start(() => ({ source: 'copy', testDate: '2026-12-15' })); controller = await f.boot();
    assertEqual(P.getItemSync(IMMOBILIEN_KEY), writeImmobilien(homes), 'Spielbereich kopiert Immobilien');
    assertEqual(P.getItemSync(PARTNERSHIP_KEY), JSON.stringify(partnership), 'Spielbereich kopiert Partnerschaft');
    const nodes = Object.fromEntries(['managerPartnership', 'managerPartnershipStatus', 'managerPartnershipRetry', 'managerInheritance', 'managerPartnershipMarried',
        'managerMaritalPropertyRegime', 'managerMaritalPropertyField', 'managerMaritalPropertyInfo', 'managerJointAssessmentField', 'managerPartnershipToggle', 'managerPartnershipBody', 'managerPartnershipSummary', 'managerPartnershipAction'].map(id => [id,
        { hidden: id === 'managerPartnershipBody', textContent: '', innerHTML: '', attributes: {}, listeners: {},
            setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, fn) { this.listeners[type] = fn; }, querySelectorAll() { return []; } }]));
    const doc = { getElementById: id => nodes[id] || null, addEventListener() {}, querySelectorAll() { return []; } };
    const projection = { profiles: ['max', 'erika'].map((name, i) => ({ id: i ? 'muster_b' : 'muster_a', name, belongs: true, valid: true, assets: i ? 376000 : 414000, values: { immobilien: [] } })) };
    renderManagerPartnership(doc, projection);
    const editor = bindManagerPartnership(doc, { runOperation: execute => execute({ check() {}, commit() {} }) });
    assert(nodes.managerJointAssessmentField.hidden, 'Unverheiratet verbirgt Zusammenveranlagung');
    assert(nodes.managerPartnershipBody.hidden, 'Partnerschaft startet eingeklappt');
    assertEqual(nodes.managerPartnershipSummary.textContent, 'Nicht verheiratet · erika erbt 100 % von max · max erbt 0 % von erika', 'Kurzstand ordnet Erbanteile den Personen zu');
    const partnershipBytes = P.getItemSync(PARTNERSHIP_KEY);
    nodes.managerPartnershipToggle.listeners.click();
    assert(!nodes.managerPartnershipBody.hidden && nodes.managerPartnershipToggle.attributes['aria-expanded'] === 'true'
        && nodes.managerPartnershipAction.textContent === '▾ ausblenden', 'Partnerschaft öffnet mit demselben Klappmuster wie Ausgaben');
    nodes.managerPartnershipToggle.listeners.click();
    assert(nodes.managerPartnershipBody.hidden && nodes.managerPartnershipToggle.attributes['aria-expanded'] === 'false'
        && nodes.managerPartnershipAction.textContent === '▸ zeigen', 'Partnerschaft lässt sich wieder schließen');
    assertEqual(P.getItemSync(PARTNERSHIP_KEY), partnershipBytes, 'Auf- und Zuklappen ändert keine Partnerschaftsbytes');
    const choice = { dataset: { partnership: 'married' } };
    nodes.managerPartnership.listeners.click({ target: { closest: selector => selector === '[data-partnership]' ? choice : null } });
    assert(await editor.flush(), 'Partnerschaftseditor bestätigt seinen Fachwrite im Spielbereich');
    assertEqual(readPartnership(P.getItemSync(PARTNERSHIP_KEY)).status, 'married', 'Partnerschaftswechsel wird dauerhaft im Spielbereich bestätigt');
    assertEqual(nodes.managerPartnershipSummary.textContent, 'Verheiratet oder eingetragene Partnerschaft · Zugewinngemeinschaft (gesetzlich) · erika erbt 100 % von max · max erbt 100 % von erika', 'Kurzstand folgt dem Partnerschaftswechsel');
    assert(nodes.managerMaritalPropertyInfo.textContent.includes('Ehejahre davor zählen nicht, daher kann die echte Steuer bei langer Ehe niedriger oder höher sein.'), 'Ehevorschau erklärt die Modellgrenze auch unter dem Freibetrag');
    assert(!nodes.managerInheritance.innerHTML.includes('Familienheim-Befreiung angenommen'), 'Ohne selbst genutzte Immobilie kein Familienheim-Hinweis');
    assert(!nodes.managerMaritalPropertyField.hidden && nodes.managerMaritalPropertyRegime.value === 'community', 'Ehe zeigt Güterstand mit Vorgabe Zugewinngemeinschaft');
    assert(!nodes.managerJointAssessmentField.hidden, 'Ehe zeigt Zusammenveranlagung unter dem Güterstand');
    const beforeRegime = nodes.managerPartnershipMarried.textContent;
    nodes.managerPartnership.listeners.change({ target: { id: 'managerMaritalPropertyRegime', value: 'separation' } });
    assert(await editor.flush(), 'Güterstand wird durch dieselbe bestätigte Speicherung gesichert');
    assertEqual(readPartnership(P.getItemSync(PARTNERSHIP_KEY)).maritalPropertyRegime, 'separation', 'Gütertrennung bleibt gespeichert');
    assert(nodes.managerMaritalPropertyInfo.textContent.includes('Kein Zugewinnausgleich (Gütertrennung). Ohne Versorgungsfreibetrag.'), 'Vorschautext nennt Gütertrennung');
    assert(!beforeRegime.includes('Kein Zugewinnausgleich'), 'Vorschautext folgt dem gewählten Güterstand');

    renderManagerPartnership(doc, { profiles: projection.profiles.map((person, index) => ({ ...person,
        values: { ...person.values, immobilien: index ? [] : [homes[0], { ...homes[0], id: 'zweites-haus' }] } })) });
    assert(nodes.managerInheritance.innerHTML.includes('Familienheim-Befreiung angenommen')
        && nodes.managerInheritance.innerHTML.includes('Steuerfrei ist nur das Familienheim – bei mehreren selbst genutzten Immobilien die wertvollste.')
        && nodes.managerInheritance.innerHTML.includes('Die App prüft das nicht.'), 'Ehevorschau zeigt wirksame Befreiung, Bedingungen und Mehrfachhaus-Hinweis');
    renderManagerPartnership(doc, projection);
    const input = { dataset: { inheritancePerson: 'muster_a' }, value: '50', setAttribute() {} };
    const preview = { innerHTML: '' }, error = { textContent: '' };
    nodes.managerPartnership.querySelector = selector => selector.includes('data-inheritance-preview') ? preview
        : selector.includes('data-inheritance-error') ? error : null;
    nodes.managerPartnership.listeners.input({ target: { closest: () => input } });
    assertEqual(nodes.managerPartnershipStatus.textContent, 'Wird beim Verlassen des Feldes gespeichert', 'Beim Tippen erklärt der Status den Speicherzeitpunkt');
    assert(nodes.managerPartnershipRetry.hidden, 'Eingabe 50 zeigt keinen Knopf Speichern wiederholen');
    assert(await editor.flush(), 'Ehequote wird im selben Editor gespeichert');
    const savedMarriage = readPartnership(P.getItemSync(PARTNERSHIP_KEY));
    assertEqual(savedMarriage.marriedInheritance.muster_a, 50, 'Ehequote hat einen eigenen Speicherplatz');
    assertEqual(savedMarriage.inheritance.muster_a, 100, 'Ehequote überschreibt die unverheiratete Quote nicht');
    for (const schemaVersion of [1, 2]) {
        const backup = buildFullPersistenceBackup(); backup.schemaVersion = schemaVersion;
        const normalized = normalizeFullPersistenceBackup(backup);
        assert(normalized.ok, 'Sicherung mit beiden Erbquoten bleibt importierbar');
        assertEqual(normalized.backup.records[PARTNERSHIP_KEY], P.getItemSync(PARTNERSHIP_KEY), 'Sicherung erhält beide Erbquoten bytegleich');
    }
    choice.dataset.partnership = 'unmarried'; f.fail = true;
    nodes.managerPartnership.listeners.click({ target: { closest: selector => selector === '[data-partnership]' ? choice : null } });
    assertEqual(await editor.flush(), false, 'Fehlgeschlagener Partnerschaftswrite bleibt wiederholbar');
    assertEqual(readPartnership(P.getItemSync(PARTNERSHIP_KEY)).status, 'married', 'Rollback erhält den bestätigten Partnerschaftsstand');
    assert(editor.read().dirty && nodes.managerPartnershipStatus.textContent.includes('Nicht gespeichert'), 'Fehler lässt Entwurf und Rückmeldung stehen');
    assert(!nodes.managerPartnershipRetry.hidden, 'Erst nach einem echten Speicherfehler erscheint Speichern wiederholen');
    assert(await editor.flush(), 'Wiederholung bestätigt denselben Partnerschaftsentwurf');
    assert(nodes.managerPartnershipRetry.hidden, 'Nach erfolgreicher Wiederholung verschwindet der Knopf');
    assertEqual(readPartnership(P.getItemSync(PARTNERSHIP_KEY)).status, 'unmarried', 'Retry speichert die gewünschte Partnerschaft');
    assert(nodes.managerMaritalPropertyField.hidden, 'Nicht verheiratet blendet Güterstand aus');
    assertEqual(readPartnership(P.getItemSync(PARTNERSHIP_KEY)).maritalPropertyRegime, 'separation', 'Partnerschaftswechsel erhält den gespeicherten Güterstand');
    assertEqual(readPartnership(P.getItemSync(PARTNERSHIP_KEY)).marriedInheritance.muster_a, 50, 'Umschalten erhält die Ehequote');
    nodes.managerPartnership.listeners.input({ target: { closest: () => input } });
    assert(preview.innerHTML.replaceAll('\u00a0', ' ').includes('30 % auf 187.000 € steuerpflichtig (207.000 € − 20.000 € Freibetrag)'), 'Vorschau nennt steuerpflichtigen Erwerb und Freibetrag');
    assert(!preview.innerHTML.includes('Härteausgleich'), '207.000 Euro Erbe ohne tatsächlichen Härteausgleich zeigt keinen solchen Hinweis');
    assert(await editor.flush(), 'Unverheiratete Quote gespeichert');
    input.value = '100'; nodes.managerPartnership.listeners.input({ target: { closest: () => input } });
    assert(await editor.flush(), 'Test stellt die ursprüngliche Quote wieder her');
    renderManagerPartnership(doc, { profiles: projection.profiles.map(person => ({ ...person, assets: 6021000 })) });
    assert(nodes.managerInheritance.innerHTML.includes('mit Härteausgleich'), 'Vorschau benennt einen tatsächlich wirksamen Härteausgleich');
    projection.profiles[0].values.immobilien = homes;
    renderManagerPartnership(doc, projection);
    assert(nodes.managerInheritance.innerHTML.includes('data-inheritance-home="muster_a"')
        && !nodes.managerInheritance.innerHTML.includes('data-inheritance-home="muster_b"'), 'Häkchen nur bei Immobilien der verstorbenen Person');
    const homeChoice = { dataset: { inheritanceHome: 'muster_a' }, checked: true };
    nodes.managerPartnership.listeners.change({ target: { closest: () => homeChoice } });
    assert(await editor.flush(), 'Immobilien und Steuergeld speichern ohne Prozentänderung');
    assertEqual(readPartnership(P.getItemSync(PARTNERSHIP_KEY)).homeAndTaxInheritance.muster_a, true, 'Häkchen hat eigenen Speicherplatz je Person');
    assert(nodes.managerInheritance.innerHTML.includes('erbt zusätzlich vom übrigen Geldvermögen')
        && nodes.managerInheritance.innerHTML.includes('Steuergeld aus dem Nachlass'), 'Häkchen ändert Beschriftung und Vorschau');
    assert(nodes.managerInheritance.innerHTML.includes('für Steuern beim Verkauf von Wertpapieren')
        && nodes.managerInheritance.innerHTML.includes('Vorschau vorsichtig mit Einstand 0'), 'Vorschau nennt Verkaufssteuer und fehlenden Einstand');
    assert(nodes.managerPartnershipSummary.textContent.includes('erika erbt Haus + Steuer'), 'Kurzstand nennt die Immobilienwahl mit dem Profilnamen');
    const homeBackup = normalizeFullPersistenceBackup(buildFullPersistenceBackup());
    assert(homeBackup.ok && homeBackup.backup.records[PARTNERSHIP_KEY] === P.getItemSync(PARTNERSHIP_KEY), 'Sicherung erhält Immobilienwahl und Prozentquoten bytegleich');
    renderManagerPartnership(doc, projection);
    assert(nodes.managerInheritance.innerHTML.includes('data-inheritance-home="muster_a" checked'), 'Gespeicherte Immobilienwahl erscheint nach erneutem Laden gesetzt');
    renderManagerPartnership(doc, { profiles: projection.profiles.slice(0, 1) });
    assert(nodes.managerPartnership.hidden, 'Partnerschaft bleibt bei nur einer Person verborgen');


    P.setItemSync(IMMOBILIEN_KEY, writeImmobilien([])); P.setItemSync(PARTNERSHIP_KEY, JSON.stringify({ ...partnership, status: 'married' })); await P.flush();
    await controller.changeDate('2027-01-02'); controller = await f.boot();
    same(readImmobilien(P.getItemSync(IMMOBILIEN_KEY)), [], 'Änderung bleibt nach Spiel-Datumssprung erhalten');
    assertEqual(f.realBytes(), baseline, 'Spieländerung lässt Echtbestand bytegleich');
    await controller.end(() => true); await f.boot();
    assertEqual(P.getItemSync(IMMOBILIEN_KEY), writeImmobilien(homes), 'Rückkehr stellt Immobilien wieder her');
    assertEqual(P.getItemSync(PARTNERSHIP_KEY), JSON.stringify(partnership), 'Rückkehr stellt Partnerschaft wieder her');
    assertEqual(f.realBytes(), baseline, 'Rückkehr erhält alle echten Bytes');
    resetPersistenceForTests();
}
