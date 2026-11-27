// NR-1b: Regressionen aus dem Neon-Re-Audit mit Januar- oder Datenwirkung.
import fs from 'node:fs';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { computeHouseholdNeedsStats, computeYearStats, expenseConvention, expenseConventions } from '../app/balance/balance-expenses-metrics.js';
import { requestOverviewMonthConfirmation } from '../app/overview/overview-month-confirmation.js';
import { overviewPricesDone } from '../app/overview/overview-model.js';
import { createDialogFixture, prepareCloseFixture, settleAnnualReading } from './close-dialog.test.mjs?fixture';
import { annualTestMarketData } from './helpers/balance-storage-fixtures.mjs';
import { createManualAnnualQuote } from '../app/shared/annual-marketdata.js';

// Jeder Punkt läuft für sich; ein Fehlschlag zählt, hält die übrigen Nachweise aber nicht an.
const section = async run => { try { await run(); } catch (error) { if (!error?.isTestAssertionError) throw error; } };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

// M1: Springt der abgerufene CAPE um mehr als 25 %, ist das Handfeld offen; ein eingetragener Wert ersetzt den Abruf.
await section(async () => {
    const { doc } = createDialogFixture();
    let binding;
    const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
    const people = [{ id: 'a', name: 'Max', value: 10000, lastDate: '2026-12-31', confirmedDate: null }];
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
        readCapeReference: () => ({ value: 30, label: 'Jahresabschluss 2025' }),
        projectMarketReadings: async () => null, projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }) });
    const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people, onReady: handle => { binding = handle; } });
    binding.updateMarketData({ values: { ...annualTestMarketData, cape: { ...annualTestMarketData.cape, capeRatio: 40 } }, errors: {} });
    await tick();
    await prepareCloseFixture(doc, { confirmTagesgeld: false, confirmCape: false });
    const confirm = () => doc.getElementById('annualConfirmBtn');
    const input = doc.getElementById('annualHandCape');
    assert(confirm().disabled && doc.querySelector('[data-annual-cape-confirm]'), 'M1: der Sprung verlangt weiter eine Entscheidung');
    assert(input && !input.parent.hidden && !input.disabled, 'M1: das Handfeld ist beim Sprung sichtbar und bedienbar');
    input.value = '31'; await input.fire('input');
    await tick(); await settleAnnualReading(doc);
    assert(!doc.querySelector('[data-annual-cape-confirm]') && !confirm().disabled, 'M1: der eingetragene Wert ersetzt den gesprungenen Abruf');
    await confirm().fire('click');
    const result = await pending;
    assertEqual(result?.preparedMarketData?.cape?.capeRatio, 31, 'M1: der eingetragene Wert gilt');
    assertEqual(result?.preparedMarketData?.cape?.capeSource, 'Manuelle Ergänzung', 'M1: mit Herkunft von Hand');
    binding.close(true);
});

