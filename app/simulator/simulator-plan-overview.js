/** @import {CareAllowanceAnnual} from '../../typcheck/simulator-ui.js' */
import { getEuroMode, bindEuroMode, euroBasisLabel } from './euro-display.js';
import { projectMonthlyFlow, roundedIncomeDetails, renderIncomeDetails, renderMonthlyFlowBar } from '../shared/monthly-flow.js';
import { createInfoPopover, bindInfoPopovers } from '../shared/designsystem-info-popover.js';
import { annualOtherIncome, effectiveIncomeFromRecord } from '../profile/profile-income.js';
import { plannedExpenseOccurrences, plannedExpensesForYear } from '../profile/household-planned-expenses.js';
import { parseStoredBalanceInputsFromData } from '../profile/profile-state.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { CONFIG } from '../balance/balance-config.js';
import { calculateHouseholdPensionForYear } from './simulator-household-pension.js';
import { computeRentAdjRate } from './simulator-portfolio-pension.js';
import { readDocumentPersonInputs } from './simulator-person-overrides.js';
import { getCommonInputs } from './simulator-portfolio-inputs.js';
import { GERMAN_CPI_INFLATION_RATES } from './german-cpi-chain.js';
import { GERMAN_GROSS_WAGE_GROWTH_PCT } from './german-gross-wage-growth-chain.js';
import { careAllowanceAnnual, careFormForPerson } from '../shared/care-benefits.js';

// Die letzten 25 vollständigen Reihenjahre glätten einzelne Krisen-/Erholungsjahre.
// Diese Annahme gehört allein zur Plananzeige und wird weder gespeichert noch an Runner gegeben.
/**
 * @param [balance]
 * @returns Ergebnis der Operation.
 */
export function resolvePlanOverviewRates(balance = {}) {
    const rate = (raw, series, label) => {
        if (raw != null && String(raw).trim() !== '' && Number.isFinite(Number(raw))) {
            return { value: Number(raw), origin: 'zuletzt eingetragener Jahreswert' };
        }
        const years = Object.keys(series).map(Number).filter(year => Number.isFinite(series[year])).sort((a, b) => a - b).slice(-25);
        return { value: years.reduce((sum, year) => sum + series[year], 0) / years.length,
            origin: `Mittel ${years[0]}–${years.at(-1)}, ${label}, kein eigener Wert eingetragen` };
    };
    return { inflation: rate(balance?.inflation, GERMAN_CPI_INFLATION_RATES, 'Verbraucherpreisreihe'),
        wage: rate(balance?.lohnWachstum, GERMAN_GROSS_WAGE_GROWTH_PCT, 'Lohnreihe') };
}

/** Reine Planprojektion: kein Marktpfad, kein Tod und keine dynamische Flex-Entscheidung.
 *
 * @param {object} options
 * @param options.inputs
 * @param options.entries
 * @param options.referenceYear
 * @param options.inflationPct
 * @param options.wagePct
 * @returns Ergebnis der Operation.
 */
