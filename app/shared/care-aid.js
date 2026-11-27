// @ts-check
/** FR-84 Punkt 11: Hilfe zur Pflege im Jahresplan (Balance und Jahresabschluss).
 *
 * Für das Planjahr zahlt das eigene Geld (Einkünfte des Jahres und Geldvermögen) zuerst den Grundbedarf ohne Pflege, dann die
 * Pflegekosten. Was an Pflegekosten danach fehlt, trägt voraussichtlich der Staat (Hilfe zur Pflege). Verheiratete und
 * Alleinstehende rechnen mit dem ganzen Haushalt, Unverheiratete je Person: Den Anteil am Grundbedarf trägt bei „Eine Person
 * trägt“ die tragende Person, sonst jede Person nach ihrem Anteil am Geldvermögen. Den staatlichen Anteil zahlt kein Partner.
 */
import { settleHouseholdTaxYear } from '../../engine/tax-settlement.mjs';

/**
 * @typedef {{profileId: string, name?: string, money: number, income: number, care: number, shareBasis?: number}} CareAidPerson
 * @typedef {{total: number, persons: {profileId: string, name?: string, amount: number}[]}} CareAidEstimate
 */

/**
 * @param {{persons: CareAidPerson[], basicFloor: number, unmarried: boolean, carrierId?: string|null}} options
 *   `basicFloor` ist der Grundbedarf des Haushalts ohne Pflege im Planjahr (mit festen geplanten Ausgaben), vor Einkünften.
 * @returns {CareAidEstimate|null} Ohne Fehlbetrag null.
 */
export function estimateCareAid({ persons, basicFloor, unmarried, carrierId = null }) {
    const list = (persons || []).map(person => ({ ...person, money: Math.max(0, Number(person.money) || 0),
        income: Math.max(0, Number(person.income) || 0), care: Math.max(0, Number(person.care) || 0) }));
    const careTotal = list.reduce((sum, person) => sum + person.care, 0);
    if (!(careTotal > 0.005)) return null;
    const floor = Math.max(0, Number(basicFloor) || 0);
    /** @type {{profileId: string, name?: string, amount: number}[]} */
    let rows;
    if (!unmarried || list.length < 2) {
        const own = list.reduce((sum, person) => sum + person.money + person.income, 0);
        const aid = Math.max(0, careTotal - Math.max(0, own - floor));
        rows = list.filter(person => person.care > 0).map(person => ({ profileId: person.profileId, ...(person.name ? { name: person.name } : {}),
            amount: aid * person.care / careTotal }));
    } else {
        // NK-2 (Codex 6): Anteil nach dem Bruttovermögen samt Rücklage wie im Simulator (`personalAssetValues`), gezahlt wird netto.
        const basis = (/** @type {CareAidPerson} */ person) => Math.max(0, Number(person.shareBasis ?? person.money) || 0);
        const moneyTotal = list.reduce((sum, person) => sum + basis(person), 0);
        const carrier = carrierId ? list.find(person => person.profileId === carrierId) : null;
        rows = list.map(person => {
            const share = carrier ? Number(person === carrier) : moneyTotal > 0 ? basis(person) / moneyTotal : 1 / list.length;
            const amount = Math.max(0, person.care - Math.max(0, person.money + person.income - floor * share));
            return { profileId: person.profileId, ...(person.name ? { name: person.name } : {}), amount };
        });
    }
    rows = rows.filter(row => row.amount > 0.005);
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    return total > 0.005 ? { total, persons: rows } : null;
}