// Zusatz B: Alle manuellen Marktdatenfelder verwenden dieselbe Zahlensyntax.
await section(async () => {
    for (const [typed, price, inflation, cape] of [
        ['160,40', 160.4, '2,25', '29,1'],
        ['160.40', 160.4, '2.25', '29.1'],
        ['1.234,56', 1234.56, '2.125', '29,125']
    ]) {
        const { doc } = createDialogFixture();
        let binding;
        const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
        const people = [{ id: 'a', name: 'Max', value: 10000, lastDate: '2026-12-31', confirmedDate: null }];
        const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
            readCapeReference: () => ({ value: 28, label: 'Jahresabschluss 2025' }),
            projectMarketReadings: async () => null, projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }) });
        const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people, onReady: handle => { binding = handle; },
            validatePrice: value => ({ manualPrice: createManualAnnualQuote(value, 'calendar-year:2026').price }) });
        binding.updateMarketData({ values: {}, errors: { etf: 'Kein Schlusskurs abgerufen.' } });
        await tick();
        await prepareCloseFixture(doc, { confirmTagesgeld: false, confirmCape: false });
        for (const [id, value] of [['annualHandPrice', typed], ['annualHandInflation', inflation], ['annualHandCape', cape]]) {
            const input = doc.getElementById(id); input.value = value; await input.fire('input');
        }
        await doc.querySelector('[data-annual-care-confirm]')?.fire('click');
        await tick(); await settleAnnualReading(doc);
        assertEqual(doc.getElementById('annualHandPriceError').textContent, '', `Handkurs ${typed}: keine Fehlermeldung`);
        assert(!doc.getElementById('annualConfirmBtn').disabled, `Handkurs ${typed}: der Abschluss geht weiter`);
        await doc.getElementById('annualConfirmBtn').fire('click');
        const result = await pending;
        assertEqual(result?.manualPrice, price, `Handkurs ${typed}: gilt beim Bestätigen`);
        assertEqual(result?.preparedMarketData?.etf?.price, price, `Handkurs ${typed}: gilt in den vorbereiteten Marktdaten`);
        assertEqual(result?.preparedMarketData?.inflation?.rate, Number(inflation.replace(',', '.')), 'Handinflation behält die Dezimalstellen');
        assertEqual(result?.preparedMarketData?.cape?.capeRatio, Number(cape.replace(',', '.')), 'Hand-CAPE behält die Dezimalstellen');
        binding.close(true);
    }
});