export function buildPlanOverview({ inputs, entries, referenceYear, inflationPct, wagePct }) {
    const rates = resolvePlanOverviewRates({ inflation: inflationPct, lohnWachstum: wagePct });
    inflationPct = rates.inflation.value; wagePct = rates.wage.value;
    const groups = [];
    const todayCare = today => ({ active: today?.grade > 0, grade: today?.grade || 0 });
    const household = { p1Alive: true, p2Alive: inputs.partner?.aktiv === true,
        care: { p1: todayCare(inputs.careToday), p2: todayCare(inputs.partner?.careToday) } };
    let lastYear = referenceYear;
    const includeMonth = month => { if (month) lastYear = Math.max(lastYear, Number(month.slice(0, 4))); };
    for (const person of entries) {
        const personId = person.profileId, name = person.name || personId;
        if (Number(person.data.profile_rente_monatlich) > 0) {
            groups.push({ label: `${name} · Rente`, personId, pension: true });
            includeMonth(person.data.profile_rentenbeginn);
        }
        const personIndex = inputs.simulationPeople?.findIndex(entry => entry.profileId === personId) ?? entries.indexOf(person);
        const today = personIndex === 0 ? inputs.careToday : inputs.partner?.careToday;
        const allowance = /** @type {CareAllowanceAnnual} */ (careAllowanceAnnual)({ grade: today?.grade, preset: inputs.pflegeKostenStaffelPreset,
            careForm: careFormForPerson(inputs, today?.grade, personIndex, household), careValues: inputs.careValues });
        if (allowance > 0) groups.push({ label: `${name} · Pflegegeld`, personId, careAllowance: allowance });
        for (const entry of effectiveIncomeFromRecord(person.data)) {
            if (entry.art === 'sonstige') {
                let group = groups.find(group => !group.pension && group.personId === personId && group.title === (entry.bezeichnung || 'Sonstige Einkünfte'));
                if (!group) { group = { label: `${name} · ${entry.bezeichnung || 'Sonstige Einkünfte'}`, title: entry.bezeichnung || 'Sonstige Einkünfte', personId, items: [] }; groups.push(group); }
                group.items.push(entry); includeMonth(entry.ab); includeMonth(entry.bis);
            } else includeMonth(entry.monat);
        }
    }
    for (const item of inputs.plannedExpenses || []) { includeMonth(item.ab); includeMonth(item.bis); includeMonth(item.monat); }
    const endYear = Math.min(referenceYear + 14, lastYear + 1), rows = [];
    const rentRate = computeRentAdjRate(inputs, { inflation: inflationPct, lohn: wagePct });
    const primaryId = inputs.simulationPeople?.[0]?.profileId || entries[0]?.profileId;
    for (let year = referenceYear; year <= endYear; year++) {
        const index = year - referenceYear, inflationFactor = Math.pow(1 + inflationPct / 100, index);
        const pension = calculateHouseholdPensionForYear({ inputs, yearIndex: index,
            currentAnnualPension: (inputs.renteMonatlich || 0) * 12 * Math.pow(1 + rentRate / 100, index),
            currentAnnualPension2: (inputs.partner?.monatsrente || 0) * 12 * Math.pow(1 + rentRate / 100, index) });
        const incomes = groups.map(group => group.pension ? group.personId === primaryId ? pension.rente1 : pension.rente2
            : group.careAllowance ? group.careAllowance * inflationFactor
                : annualOtherIncome(group.items, year, { baseYear: referenceYear, inflationPct, wagePct }));
        const oneTime = (inputs.plannedInflows || []).filter(item => item.year === year).reduce((sum, item) => sum + item.amount, 0);
        const needs = ((inputs.startFloorBedarf || 0) + (inputs.startFlexBedarf || 0)) * inflationFactor;
        const expenses = plannedExpensesForYear(inputs.plannedExpenses, year, inflationFactor);
        const result = incomes.reduce((sum, amount) => sum + amount, 0) + oneTime - needs - expenses;
        rows.push({ year, incomes, oneTime, needs, expenses, result });
    }
    return { groups, rows, inflationPct, wagePct };
}

/** Nur Anzeige der bestehenden Jahresspalten, gegebenenfalls in heutigen Euro.
 *
 * @param row
 * @param {number} [factor]
 * @returns Ergebnis der Operation.
 */
export function projectPlanMonthlyFlow(row, factor = 1) {
    return projectMonthlyFlow({ income: row.incomes.reduce((sum, amount) => sum + amount, 0) / factor / 12,
        oneTime: row.oneTime / factor / 12, withdrawal: Math.max(0, -row.result) / factor / 12,
        budget: row.needs / factor / 12, expenses: row.expenses / factor / 12, saving: Math.max(0, row.result) / factor / 12 });
}

const money = value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
const selectedYears = new WeakMap();
/**
 * @param doc Zugehöriges Simulatordokument.
 * @param view
 * @param row
 * @param [inputs] Wirksame Simulationseingaben.
 * @param {number} [factor]
 * @returns {void}
 */