/** NK-2 (Codex 6, Fable P3-10): Hilfe zur Pflege im Planjahr mit Verkaufssteuer, nach derselben Regel wie der Simulator. Erst der
 * Grundbedarf, dann die Pflege aus Einkünften und Geldvermögen (Bruttowerte wie die Auszahlung); was danach an Pflege fehlt, ist Hilfe.
 * Die Steuer auf die nötigen Verkäufe rechnet dieselbe Abrechnung wie der Simulator (`settleHouseholdTaxYear`: Teilfreistellung,
 * Sparer-Pauschbetrag, Verlustvortrag, Zusammenveranlagung); verkauft wird anteilig aus den Tranchen. Ist sie mit dem übrigen Geld
 * nicht zu zahlen, trägt der Staat davon den Pflegeanteil der Zahlung (FR-84, Gutachten NK1C2 Befund 4).
 * @param {{persons: (CareAidPerson & {cash: number, lots: any[], sparerPauschbetrag?: number, kirchensteuerSatz?: number,
 *   lossCarry?: number, inHome?: boolean})[], basicFloor: number, unmarried: boolean, carrierId?: string|null, jointAssessment?: boolean,
 *   withRemainder?: boolean, flex?: number}} options `withRemainder` (NK-2c): auch ohne Pflege antworten und den Bestand nach dem Jahr je
 *   Person liefern; `flex` (NK-2d): im Jahr bezahlter Flex, mindert nur diesen Bestand (Hilfe gibt es erst, wenn kein Flex mehr bezahlt wird).
 * @returns {(CareAidEstimate & {floorGap?: number, remainder?: Map<string, {cash: number, lots: any[]}>})|null} */
