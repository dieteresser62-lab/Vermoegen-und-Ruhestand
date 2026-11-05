import { projectBalanceBudget } from './balance-budget.js';
// Lesende Monatsprojektion: keine Policy-Auswertung und keine Rentenverrechnung im Trace.
const labels = {
    raw_target: 'Bärenmarkt', previous_rate: 'Vorjahresanker', alarm: 'Alarmgrenze',
    internal_smoothing: 'Glättung', annual_change_limit: 'Änderungsgrenze',
    flex_share_curve: 'Begrenzung nach Flex-Anteil', bear_cap: 'Bärenmarkt-Obergrenze',
    runway_cap: 'Liquiditäts-Obergrenze', guardrails: 'Leitplanken', minimum_flex: 'Mindest-Flex',
    flex_budget: 'Flex-Budget', final_smoothing: 'Letzte Änderungsgrenze', safety_cap: 'Sicherheitsgrenze'
};
const near = (a, b) => Math.abs(a - b) < 1e-7;

/** @param {import('../../typcheck/balance-ui.js').Ui} [ui] @returns {import('../../typcheck/balance-ui.js').FlexTrace} */
export function projectBalanceFlexTrace(ui = {}) {
    const input = ui.input || {}, spending = ui.spending || {};
    const finite = Number.isFinite;
    const { income, withdrawal, budget, saving } = projectBalanceBudget(ui);
    const grossNeed = finite(input.floorBedarf) && finite(input.flexBedarf)
        ? (input.floorBedarf + input.flexBedarf) / 12 : null;
    const valid = budget !== null && grossNeed !== null && income >= 0 && withdrawal >= 0 && grossNeed >= 0;
    const cut = valid ? near(grossNeed, budget) ? 0 : Math.max(0, grossNeed - budget) : null;
    // Haushalts-Flex umfasst auch den Rentenüberschuss über den Grundbedarf.
    // Der Engine-Trace enthält dagegen nur den aus Vermögen finanzierten Flex.
    const householdFlex = grossNeed !== null && finite(input.floorBedarf)
        ? Math.max(0, grossNeed - input.floorBedarf / 12) : null;
    const financedHouseholdFlex = valid && finite(input.floorBedarf)
        ? Math.max(0, budget - input.floorBedarf / 12) : null;
    const householdFlexRate = householdFlex > 0 && financedHouseholdFlex !== null
        ? financedHouseholdFlex / householdFlex * 100 : null;
    const netFloor = finite(input.floorBedarf) && finite(income)
        ? Math.max(0, input.floorBedarf / 12 - income) : null;
    const result = /** @type {import('../../typcheck/balance-ui.js').FlexTrace} */ ({ income, withdrawal, budget, grossNeed, cut, householdFlex,
        financedHouseholdFlex, householdFlexRate, netFloor, rows: [], reason: null });
    if (saving > 0) result.saving = saving;
    const trace = spending.flexTrace;
    if (!valid || !Array.isArray(trace) || !trace.length) return result;
    const start = trace[0].monatsbetragVorher;
    const end = trace.at(-1).monatsbetragNachher;
    if (!finite(start) || !finite(end) || start < 0 || end < 0) return result;
    let previous = start;
    for (const entry of trace) {
        if (![entry.monatsbetragVorher, entry.monatsbetragNachher, entry.monatswirkungEur].every(finite)
            || entry.monatsbetragNachher < 0 || !near(previous, entry.monatsbetragVorher)
            || !near(entry.monatswirkungEur, entry.monatsbetragNachher - entry.monatsbetragVorher)
            || entry.gegriffen !== (entry.monatswirkungEur !== 0)) return result;
        previous = entry.monatsbetragNachher;
    }
    // Der Engine-Trace beginnt beim dynamischen Rahmen, der Kartenvergleich beim Plan.
    const traceNeed = ui.vpw?.enabled && finite(ui.neuerBedarf) && finite(income)
        ? ui.neuerBedarf / 12 + income - saving : grossNeed;
    const traceCut = Math.max(0, traceNeed - budget);
    // Die Engine hat Rente und Dynamic Flex bereits in die Netto-Basis eingerechnet.
    if (netFloor === null || !near(end, Math.max(0, withdrawal - netFloor))
        || traceCut > 0 && !near(start - end, traceCut)) return result;
    const applied = trace.filter(entry => entry.gegriffen);
    const scale = Math.max(start, end, ...applied.flatMap(e => [e.monatsbetragVorher, e.monatsbetragNachher]), 1);
    const total = (label, value, kind) => ({ label, value, kind, left: 0, width: value / scale * 100 });
    const share = netFloor > 0 ? ' (Flex-Anteil)' : '';
    result.rows = [total(`Geplante Vermögensentnahme${share}`, start, 'start'), ...applied.map(entry => ({
        label: entry.schritt === 'quantization'
            ? finite(entry.kennzahlen?.stufeEurMonat) && entry.kennzahlen.stufeEurMonat > 0
                ? `Rundung auf volle ${entry.kennzahlen.stufeEurMonat} €` : 'Rundung'
            : entry.schritt === 'flex_share_curve' && Number.isFinite(entry.kennzahlen?.wunschFlexRateProzent)
                ? 'S-Kurve für dynamischen Flex'
                : entry.kennzahlen?.schwereNotlage ? 'Schwere Flex-Notlage' : labels[entry.schritt] || entry.grund,
        value: entry.monatswirkungEur, kind: entry.monatswirkungEur < 0 ? 'negative' : 'positive',
        left: Math.min(entry.monatsbetragVorher, entry.monatsbetragNachher) / scale * 100,
        width: Math.abs(entry.monatswirkungEur) / scale * 100
    })), total(`Finanzierte Vermögensentnahme${share}`, end, 'total')];
    // Derselbe vom Planner ausgewählte Grund wie in Simulator und Anmerkung.
    result.reason = spending.kuerzungQuelle || null;
    return result;
}
