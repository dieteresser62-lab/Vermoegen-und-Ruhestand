/** Explicit remaining evidence/execution limits; this registry never changes a comparison row. */
const classes = [
    { id: 'MARKTZEIT_HERKUNFT_FEHLT', status: 'FEHLT_LOG',
        reason: 'balance_records_have_no_independent_market_period_metadata', field: /^input\.temporal\./,
        explanation: 'Balance records have no independent historical source-year metadata.' },
    { id: 'QUELLREVISION_FEHLT', status: 'FEHLT_LOG', reason: 'source_revision_unavailable', field: /^evidence\./,
        explanation: 'The source-content hash is present; a Git revision was not supplied.' },
    { id: 'JAHRESENDE_NUR_SIMULATOR', status: 'PHASE_NICHT_VERGLEICHBAR', reason: 'balance_has_no_executed_year_end', field: /^yearEnd\./,
        explanation: 'Balance recommends transactions and does not book an executed year-end portfolio.' },
    { id: 'FOLGELAUF_AUSFUEHRUNG_FEHLT', status: 'FEHLT_MODELL', field: /^sequence\./,
        reason: /^(independent_annual_execution_adapter_missing|independent_annual_execution_ledger_unavailable|no_engine_call_after_terminal:\d{4})$/,
        explanation: 'The independent Balance adapter lacks personal annual bookings; later decisions remain unavailable.' },
    { id: 'ZUSAETZLICHE_DECKUNG', status: 'PHASE_NICHT_VERGLEICHBAR', reason: 'additional_sales_or_reserve_coverage', field: /^liquidity\./,
        explanation: 'Simulator coverage sales or reserve usage change the scope before payout.' },
    { id: 'TRANSAKTIONSUMFANG_VERSCHIEDEN', status: 'PHASE_NICHT_VERGLEICHBAR', reason: 'different_or_incomplete_transaction_scope', field: /^liquidity\./,
        explanation: 'Complete transactions including personal amounts must agree before cash and runway are comparable.' },
    { id: 'QUELLREIHENFOLGE_STEUERGLEICH', status: 'PHASE_NICHT_VERGLEICHBAR', reason: 'tax_source_order_after_price_roundtrip', field: /^transaction\.(sources|persons)\./,
        explanation: 'Price conversion reverses tied tax quotes; household totals still have to agree.' },
    { id: 'PERSOENLICHE_AUSZAHLUNG_BEGRENZT', status: 'FEHLT_MODELL', reason: 'personal_payout_exceeds_owned_liquidity',
        field: /^transaction\.persons\..+\.annualWithdrawal$/,
        explanation: 'Owned liquidity and permitted personal sales do not cover the attributed payout.' }
];

export function parityResidualClass(row) {
    return classes.find(entry => entry.status === row.status && entry.field.test(row.id)
        && (entry.reason instanceof RegExp ? entry.reason.test(row.reason) : entry.reason === row.reason));
}

/** Unlisted differences fail the scenario run even if their broad status is a known gap. */
export function summarizeParityResiduals(cases) {
    const groups = new Map(), unclassified = [];
    for (const value of cases) for (const row of value.fields) {
        if (row.status === 'NICHT_ANWENDBAR' || row.status === 'GLEICH' && row.classification === 'gleich') continue;
        const entry = parityResidualClass(row);
        if (!entry) { unclassified.push({ case: value.id, field: row.id, status: row.status, reason: row.reason }); continue; }
        if (!groups.has(entry.id)) groups.set(entry.id, { id: entry.id, explanation: entry.explanation,
            status: entry.status, fields: 0, cases: new Set(), years: new Set(), reasons: new Set(), examples: [] });
        const group = groups.get(entry.id);
        group.fields++;
        group.cases.add(value.id); group.years.add(value.historicalYear); group.reasons.add(row.reason);
        if (group.examples.length < 3) group.examples.push({ case: value.id, field: row.id, reason: row.reason, delta: row.delta });
    }
    return { classes: [...groups.values()].map(group => ({ ...group, cases: group.cases.size,
        years: [...group.years].sort(), reasons: [...group.reasons].sort() })), unclassified };
}