export function renderPlanMonthly(doc, view, row, inputs = {}, factor = 1) {
    const host = doc.getElementById('simPlanMonthly');
    if (!host) return;
    host.replaceChildren();
    const title = doc.createElement('div'); title.className = 'monthly-flow-heading';
    const heading = doc.createElement('span'); heading.textContent = `Im Monat ${row.year} · laut Plan, ohne Marktschwankung`;
    if (inputs.dynamicFlex) {
        const planNeed = (inputs.startFloorBedarf || 0) + (inputs.startFlexBedarf || 0);
        const limit = planNeed > 0 ? row.needs * (1 + inputs.startFlexBedarf / planNeed) / factor / 12 : 0;
        const dynamic = doc.createElement('span'); dynamic.textContent = ` · mit Dynamik bis ${money(limit)} `;
        heading.append(dynamic, createInfoPopover(doc, 'Plan und Dynamik',
            'Die Balance kann darüber liegen, wenn die Dynamik mehr erlaubt.'));
    }
    const flow = projectPlanMonthlyFlow(row, factor);
    const main = doc.createElement('span'); main.className = 'monthly-flow-main';
    const mainValue = doc.createElement('strong'); mainValue.textContent = money(flow.euros.budget);
    const mainLabel = doc.createElement('span'); mainLabel.textContent = 'Monatsbudget';
    main.append(mainValue, mainLabel);
    heading.appendChild(createInfoPopover(doc, 'Monat in der Planübersicht wählen', 'Wähle eine Jahreszeile in der Tabelle. Die Monatszeile zeigt dann das gewählte Jahr.'));
    title.append(heading, main); host.appendChild(title);
    const bar = doc.createElement('div'); bar.className = 'monthly-flow-bar'; bar.setAttribute('aria-hidden', 'true');
    /** @type {(host: HTMLElement, flow: ReturnType<typeof projectMonthlyFlow>, start: number, format: (value: number) => string) => void} */ (renderMonthlyFlowBar)(bar, flow, 0, money); host.appendChild(bar);
    const equation = doc.createElement('div'); equation.className = 'monthly-flow-equation'; host.appendChild(equation);
    const term = (label, amount, kind = '') => {
        const node = doc.createElement('span'); node.className = `monthly-flow-term${kind === 'saving' ? ' monthly-flow-saving' : ''}`;
        if (kind) {
            const key = doc.createElement('i'); key.className = `monthly-flow-key monthly-flow-${kind}`; key.setAttribute('aria-hidden', 'true');
            node.appendChild(key);
        }
        const value = doc.createElement('strong'); value.className = 'monthly-flow-amount'; value.textContent = money(amount);
        const caption = doc.createElement('span'); caption.textContent = `${label} `;
        node.append(caption, value); equation.appendChild(node);
    };
    const sign = text => { const node = doc.createElement('span'); node.className = 'monthly-flow-sign'; node.textContent = text; equation.appendChild(node); };
    term('Einkünfte', flow.euros.income, 'income');
    if (row.oneTime > 0) { sign('+'); term('einmalige Einkünfte', flow.euros.oneTime, 'one-time'); }
    if (row.result <= 0 || flow.euros.withdrawal > 0) { sign('+'); term('aus dem Vermögen', flow.euros.withdrawal, 'withdrawal'); }
    sign('='); term('Monatsbudget', flow.euros.budget);
    if (row.expenses > 0) { sign('+'); term('geplante Ausgaben', flow.euros.expenses); }
    if (row.result > 0 || flow.euros.saving > 0) { sign('+'); term('angelegt', flow.euros.saving, 'saving'); }
    const details = doc.createElement('details'); details.className = 'monthly-flow-incomes ds-technical-details'; host.appendChild(details);
    renderIncomeDetails(details, roundedIncomeDetails(view.groups.map((group, index) => ({
        label: group.label, amount: row.incomes[index] / factor / 12
    })).filter(item => item.amount > 0), flow.euros.income), money);
    const notes = doc.createElement('div'); notes.className = 'monthly-flow-detail monthly-flow-footer';
    const annualItems = (items, amount) => {
        const labels = [...new Set(items.map(item => item.label || item.bezeichnung).filter(Boolean))];
        return `${labels.length ? labels.join(', ') + ' ' : ''}${money(amount / factor)} im Jahr`;
    };
    const annual = [];
    if (row.oneTime > 0) annual.push(`Einmalige Einkünfte: ${annualItems((inputs.plannedInflows || []).filter(item => item.year === row.year), row.oneTime)}`);
    if (row.expenses > 0) annual.push(`Geplante Ausgaben: ${annualItems(plannedExpenseOccurrences(inputs.plannedExpenses || [], row.year), row.expenses)}`);
    if (annual.length) { notes.textContent = annual.join(' · '); host.appendChild(notes); }
    bindInfoPopovers(doc, { root: host });
}

/**
 * @param [doc] Zugehöriges Simulatordokument.
 * @returns {void}
 */