// M2, M3 und E4 (Rust): Laufzeitnachweis über cargo test beim EXE-Bau; hier nur die Quellprüfung.
const rust = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const rustTest = name => rust.includes(`#[test]\n  fn ${name}()`);
await section(async () => {
    assert(rustTest('close_allow_waits_for_running_saves_up_to_the_save_limit'), 'M2: Rusttest für das Warten nach der JS-Freigabe vorhanden');
    assert(/fn allow\(&mut self, id: u64, now_ms: u64\) -> bool \{[\s\S]*?self\.saves\.is_empty\(\)/.test(rust), 'M2: die JS-Freigabe prüft laufende Speicherungen');
    assert(/"allow" =>[\s\S]*?thread::spawn\(move \|\| close_after_saves\(&window, id\)\)/.test(rust), 'M2: nach der Freigabe schließt das Fenster erst nach den Speicherungen');
});
await section(async () => {
    assert(rustTest('live_delete_sets_aside_stale_backup_so_it_cannot_return_as_main'), 'M3: Rusttest für die alte .json.bak vorhanden');
    assert(/fn delete_live_files\(file_path: &Path\) -> Result<\(\), String> \{\n  set_aside_stale_backup\(file_path\)\?;/.test(rust), 'M3: die Rücknahme legt eine alte .json.bak vorher beiseite');
});
await section(async () => {
    assert(rust.includes('fn is_local_origin(') && rust.includes('"http://localhost:8000.attacker.com"') && rust.includes('fn allowed_cors_origin(origin: &str) -> Option<&str>'),
        'E4: exakte Herkunftsprüfung, fremde Herkunft ohne Freigabekopf, Präfixfall im Rusttest');
});

// M4: Eine einzelne Erstattung in einem positiven Altimport kippt die Jahreskonvention nicht mehr.
await section(async () => {
    const month = categories => ({ categories });
    const regular = { Wohnen: 1200, Lebensmittel: 600, Mobilitaet: 200 };
    const positive = { months: { 1: { profiles: { a: month(regular) } }, 2: { profiles: { a: month({ ...regular, Nebenkosten: -200 }) } },
        3: { profiles: { a: month(regular) } } } };
    assertEqual(expenseConventions(positive).get('a'), 1, 'M4: eine Erstattung von 200 € lässt die positive Konvention stehen');
    assertEqual(expenseConvention({ ...regular, Nebenkosten: -200 }), 1, 'M4: gleiche Regel für einen einzelnen Import');
    assertEqual(Math.round(computeYearStats({ yearData: positive }).annualForecast), 23200, 'M4: Hochrechnung 1.933 € im Monat statt 0 €');
    assertEqual(Math.round(computeHouseholdNeedsStats({ yearData: positive }).annualForecast.total), 23200, 'M4: Bedarfshochrechnung ebenso');
    // Gegenprobe: Ein signierter Import bleibt negativ, auch mit einer Erstattung über mehrere Kategorien.
    const signed = { months: { 1: { profiles: { a: month({ Wohnen: -1200, Lebensmittel: -600 }) } }, 2: { profiles: { a: month({ Wohnen: -1200, Erstattung: 300 }) } } } };
    assertEqual(expenseConventions(signed).get('a'), -1, 'M4: signierter Import bleibt bei negativen Ausgaben');
    assertEqual(Math.round(computeYearStats({ yearData: signed }).annualForecast), 16200, 'M4: signierte Hochrechnung unverändert');
});

// M5: Fehlt der Ausgabenimport, steht im Reiter auch nach dem Ansehen „Import fehlt“ im Warnton. Der Abschluss bleibt möglich.
await section(async () => {
    const { doc } = createDialogFixture();
    let handle;
    const now = new Date(2026, 9, 8, 12);
    const model = { activeId: 'a', now, scope: { key: 'single:a', ids: ['a'] }, members: [{ id: 'a', name: 'A', count: 2 }], quoteDate: now.toISOString(),
        occasion: { kind: 'monthly', month: '2026-09', previousYear: 2026, previousMonth: 9 },
        expenses: { year: 2026, month: 9, complete: false, spent: null, rows: [{ id: 'a', present: false }] },
        summary: { monthlyWithdrawal: 500 }, expenseBudget: 700,
        cashPeople: [{ id: 'a', name: 'A', value: 18000, lastDate: '2026-09-01', error: null }] };
    const pending = requestOverviewMonthConfirmation({ doc, model, people: model.cashPeople, onReady: value => { handle = value; } });
    const tab = doc.querySelector('[data-close-dialog-activate="expenses"]');
    await prepareCloseFixture(doc);
    assertEqual(doc.querySelector('[data-close-dialog-step="expenses"]').dataset.visited, 'true', 'M5: Ausgaben angesehen');
    assertEqual(tab.querySelector('.close-dialog-step-pill').textContent, 'Import fehlt', 'M5: der Reiter nennt den fehlenden Import');
    assertEqual(tab.dataset.tone, 'warning', 'M5: im Warnton wie „über Budget“');
    assert(tab.getAttribute('aria-label').includes('Import fehlt'), 'M5: auch im aria-label');
    assert(!doc.querySelector('[data-overview-month-accept]').disabled, 'M5: Ausgaben bleiben eine Empfehlung und sperren den Abschluss nicht');
    handle.update({ ...model, expenses: { ...model.expenses, complete: true, spent: 650, rows: [{ id: 'a', present: true, spent: 650 }] } });
    assertEqual(tab.querySelector('.close-dialog-step-pill').textContent, 'angesehen', 'M5: mit vollständigem Import wie bisher');
    assertEqual(tab.dataset.tone, '', 'M5: ohne Warnton');
    handle.close(false); await pending;
});

// P1-1: Ein vollständiger heutiger Startabruf über eine Abendbörse bestätigt den Jahresstand nicht.
await section(async () => {
    const { doc, nodes } = createDialogFixture();
    const now = new Date(2027, 0, 4, 19, 30);
    const asOf = now.getTime() / 1000 - 60;
    const lot = { profileId: 'a', trancheId: 'v', ticker: 'VWCE.DE', asOf, quoteExchange: 'Stuttgart', currentPrice: 160 };
    const model = { now, quoteDate: new Date(asOf * 1000).toISOString(), priceTranches: [lot],
        occasion: { kind: 'annual', closingYear: 2026, previousYear: 2026, previousMonth: 12 }, expenses: { complete: true },
        priceReport: { status: 'complete', updated: 1, retrievedAt: now.getTime(),
            results: [{ profileId: 'a', trancheId: 'v', status: 'updated', asOf, quoteExchange: 'Stuttgart' }] } };
    assert(!overviewPricesDone(model), 'P1-1: Abendbörsenkurs bestätigt den Jahresstand nicht');
    assert(overviewPricesDone({ ...model, occasion: { ...model.occasion, kind: 'monthly' } }), 'P1-1: Tageskurs im Monatsabschluss gültig');
    assert(!overviewPricesDone({ ...model, priceTranches: [{ ...lot, quoteExchange: undefined }] }), 'P1-1: unbekannte Herkunft bleibt offen');
    const updated = { ...model, priceTranches: [{ ...lot, quoteExchange: 'Xetra' }],
        priceReport: { ...model.priceReport, results: [{ ...model.priceReport.results[0], quoteExchange: 'Xetra' }] } };
    assert(overviewPricesDone(updated), 'P1-1: Abruf aus Xetra bestätigt den Jahresstand');
    assert(overviewPricesDone({ ...model, priceTranches: [{ ...lot, ticker: 'VWCE.SG' }] }), 'P1-1: Eine anders eingetragene Börse bleibt möglich');
    let handle;
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false });
    const pending = ui.showAnnualPreparation({ targetYear: 2026, model, onReady: value => { handle = value; } });
    const tab = doc.querySelector('[data-close-dialog-activate="prices"]');
    await tab.fire('click');
    assertEqual(tab.querySelector('.close-dialog-step-pill').textContent, 'Xetra prüfen', 'P1-1: Warnung bleibt nach Ansehen');
    assertEqual(tab.dataset.state, 'current', 'P1-1: Kursprüfung bleibt offen');
    assert(nodes.some(node => node.isConnected && node.tag === 'td' && node.textContent.includes('Stuttgart · nicht Xetra')), 'P1-1: Kurszeile nennt Herkunft');
    handle.update(updated);
    assertEqual(tab.querySelector('.close-dialog-step-pill').textContent, 'angesehen', 'P1-1: korrekter Abruf hebt die Warnung auf');
    handle.close(false); await pending;
});