export function estimateCareAidNet({ persons, basicFloor, unmarried, carrierId = null, jointAssessment = false, withRemainder = false, flex = 0 }) {
    const number = (/** @type {any} */ value) => Number(value) || 0;
    const list = (persons || []).map(person => {
        const lots = (person.lots || []).filter(lot => number(lot.marketValue) > 0);
        const value = lots.reduce((sum, lot) => sum + number(lot.marketValue), 0);
        return { ...person, cash: Math.max(0, number(person.cash)), lots, value, income: Math.max(0, number(person.income)), care: Math.max(0, number(person.care)) };
    });
    const careTotal = list.reduce((sum, person) => sum + person.care, 0);
    if (!(careTotal > 0.005) && !withRemainder) return null;
    const floor = Math.max(0, number(basicFloor));
    const household = !unmarried || list.length < 2;
    const shareTotal = list.reduce((sum, person) => sum + Math.max(0, number(person.shareBasis ?? person.cash + person.value)), 0);
    const carrier = carrierId ? list.find(person => person.profileId === carrierId) : null;
    // Kassen: Haushalt gemeinsam, Unverheiratete je Person mit ihrem Grundbedarfsanteil.
    /** @type {any[]} */
    const purses = household ? [{ members: list, floor, care: careTotal, income: list.reduce((sum, person) => sum + person.income, 0), share: 1 }]
        : list.map(person => { const share = carrier ? Number(person === carrier) : shareTotal > 0 ? Math.max(0, number(person.shareBasis ?? person.cash + person.value)) / shareTotal : 1 / list.length;
            return { members: [person], care: person.care, income: person.income, floor: floor * share, share }; });
    // Wie im Simulator (FR-84 Punkt 13, Ergänzung 3, Punkt 19): Fehlt einer Kasse ihr Grundbedarfsanteil, deckt ihn zuerst die andere,
    // erst danach zahlt sie ihre eigene Pflege.
    const money = (/** @type {any} */ purse) => purse.members.reduce((/** @type {number} */ sum, /** @type {any} */ person) => sum + person.cash + person.value, 0);
    // NK-2c (FR-84 Punkte 18/19, wie der Simulator seit NK-2b): Einkünfte der Person im Heim zahlen zuerst ihr Heim; nur der Rest und ihr Geld
    // decken die Lücke zu Hause. Was danach am Grundbedarf fehlt, ist Mangel (`floorGap`), keine Hilfe zur Pflege.
    const reserve = (/** @type {any} */ purse) => purse.members.some((/** @type {any} */ person) => person.inHome) ? Math.min(purse.income, purse.care) : 0;
    let deficit = purses.reduce((sum, purse) => sum + Math.max(0, purse.floor - money(purse) - purse.income), 0);
    if (deficit > 0.005) for (const purse of purses) {
        const cover = Math.min(Math.max(0, money(purse) + purse.income - purse.floor - reserve(purse)), deficit);
        purse.floor += cover;
        deficit -= cover;
    }
    const floorGap = deficit > 0.005 ? deficit : 0;
    /** @type {any[]} */
    const plan = [];
    const sold = new Map();
    for (const purse of purses) {
        const cash = purse.members.reduce((sum, person) => sum + person.cash, 0), value = purse.members.reduce((sum, person) => sum + person.value, 0);
        const payoutAid = Math.max(0, purse.care - Math.max(0, cash + value + purse.income - purse.floor));
        const paid = Math.min(cash + value, Math.max(0, purse.floor + purse.care - payoutAid - purse.income));
        const fraction = value > 0 ? Math.min(1, Math.max(0, paid - cash) / value) : 0;
        for (const person of purse.members) sold.set(person.profileId, fraction);
        plan.push({ purse, payoutAid, paid, left: cash + value - paid, cash, value });
    }
    const assess = () => settleHouseholdTaxYear(list.map(person => {
        const fraction = sold.get(person.profileId) || 0;
        let gain = 0, taxable = 0;
        for (const lot of person.lots) {
            const lotGain = (number(lot.marketValue) - number(lot.costBasis)) * fraction;
            gain += lotGain; taxable += lot.taxExempt === true ? 0 : lotGain * (1 - number(lot.tqf));
        }
        return { rawAggregate: { sumRealizedGainSigned: gain, sumTaxableAfterTqfSigned: taxable }, sparerPauschbetrag: number(person.sparerPauschbetrag),
            kirchensteuerSatz: number(person.kirchensteuerSatz), taxStatePrev: { lossCarry: number(person.lossCarry) } };
    }), household && jointAssessment === true);
    let taxes = assess();
    const taxOf = new Map(list.map((person, index) => [person.profileId, taxes[index]?.taxDue || 0]));
    // NK-2b (Gutachten NK2C Befund 4): Wie im Simulator wird auch die Steuer aus Verkäufen bezahlt, deren Steuer wieder zählt; bis zum Abschluss
    // nachrechnen (die Steuer wächst langsamer als der Verkauf, die Rechnung kommt zum Stillstand). Reicht alles nicht, bleibt der Rest offen.
    const financeTax = (/** @type {(entry: any) => number} */ spend) => {
        for (let step = 0; step < 60; step++) {
            let changed = false;
            for (const entry of plan) {
                const { purse, cash, value } = entry;
                const tax = purse.members.reduce((/** @type {number} */ sum, /** @type {any} */ person) => sum + (taxOf.get(person.profileId) || 0), 0);
                const fraction = value > 0 ? Math.min(1, Math.max(0, spend(entry) + tax - cash) / value) : 0;
                for (const person of purse.members) if (Math.abs((sold.get(person.profileId) || 0) - fraction) > 1e-12) { sold.set(person.profileId, fraction); changed = true; }
            }
            if (!changed) break;
            taxes = assess();
            list.forEach((person, index) => taxOf.set(person.profileId, taxes[index]?.taxDue || 0));
        }
    };
    financeTax(entry => entry.paid);
    /** @type {{profileId: string, name?: string, amount: number}[]} */
    let rows = [];
    for (const { purse, payoutAid, paid, left } of plan) {
        const tax = purse.members.reduce((sum, person) => sum + (taxOf.get(person.profileId) || 0), 0);
        const quota = paid > 0 ? Math.min(1, Math.max(0, purse.care - payoutAid) / paid) : 0;
        const aid = payoutAid + Math.min(Math.max(0, tax - left), quota * tax);
        const careSum = purse.members.reduce((sum, person) => sum + person.care, 0);
        for (const person of purse.members) if (person.care > 0) rows.push({ profileId: person.profileId, ...(person.name ? { name: person.name } : {}),
            amount: careSum > 0 ? aid * person.care / careSum : 0 });
    }
    rows = rows.filter(row => row.amount > 0.005);
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    // NK-2c (Gutachten NK2C2 Befund 2): Bestand nach dem Jahr je Person – Geld nach Zahlung und Steuer, die übrigen Tranchen anteilig mit Einstand.
    /** @type {Map<string, {cash: number, lots: any[], lossCarry: number}>} */
    const remainder = new Map();
    if (withRemainder) {
        // NK-2d (Gutachten NK2C3 Befund 5): Bezahlter Flex mindert den Bestand nach dem Jahr; er kommt nach Grundbedarf, Pflege und Steuer und nur,
        // soweit die Kasse ihn tragen kann (Verkäufe dafür samt Steuer wie oben).
        if (flex > 0.005) {
            for (const entry of plan) entry.flex = entry.payoutAid > 0.005 ? 0 : flex * (household ? 1 : entry.purse.share || 0);
            financeTax(entry => entry.paid + (entry.flex || 0));
        }
        list.forEach((person, index) => {
            const entry = /** @type {any} */ (plan.find(row => row.purse.members.includes(person)));
            const tax = entry.purse.members.reduce((/** @type {number} */ sum, /** @type {any} */ member) => sum + (taxOf.get(member.profileId) || 0), 0);
            const cashLeft = Math.max(0, entry.cash - entry.paid - (entry.flex || 0) - tax), keep = 1 - (sold.get(person.profileId) || 0);
            // NK-2d (Befund 4): Steuerzustand nach der Steuerfinanzierung (verbrauchter Verlustvortrag) ins Folgejahr.
            remainder.set(person.profileId, { cash: entry.cash > 0 ? cashLeft * person.cash / entry.cash : 0, lossCarry: number(taxes[index]?.taxStateNext?.lossCarry),
                lots: keep > 1e-12 ? person.lots.map(lot => ({ ...lot, marketValue: number(lot.marketValue) * keep, costBasis: number(lot.costBasis) * keep })) : [] });
        });
    }
    return total > 0.005 || floorGap > 0 || withRemainder
        ? { total, persons: rows, ...(floorGap > 0 ? { floorGap } : {}), ...(withRemainder ? { remainder } : {}) } : null;
}