export function renderPlanOverview(doc = globalThis.document) {
    const host = doc?.getElementById('simPlanOverviewTable');
    if (!host) return;
    try {
        const persons = readDocumentPersonInputs(doc);
        if (!persons) return;
        const raw = persistenceStorage.getItem(CONFIG.STORAGE.LS_KEY);
        const balance = parseStoredBalanceInputsFromData(raw ? { [CONFIG.STORAGE.LS_KEY]: raw } : {});
        const rates = resolvePlanOverviewRates(balance);
        const inflationPct = rates.inflation.value, wagePct = rates.wage.value;
        const inputs = getCommonInputs();
        const view = buildPlanOverview({ inputs, entries: persons.entries, referenceYear: persons.context.referenceYear, inflationPct, wagePct });
        const mode = getEuroMode(doc);
        const factorFor = row => mode === 'real' ? Math.pow(1 + inflationPct / 100, row.year - persons.context.referenceYear) : 1;
        const selected = view.rows.find(row => row.year === selectedYears.get(doc)) || view.rows[0];
        selectedYears.set(doc, selected.year);
        renderPlanMonthly(doc, view, selected, inputs, factorFor(selected));
        const table = doc.createElement('table'); table.className = 'ds-table sim-plan-overview-table';
        const head = doc.createElement('thead'), header = doc.createElement('tr');
        for (const label of ['Jahr', ...view.groups.map(group => group.label), 'Einmalige Einkünfte', 'Bedarf (Grund + Flex)', 'Geplante Ausgaben', 'Ergebnis']) {
            const cell = doc.createElement('th'); cell.textContent = label; header.appendChild(cell);
        }
        head.appendChild(header); table.appendChild(head);
        const body = doc.createElement('tbody');
        for (const row of view.rows) {
            const line = doc.createElement('tr'); line.dataset.planYear = String(row.year);
            line.tabIndex = 0; line.setAttribute('aria-selected', String(row.year === selected.year));
            const pick = () => {
                selectedYears.set(doc, row.year);
                for (const item of body.children) item.setAttribute('aria-selected', String(item === line));
                renderPlanMonthly(doc, view, row, inputs, factorFor(row));
            };
            line.addEventListener('click', pick);
            line.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); } });
            const factor = factorFor(row);
            for (const [index, amount] of [row.year, ...row.incomes, row.oneTime, row.needs, row.expenses, row.result].entries()) {
                const cell = doc.createElement('td');
                if (index === view.groups.length + 4) {
                    const badge = doc.createElement('span'); badge.className = row.result >= 0 ? 'sim-plan-saving' : 'sim-plan-withdrawal';
                    badge.textContent = row.result >= 0 ? `angelegt +${money(row.result / factor)}` : `aus Vermögen −${money(-row.result / factor)}`;
                    cell.appendChild(badge);
                } else cell.textContent = index === 0 ? String(amount) : amount ? money(amount / factor) : '—';
                line.appendChild(cell);
            }
            body.appendChild(line);
        }
        table.appendChild(body); host.replaceChildren(table);
        const note = doc.getElementById('simPlanOverviewRates');
        const describe = (label, rate) => `${label} ${rate.value.toLocaleString('de-DE', { maximumFractionDigits: 2 })} % pro Jahr (${rate.origin})`;
        if (note) note.textContent = `Fortschreibung: ${describe('Inflation', rates.inflation)}; ${describe('Löhne', rates.wage)}.`;
        const footnote = doc.getElementById('simPlanOverviewFootnote');
        if (footnote) footnote.textContent = `Werte laut Plan, ${euroBasisLabel(mode)}, ohne Marktschwankung. Jahre bis zum letzten Eintrag plus eins, höchstens 15 Zeilen. Im Lauf passt die App den Flex jedes Jahr an Markt und Vermögen an.`;
    } catch (error) { host.textContent = `Planübersicht derzeit nicht verfügbar: ${error.message}`; }
}

const bound = new WeakSet();
/**
 * @param [doc] Zugehöriges Simulatordokument.
 * @returns {void}
 */
export function initializePlanOverview(doc = globalThis.document) {
    if (!bound.has(doc)) {
        bound.add(doc);
        bindEuroMode(doc, doc.getElementById('simPlanEuroMode'), () => renderPlanOverview(doc));
        for (const name of ['input', 'change', 'click']) doc.addEventListener(name, event => {
            if (!/** @type {HTMLElement} */ (event.target?.closest?.('#simPlanOverviewTable, #simPlanMonthly'))) renderPlanOverview(doc);
        });
    }
    renderPlanOverview(doc);
}