// P2-1: Mehrere Zeichen und ein Komma mitten im Text tippen, ohne erneut zu fokussieren.
await section(async () => {
    const { doc } = createDialogFixture();
    let handle;
    const ui = createAnnualCloseDialog({ document: doc, isCommitActive: () => false,
        projectMarketReadings: async () => null, projectPreview: () => ({ people: [], needs: [] }) });
    const pending = ui.showAnnualPreparation({ targetYear: 2026, onReady: value => { handle = value; } });
    handle.updateMarketData({ values: {}, errors: { inflation: 'Fehlt.' } });
    await doc.querySelector('[data-close-dialog-activate="market"]').fire('click');
    const input = doc.getElementById('annualHandInflation');
    const manualSection = input.parent.parent;
    input.focus(); input.selectionStart = 0;
    for (const [char, cursor] of [['2', 0], ['5', 1], [',', 1], ['2', 2]]) {
        assertEqual(doc.activeElement, input, 'P2-1: Jede Taste erreicht das fokussierte Feld');
        input.value = input.value.slice(0, cursor) + char + input.value.slice(cursor);
        input.selectionStart = input.selectionEnd = cursor + 1;
        await input.fire('input');
        assertEqual(doc.activeElement, input, 'P2-1: Bericht aktualisiert, Feld bleibt fokussiert');
        assertEqual(input.parent.parent, manualSection, 'P2-1: Eingabe bleibt in derselben Sektion');
        assertEqual(input.selectionStart, cursor + 1, 'P2-1: Cursor bleibt hinter dem Zeichen');
    }
    assertEqual(input.value, '2,25', 'P2-1: vollständige Eingabe');
    handle.close(false); await pending;
});
