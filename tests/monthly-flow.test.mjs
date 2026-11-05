// Monatsgleichung in Cent und ganzen Euro
import strict from 'node:assert/strict';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { readBalancePersonStatus } from '../app/shared/person-data-status.js';
import { balanceIncomeDetails, projectBalanceMonthlyFlow } from '../app/balance/balance-monthly-flow.js';
import { projectPlanMonthlyFlow, buildPlanOverview, initializePlanOverview, renderPlanMonthly } from '../app/simulator/simulator-plan-overview.js';
import { readDocumentPersonInputs } from '../app/simulator/simulator-person-overrides.js';
import { roundedIncomeDetails } from '../app/shared/monthly-flow.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { bindEuroMode } from '../app/simulator/euro-display.js';

function check(flow, label) {
    for (const unit of ['cents', 'euros']) {
        const v = flow[unit];
        assert(Object.values(v).every(Number.isInteger), `${label}/${unit}: ganzzahlige Anzeigeeinheiten`);
        assertEqual(v.income + v.oneTime + v.withdrawal, v.budget + v.expenses + v.saving, `${label}/${unit}: Gleichung stimmt genau`);
        assert(v.withdrawal >= 0 && v.saving >= 0, `${label}/${unit}: keine negative Entnahme oder Anlage`);
    }
}
const saved = { document: globalThis.document, window: globalThis.window };
try {
    for (const household of ['max-erika', 'sophie']) {
        const inputs = await measurementInputs(0, household);
        const status = readBalancePersonStatus();
        const before = JSON.stringify(P.exportAllSync().records);
        const calc = buildBalanceEngineInputFromStorage({ storage: persistenceStorage, referenceYear: 2026 });
        const result = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
        if (result.error) throw result.error;
        const ui = { ...result.ui, input: calc.inputData };
        const flow = projectBalanceMonthlyFlow(ui);
        check(flow, `Balance ${household}`);
        const details = balanceIncomeDetails(status);
        assertClose(details.reduce((sum, item) => sum + item.amount, 0), calc.inputData.renteMonatlich, 1e-7, 'Einzelne Einkünfte stammen aus derselben Balance-Projektion');
        assertEqual(roundedIncomeDetails(details, flow.euros.income).reduce((sum, item) => sum + item.amount, 0), flow.euros.income, 'Sichtbare Einkunftszeilen ergeben ihre Summe');
        const balanceDoc = createPresentationTestDocument();
        const balanceOutputs = Object.fromEntries(['balanceMonthlyBudget', 'balanceMonthlyIncome', 'balanceFlowBudget',
            'balanceMonthlySaving', 'balanceBudgetBar', 'balanceFlowNeed'].map(id => {
            const node = balanceDoc.createElement('div'); node.id = id; return [id, node];
        }));
        const balanceDetails = balanceDoc.createElement('details'); balanceDetails.id = 'balanceIncomeDetails';
        const simDoc = document;
        globalThis.document = balanceDoc;
        new SummaryRenderer({ outputs: balanceOutputs }).renderPlanCards(ui);
        globalThis.document = simDoc;
        assertEqual(balanceOutputs.balanceMonthlyIncome.textContent, new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(flow.euros.income), 'Balance zeigt die Einkunftssumme in der Zeile');
        assert(balanceOutputs.balanceBudgetBar.children.length > 0 && balanceOutputs.balanceFlowBudget.textContent, 'Balance zeigt Balken und Monatsbudgetzeile');
        assert(balanceDetails.tagName === 'details' && balanceDetails.open !== true && balanceDetails.children[0].textContent.includes('Feste Einkünfte'), 'Balance startet mit geschlossenen festen Einkünften');
        assertEqual(balanceDetails.children[1].children.length, details.length, 'Balance legt alle Einzelposten im aufklappbaren Bereich ab');
        if (household === 'sophie') assert(balanceOutputs.balanceBudgetBar.children.some(node => node.className.includes('monthly-flow-saving')), 'Sophies Ansparjahr zeigt angelegt im Balken');
        const persons = readDocumentPersonInputs(document);
        const view = buildPlanOverview({ inputs, entries: persons.entries, referenceYear: 2026, inflationPct: 2, wagePct: 0 });
        if (household === 'sophie') assert(view.rows.find(row => row.year === 2029)?.expenses > 0, 'Sophie enthält das Autojahr 2029');
        const snapshot = JSON.stringify(view);
        for (const row of view.rows) for (const factor of [1, 1.02 ** (row.year - 2026)]) {
            const month = projectPlanMonthlyFlow(row, factor);
            check(month, `${household}/${row.year}/${factor}`);
            assertClose(month.cents.withdrawal / 100, Math.max(0, -row.result) / factor / 12, .025, 'Entnahme weicht nur durch Cent-Rundung ab');
            assertClose(month.cents.saving / 100, Math.max(0, row.result) / factor / 12, .025, 'Anlage weicht nur durch Cent-Rundung ab');
        }
        assertEqual(JSON.stringify(view), snapshot, 'Monatsanzeige verändert keine Jahresspalten');
        const create = document.createElement.bind(document);
        document.createElement = tag => { const node = create(tag); node.append = (...children) => children.forEach(child => node.appendChild(child)); return node; };
        for (const id of ['simPlanOverviewTable', 'simPlanMonthly', 'simPlanOverviewFootnote']) {
            const node = document.createElement('div'); node.id = id; document.body.appendChild(node);
            const clear = node.replaceChildren.bind(node);
            node.replaceChildren = (...children) => { clear(); children.forEach(child => node.appendChild(child)); };
        }
        const modeHosts = ['simPlanEuroMode', 'mcWealthMode', 'backtestWealthMode'].map(id => {
            const modeHost = document.getElementById(id) || document.createElement('div'); modeHost.id = id; document.body.appendChild(modeHost);
            for (const mode of ['nominal', 'real']) {
                const button = document.createElement('button'); button.setAttribute('data-wealth-mode', mode);
                button.closest = selector => selector === '[data-wealth-mode]' ? button : null;
                modeHost.appendChild(button);
            }
            modeHost.querySelectorAll = selector => selector === '[data-wealth-mode]' ? modeHost.children : [];
            return modeHost;
        });
        const queryAll = document.querySelectorAll.bind(document);
        document.querySelectorAll = selector => selector === '[data-wealth-mode]'
            ? modeHosts.flatMap(host => host.children) : queryAll(selector);
        bindEuroMode(document, modeHosts[2], () => {});
        initializePlanOverview();
        const host = document.getElementById('simPlanOverviewTable');
        const lines = host.children[0]?.children[1]?.children;
        assert(lines?.length > 1, `Bestehender Renderer erzeugt wählbare Jahreszeilen: ${host.textContent}`);
        assertEqual(lines[0].getAttribute('aria-selected'), 'true', 'Erstes Jahr ist vorausgewählt');
        lines[1].dispatchEvent({ type: 'click' });
        assertEqual(lines[1].getAttribute('aria-selected'), 'true', 'Klick wählt ein anderes Jahr');
        const monthly = document.getElementById('simPlanMonthly');
        assert(monthly.children[0].children[0].textContent.includes('2027'), 'Monatszeile zeigt das gewählte Jahr');
        const shownNeeds = () => host.children[0].children[1].children[1].children.at(-3).textContent;
        const shownMonthlyBudget = () => monthly.children[2].children.find(term => term.children.some(child => child.textContent === 'Monatsbudget ')).children.at(-1).textContent;
        assert(monthly.children[1].className === 'monthly-flow-bar' && monthly.children[1].children.length > 0, 'Simulator zeigt den gemeinsamen Balken');
        const monthlyDetails = monthly.children[3];
        assert(monthlyDetails.tagName.toLowerCase() === 'details' && monthlyDetails.open !== true, 'Simulator startet mit geschlossenen Einkunftsdetails');
        assertEqual(monthlyDetails.children[1].children.length, view.groups.filter((group, index) => view.rows[1].incomes[index] > 0).length, 'Simulator bewahrt alle Einkunftsdetails aufklappbar');
        const flatten = node => [node.textContent, ...(node.children || []).map(flatten)].join(' ');
        const monthlyText = flatten(monthly.children[0]);
        assertEqual(monthlyText.includes('mit Dynamik bis'), inputs.dynamicFlex === true, 'Nur Dynamic Flex ergänzt die Grenze neben laut Plan');
        if (inputs.dynamicFlex) assert(monthlyText.includes('Die Balance kann darüber liegen, wenn die Dynamik mehr erlaubt.'), 'Simulator erklärt Plan und Dynamik im Infofeld');
        const realNeeds = shownNeeds(), realMonthlyBudget = shownMonthlyBudget();
        modeHosts[0].dispatchEvent({ type: 'click', target: modeHosts[0].children[0] });
        assert(shownNeeds() !== realNeeds, 'Euro-Schalter unter Annahmen ändert die Jahrestabelle');
        assert(shownMonthlyBudget() !== realMonthlyBudget, 'Euro-Schalter unter Annahmen ändert die Monatszeile');
        for (const modeHost of modeHosts) assert(modeHost.children[0].getAttribute('aria-pressed') === 'true'
            && modeHost.children[1].getAttribute('aria-pressed') === 'false', `${modeHost.id} zeigt gemeinsam Nominal, auch vor dem ersten Monte-Carlo-Lauf`);
        assert(host.children[0].children[1].children[1].getAttribute('aria-selected') === 'true', 'Euro-Umschalten bewahrt die Jahresauswahl');
        assert(document.getElementById('simPlanOverviewFootnote').textContent.includes('nominale Euro'), 'Tabelle und Monatszeile nennen dieselbe Euro-Basis');
        assertEqual(JSON.stringify(P.exportAllSync().records), before, 'Anzeige und Auswahl schreiben keine gespeicherten Werte');
    }
    const halfCent = projectBalanceMonthlyFlow({ input: { renteAktiv: true, renteMonatlich: 1050.495 }, spending: { monatlicheEntnahme: 0 } });
    check(halfCent, 'Halber Cent aus Teiljahresrente');
    assertEqual(halfCent.euros.budget, 1051, 'Auch Teiljahresrenten runden zuerst auf Cent und danach auf Euro');
    const tiny = roundedIncomeDetails([{ amount: .6 }, { amount: .6 }, { amount: .6 }, { amount: .01 }], 2);
    assert(tiny.every(item => item.amount >= 0) && tiny.reduce((sum, item) => sum + item.amount, 0) === 2, 'Kleine Einkunftszeilen bleiben nach Rundung nichtnegativ und summengleich');
    const ui = { input: { renteAktiv: true, renteMonatlich: 3400.49, floorBedarf: 24000, flexBedarf: 6000 }, spending: { monatlicheEntnahme: 0 } };
    check(projectBalanceMonthlyFlow(ui), 'Balance synthetischer Überschuss');
    assertEqual(projectBalanceMonthlyFlow(ui).euros.budget, 2500, 'Ansparjahr begrenzt das Budget auf Grundbedarf und Flex');
    assertEqual(projectBalanceMonthlyFlow(ui).euros.saving, 900, 'Ansparjahr zeigt den nicht verbrauchten Anteil als angelegt');
    const row = { year: 2028, incomes: [28994.76, 20170.32], oneTime: 50000, needs: 62424, expenses: 1234.56, result: 35506.52 };
    check(projectPlanMonthlyFlow(row), 'Simulator synthetischer Überschuss mit Einmalkunft und Ausgabe');
    strict.equal(projectPlanMonthlyFlow(row).euros.withdrawal, 0);
    // Teiljahr, getrennte Einkunftseinträge und Pflegegeld stammen aus vorhandenen Ableitungen.
    const careStatus = { ready: true, referenceYear: 2026, entries: [{ profileId: 'max', name: 'Max', data: {
        profile_person_schema_version: '1', profile_geburtsdatum: '1958-01-01', profile_rentenbeginn: '2026-07-01',
        profile_rente_monatlich: '2300', profile_care_grade_today: '2', profile_sonstige_einkuenfte: '100'
    } }] };
    const items = balanceIncomeDetails(careStatus);
    assert(items.some(item => item.label === 'Pflegegeld Max' && item.amount > 0), 'Pflegegeld erscheint als persönliche Einkunft');
    assertEqual(items.find(item => item.label === 'Rente Max').amount, 1150, 'Rente enthält nur Monate im laufenden Budgetjahr');
    const dynamicDoc = createPresentationTestDocument();
    const dynamicHost = dynamicDoc.createElement('div'); dynamicHost.id = 'simPlanMonthly';
    const text = node => [node.textContent, ...node.children.map(text)].join(' ');
    const futureRow = { year: 2028, incomes: [30000], needs: 62424, oneTime: 0, expenses: 0, result: -32424 };
    for (const factor of [1, 1.0404]) {
        const before = JSON.stringify(futureRow);
        renderPlanMonthly(dynamicDoc, { groups: [{ label: 'Rente Max' }] }, futureRow,
            { dynamicFlex: true, startFloorBedarf: 30000, startFlexBedarf: 30000 }, factor);
        assert(text(dynamicHost).includes(factor === 1 ? 'mit Dynamik bis 7.803' : 'mit Dynamik bis 7.500'), 'Simulator schreibt die Dynamikgrenze in derselben Euro-Basis fort');
        assert(text(dynamicHost).includes('Die Balance kann darüber liegen, wenn die Dynamik mehr erlaubt.'), 'Dynamic Flex erklärt den Unterschied zum Plan im Infofeld');
        assertEqual(JSON.stringify(futureRow), before, 'Dynamikhinweis lässt die Jahreswerte bytegleich');
    }
} finally { Object.assign(globalThis, saved); setAppTestDate(null); P.resetPersistenceRuntimeForTests(); }
