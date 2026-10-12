import { CONFIG } from './balance-config.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { assertAnnualPlanRecord } from '../profile/annual-plan-record.js';

/** Ausschließlich gespeicherte Jahreswerte; die Formularbelegung ist keine Quelle. */
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

export function renderBalanceInflationSource(doc, options) {
    const source = readBalanceInflationSource(options);
    const field = doc?.getElementById('inflation');
    if (field) { field.value = source.value; field.disabled = true; field.readOnly = true; }
    const target = doc?.getElementById('balanceInflationSource');
    if (target) target.textContent = `${source.value.toLocaleString('de-DE')} % · ${source.year ?? 'Jahr nicht belegt'} · ${source.source}`;
    return source;
}
