import { CONFIG } from './balance-config.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { assertAnnualPlanRecord } from '../profile/annual-plan-record.js';

/** Ausschließlich gespeicherte Jahreswerte; die Formularbelegung ist keine Quelle. */
/** @param {import('../../typcheck/balance-ui.js').PlanSourceOptions} [options] @returns {{value: number, year: number|null, source: string, periodId: string|null}} */
export function readBalanceInflationSource({ storage = persistenceStorage, scope, referenceYear } = {}) {
    const state = JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY) || '{}');
    const committed = state.annualPeriodMetadata?.lastCommittedPeriod;
    const periodId = Number.isInteger(referenceYear) ? `calendar-year:${referenceYear - 1}` : committed;
    const raw = storage.getItem('annual_plan_record_v1');
    if (raw && scope) {
        const record = assertAnnualPlanRecord(raw);
        const entry = Object.values(record.entries).filter(item => item.scope.key === scope.key && (!periodId || item.periodId === periodId))
            .sort((a, b) => b.periodId.localeCompare(a.periodId))[0];
        if (entry) return { value: entry.adopted.snapshot.inflation, year: Number(entry.periodId.split(':')[1]),
            source: 'Bestätigter Jahresbeleg', periodId: entry.periodId };
    }
    const meta = state.annualMarketDataMeta?.inflation;
    const field = state.balanceInputFields?.inflation?.value;
    const saved = state.inputs?.inflation ?? field;
    const parsed = saved === undefined || saved === null || String(saved).trim() === '' ? NaN : Number(String(saved).replace(',', '.'));
    const value = Number.isFinite(parsed) ? parsed : Number.isFinite(meta?.rate) ? meta.rate : 0;
    const metaMatches = Number.isInteger(meta?.year) && meta.rate === value;
    const confirmedYear = typeof committed === 'string' && /^calendar-year:\d{4}$/.test(committed)
        && (!referenceYear || committed === periodId) ? Number(committed.split(':')[1]) : null;
    const year = metaMatches ? meta.year : confirmedYear;
    return { value, year, source: metaMatches ? (meta.source || 'Gespeicherter Jahresstand')
        : year ? 'Gespeicherter bestätigter Jahresstand'
        : Number.isFinite(parsed) ? 'Gespeicherter Altstand · Jahr und Herkunft nicht belegt' : 'Kein gespeicherter Jahreswert', periodId: null };
}

/** Preisbasis je Eingabe; Altposten stammen aus dem Einführungsjahr 2026.
 * Bestätigte Jahresraten haben Vorrang, sonst gilt der gespeicherte Jahreswert.
 * Der Simulator friert diese Faktoren ein und verkettet danach seinen Marktpfad.
 */
/** @template { import('../../typcheck/datenvertraege.js').PlannedExpense } T @param {T[]} items @param {import('../../typcheck/balance-ui.js').PlanSourceOptions} options @returns {(T & {priceFactor: number})[]} */
export function withPlannedExpensePrices(items, { storage = persistenceStorage, scope, referenceYear }) {
    const rates = new Map();
    return items.map(item => {
        const baseYear = item.priceYear ?? 2026;
        let factor = 1;
        for (let year = Math.min(baseYear, referenceYear); year < Math.max(baseYear, referenceYear); year++) {
            if (!rates.has(year)) rates.set(year, readBalanceInflationSource({ storage, scope, referenceYear: year + 1 }).value);
            const annualFactor = 1 + rates.get(year) / 100;
            if (!Number.isFinite(annualFactor) || annualFactor <= 0) throw new Error('Geplante Ausgaben: Die Inflationsgrundlage ist ungültig.');
            factor *= annualFactor;
        }
        return { ...item, priceFactor: baseYear <= referenceYear ? factor : 1 / factor };
    });
}

/** @param {Document} doc @param {import('../../typcheck/balance-ui.js').PlanSourceOptions} options @returns {ReturnType<typeof readBalanceInflationSource>} */
export function renderBalanceInflationSource(doc, options) {
    const source = readBalanceInflationSource(options);
    const field = /** @type {import('../../typcheck/simulator-analysis.js').NumericInput} */ (doc?.getElementById('inflation'));
    if (field) { field.value = source.value; field.disabled = true; field.readOnly = true; }
    const target = doc?.getElementById('balanceInflationSource');
    if (target) target.textContent = `${source.value.toLocaleString('de-DE')} % · ${source.year ?? 'Jahr nicht belegt'} · ${source.source}`;
    return source;
}