/** Hinweistext für „Was zu tun ist“ und die Budgeterklärung. @param {CareAidEstimate|null|undefined} aid
 * @param {(value: number) => string} money @returns {string} */
export function careAidHintText(aid, money) {
    // NK-2c (Gutachten NK2C2 Befund 1): Ein Mangel beim Grundbedarf zu Hause wird genannt, nicht durch Hilfe ersetzt.
    const gap = /** @type {any} */ (aid)?.floorGap > 0.005 ? ` Grundbedarf zu Hause nicht gedeckt: Es fehlen ${money(/** @type {any} */ (aid).floorGap)}. `
        + 'Die Einkünfte der Person im Heim zahlen zuerst ihr Heim; das Geld des Haushalts reicht für den Rest nicht.' : '';
    if (!aid || !(aid.total > 0.005)) return gap.trim();
    // NK-2 (FR-84 Punkt 20), NK-2b (Fable P3-7): Wer eine verwertbare Immobilie hat, verkauft sie zuerst; für diese Person nennt der Hinweis
    // keinen Betrag, denn der Staat zahlt erst nach Verbrauch des Erlöses.
    const first = aid.persons.filter(row => /** @type {any} */ (row).homeFirst), rest = aid.persons.filter(row => !/** @type {any} */ (row).homeFirst);
    const sale = first.length ? `Vorher muss ${first.map(row => row.name || 'die Person').join(' und ')} die eigene Immobilie verkaufen (vermietet oder leer stehend); `
        + 'erst wenn der Erlös aufgebraucht ist, zahlt der Staat. Die App plant ohne diese Pflegekosten.' : '';
    if (!rest.length) return `Pflegekosten über dem eigenen Geld: ${sale}${gap}`;
    const total = rest.reduce((sum, row) => sum + row.amount, 0), named = rest.filter(row => row.name).map(row => `${row.name} ${money(row.amount)}`);
    return `Hilfe zur Pflege, voraussichtlich ${money(total)}${named.length > 1 ? ` (${named.join(', ')})` : named.length ? ` für ${rest[0].name}` : ''}: `
        + 'Diese Pflegekosten trägt das eigene Geld im Planjahr nicht mehr; sie zahlt voraussichtlich der Staat. Die App plant ohne sie.' + (sale ? ` ${sale}` : '') + gap;
}
