/** FR-48: persönliche Jahreszahlungen; nur der Simulator verwendet diesen Pfad. */
import { debitAccount, syncPersonalLiquidity, payableLiquidity } from './simulator-personal-accounts.js';
import { residentialSpending } from './simulator-residential-care.js';
import { activeCarrier } from '../profile/household-withdrawal-mode.js';

/**
 * @param inputs Wirksame Simulationseingaben.
 * @returns {boolean} Ergebnis der Operation.
 */
export const isUnmarriedSimulation = inputs => inputs.partner?.aktiv === true && inputs.partnership?.status === 'unmarried';
const groups = ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt', 'healthBucketTranches'];
/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param {object} [options]
 * @param {boolean} [options.includeReserve]
 * @returns Ergebnis der Operation.
 */
export function personalAssetValues(portfolio, { includeReserve = true } = {}) {
    return portfolio.personAccounts.map(account => ({ profileId: account.profileId,
        value: account.tagesgeld + groups.filter(key => includeReserve || key !== 'healthBucketTranches')
            .reduce((total, key) => total + (portfolio[key] || [])
            .filter(lot => (lot.sourceProfileId || portfolio.simulationSourceProfileId) === account.profileId)
            .reduce((sum, lot) => sum + lot.marketValue, 0), 0)
            + (includeReserve ? portfolio.healthBucketCashOwners || [] : []).filter(row => row.profileId === account.profileId)
                .reduce((sum, row) => sum + row.amount, 0) }));
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param inputs Wirksame Simulationseingaben.
 * @param care
 * @param deathThisYear
 * @param household
 * @param careTotal
 * @returns Ergebnis der Operation.
 */
export function unmarriedYearShares(portfolio, inputs, care, deathThisYear, household, careTotal) {
    const values = personalAssetValues(portfolio), total = values.reduce((sum, row) => sum + row.value, 0);
    // FR-72 Punkt 10: Heimkosten und eigene Ausgaben gehören zur Person im Heim; die Ersparnis
    // beim gemeinsamen Grundbedarf bleibt im gemeinsamen Anteil.
    const personal = meta => residentialSpending(meta) ? Math.max(0, meta.zusatzFloorZiel || 0) + residentialSpending(meta)
        : Math.max(0, meta.zusatzFloorZiel || 0);
    const costs = [care.p1, care.p2].map((meta, i) => meta?.active
        ? personal(meta) * (household[`p${i + 1}Alive`] ? 1 : deathThisYear ? .5 : 0) : 0);
    const sumCare = costs.reduce((sum, value) => sum + value, 0);
    // NK-2 (FR-84 Punkte 18 und 19): Ab dem Heimeintritt zahlt die Person im Heim nichts zum Grundbedarf zu Hause; ihn trägt die Person zu
    // Hause allein, in jedem Modus. Das Geld der Person im Heim geht ins Heim; fehlt zu Hause Grundbedarf, deckt sie ihn (Punkt 13 hat Vorrang).
    const indexOf = (/** @type {any} */ row, /** @type {number} */ i) => { const found = inputs.simulationPeople?.findIndex(p => p.profileId === row.profileId); return found >= 0 ? found : i; };
    // NK-2b (Fable P3-4): auch im Todesjahr wie in den Jahren davor.
    const inHome = values.map((row, i) => { const meta = [care.p1, care.p2][indexOf(row, i)];
        return Boolean(meta?.active && residentialSpending(meta) > 0 && (household[`p${indexOf(row, i) + 1}Alive`] || deathThisYear)); });
    const homeAlone = values.length === 2 && inHome.filter(Boolean).length === 1;
    // FR-80: Bei „Eine Person trägt“ trägt sie den gemeinsamen Anteil allein; persönliche Pflege bleibt bei der Person (FR-72 Punkt 10).
    const carrierId = homeAlone ? null : activeCarrier(inputs.householdWithdrawalMode, values);
    return values.map((row, i) => ({ profileId: row.profileId, ...(carrierId ? { carries: row.profileId === carrierId } : {}), ...(homeAlone && inHome[i] ? { inHome: true } : {}),
        // NK-3 (FR-84 Punkt 21): jede Person im Heim, auch wenn beide im Heim leben.
        ...(inHome[i] ? { residential: true } : {}),
        share: homeAlone ? Number(!inHome[i]) : carrierId ? Number(row.profileId === carrierId) : total > 0 ? row.value / total : 1 / values.length,
        care: sumCare > 0 ? careTotal * (costs[inputs.simulationPeople?.findIndex(p => p.profileId === row.profileId) ?? i] || 0) / sumCare
            : i === 0 ? careTotal : 0 }));
}

/** Die Engine entscheidet weiter über den Nettobedarf; vor Zahlung folgt die volle persönliche Gutschrift.
 * @returns {{profileId: string, amount: number}[]} verbrauchte Einkünfte je Person */
export function consumedIncomeCredits(portfolio, inputs, pension, income, incomeLog) {
    const credits = new Map((income?.persons || []).map(row => [row.profileId, row.amount]));
    for (const [i, amount] of [pension.rente1, pension.rente2].entries()) {
        const id = inputs.simulationPeople?.[i]?.profileId || portfolio.personAccounts[i]?.profileId;
        if (id && amount) credits.set(id, (credits.get(id) || 0) + amount);
    }
    return [...credits].map(([profileId, amount]) => ({ profileId,
        amount: amount - (incomeLog?.einkuenfte_gespart_personen.find(row => row.profileId === profileId)?.amount || 0) }));
}

/** Vor der Überschussanlage den noch aus eigenem Tagesgeld zu zahlenden Anteil schützen.
 *
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param inputs Wirksame Simulationseingaben.
 * @param shares
 * @param withdrawal
 * @param expense
 * @param pension
 * @param income
 * @param incomeLog
 * @returns Ergebnis der Operation.
 */
export function unmarriedInvestmentReserves(portfolio, inputs, shares, withdrawal, expense, pension, income, incomeLog) {
    const credits = consumedIncomeCredits(portfolio, inputs, pension, income, incomeLog);
    const consumed = credits.reduce((sum, row) => sum + row.amount, 0);
    const plan = unmarriedWithdrawalPlan(shares, withdrawal + expense + consumed, portfolio, true, credits);
    return plan.items.map(row => ({ profileId: row.profileId,
        amount: Math.max(0, row.withdrawalAmount - (credits.find(item => item.profileId === row.profileId)?.amount || 0)) }));
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param inputs Wirksame Simulationseingaben.
 * @param pension
 * @param income
 * @param incomeLog
 * @returns {number} Ergebnis der Operation.
 */
export function creditConsumedIncome(portfolio, inputs, pension, income, incomeLog) {
    let total = 0;
    for (const { profileId: id, amount: consumed } of consumedIncomeCredits(portfolio, inputs, pension, income, incomeLog)) {
        if (!consumed) continue;
        const account = portfolio.personAccounts.find(row => row.profileId === id);
        if (!account) throw new Error('SIM_UNMARRIED_INCOME_OWNER_MISSING');
        account.tagesgeld += consumed;
        total += consumed;
    }
    syncPersonalLiquidity(portfolio);
    return total;
}

/**
 * @param shares
 * @param gross
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param {boolean} [includeCare]
 * @param {{profileId: string, amount: number}[]|null} [credits] Verbrauchte Einkünfte je Person (nur bei „Eine Person trägt“ wirksam).
 * @returns Ergebnis der Operation.
 */
export function unmarriedWithdrawalPlan(shares, gross, portfolio, includeCare = true, credits = null) {
    const care = includeCare ? shares.reduce((sum, row) => sum + row.care, 0) : 0;
    const shared = Math.max(0, gross - care);
    const values = personalAssetValues(portfolio, { includeReserve: false });
    const items = shares.map(row => ({ profileId: row.profileId, shared: shared * row.share, care: includeCare ? row.care : 0 }));
    // FR-80 Punkt 3: Reicht das Vermögen der tragenden Person nicht, geht der Rest des gemeinsamen Anteils an die andere Person.
    const attacked = [];
    const carrier = items.find(row => shares.find(share => share.profileId === row.profileId)?.carries);
    // FR-80 Punkt 2 (TRG-1b, P2-2): Die Einkünfte beider zählen zum Haushalt. Die andere Person zahlt ihre verbrauchten Einkünfte
    // (nach ihren eigenen Pflegekosten) in den gemeinsamen Anteil; die tragende Person trägt nur den Rest – wie in der Balance.
    if (carrier && credits) for (const item of items) {
        if (item === carrier) continue;
        const credit = Math.max(0, (credits.find(row => row.profileId === item.profileId)?.amount || 0) - item.care);
        const own = Math.min(carrier.shared, credit);
        item.shared += own; carrier.shared -= own;
    }
    if (carrier) {
        const over = Math.max(0, carrier.shared - (values.find(value => value.profileId === carrier.profileId)?.value || 0));
        const helper = items.find(item => item !== carrier);
        if (over > 0.005 && helper) { carrier.shared -= over; helper.shared += over; attacked.push({ profileId: helper.profileId, amount: over }); }
    }
    // FR-84: Persönliche Pflege bleibt bei der Person und geht nicht auf den Partner über. Was ihr Vermögen nach dem eigenen Anteil
    // nicht trägt, zahlt voraussichtlich der Staat (Hilfe zur Pflege); die Schätzung hält Haushaltsverkäufe dafür zurück.
    const withReserve = includeCare ? personalAssetValues(portfolio) : values;
    const careAid = items.reduce((sum, row) => sum + Math.max(0, row.care
        - Math.max(0, (withReserve.find(value => value.profileId === row.profileId)?.value || 0) - row.shared)), 0);
    return { mode: 'unmarried', fixedOwnership: true, totalNeed: gross, ...(attacked.length ? { attacked } : {}),
        ...(careAid > 0.005 ? { careAid } : {}),
        items: items.map(row => ({ ...row, withdrawalAmount: row.shared + row.care })) };
}

/** VK-3b (Gutachten VK3-FABLE P2-2, Nachtrag 1): Bei „Eine Person trägt“ zahlt die tragende Person höchstens, was sie auszahlen kann
 * (Tagesgeld und Geldmarkt). Der Plan rechnet mit ihrem Vermögenswert; bleibt nach dem Deckungsverkauf ein kleiner Depotrest, fehlte
 * sonst genau dieser Rest. Den fehlenden Teil des gemeinsamen Anteils trägt die andere Person mit Hinweis. FR-84 (NK-1b, Fable P2-5):
 * Reihenfolge der tragenden Person ist Grundbedarf, eigene Pflege, Flex. Eigene Pflege, die sie nach ihrem Grundbedarfsanteil nicht
 * zahlen kann, wird zuerst gekürzt (`careAid`, trägt der Staat); erst was danach fehlt, verschiebt sich zur anderen Person.
 * Ohne tragende Person bleibt der Plan unverändert. @param {{items: any[], attacked?: any[], careAid?: number}} plan @param {any[]} shares
 * @param portfolio @param {number} [floorShare] Grundbedarfsanteil im gemeinsamen Anteil der tragenden Person (ohne Angabe der ganze Anteil). */
export function capCarrierToPayable(plan, shares, portfolio, floorShare = undefined) {
    const carrierId = shares.find(row => row.carries)?.profileId;
    const carrier = plan.items.find(item => item.profileId === carrierId), helper = plan.items.find(item => item.profileId !== carrierId);
    if (!carrier || !helper) return plan;
    const payable = payableLiquidity(portfolio, /** @type {string} */ (carrierId));
    const floor = Math.min(Math.max(0, carrier.shared), floorShare ?? carrier.shared);
    const careCut = Math.max(0, (carrier.care || 0) - Math.max(0, payable - floor));
    const care = (carrier.care || 0) - careCut;
    const shift = Math.min(Math.max(0, carrier.shared), Math.max(0, carrier.shared + care - payable));
    if (!(shift > 0.005) && !(careCut > 0.005)) return plan;
    const items = plan.items.map(item => item === carrier ? { ...item, ...(careCut > 0.005 ? { care } : {}), shared: item.shared - shift,
        withdrawalAmount: item.withdrawalAmount - shift - (careCut > 0.005 ? careCut : 0) }
        : item === helper ? { ...item, shared: item.shared + shift, withdrawalAmount: item.withdrawalAmount + shift } : item);
    const attacked = [...(plan.attacked || [])];
    if (shift > 0.005) {
        const hit = attacked.findIndex(row => row.profileId === helper.profileId);
        if (hit >= 0) attacked[hit] = { ...attacked[hit], amount: attacked[hit].amount + shift };
        else attacked.push({ profileId: helper.profileId, amount: shift });
    }
    return { ...plan, items, ...(attacked.length ? { attacked } : {}), ...(careCut > 0.005 ? { careCut: { profileId: carrierId, amount: careCut } } : {}) };
}

/** FR-84 (NK-1b, Gutachten NK1C Befund 1, Fable P1-1 und P2-6): Eigene Pflege, die eine Person nach ihrem Anteil am Grundbedarf nicht
 * aus eigener Liquidität zahlen kann (Reihenfolge je Kasse: Grundbedarf, eigene Pflege, Flex). Diesen Teil trägt der Staat; er gehört
 * weder zur Auszahlung noch zur Neuverteilung, sonst kürzte die Liquiditätslücke den Grundbedarf.
 * @param {{profileId: string, shared: number, care: number}[]} items Plan über die ungekürzte Zielentnahme ohne geplante Ausgabe.
 * @param {{incomeConsumed: number, netFloorYear: number, floor?: number}} amounts @param portfolio
 * @param {{profileId: string, share: number}[]|null} [shares] NK-1c (Fable N5): Grundbedarfsanteil je Person nach ihrem Anteil (bei „Eine
 *   Person trägt“ die tragende Person), nicht nach dem Plan nach Rückgriff; so zahlen Einkünfte erst Grundbedarf, dann eigene Pflege, dann Flex.
 * @returns {{cut: Map<string, number>, ratio: number}} Gekürzte Pflege je Person und Grundbedarfsanteil am gemeinsamen Anteil. */
export function unpayableOwnCare(items, amounts, portfolio, shares = null, credits = null) {
    const careTotal = items.reduce((sum, row) => sum + Math.max(0, row.care || 0), 0);
    const sharedTotal = items.reduce((sum, row) => sum + Math.max(0, row.shared || 0), 0);
    const ratio = sharedTotal > 0 ? Math.min(1, Math.max(0, unmarriedHouseholdFloor(amounts) - careTotal) / sharedTotal) : 0;
    // Nach dem eigenen Grundbedarfsanteil; fehlt einer Person ihr Anteil, deckt ihn zuerst die andere (FR-84 Punkt 12 und 13), erst
    // danach zahlt sie ihre eigene Pflege.
    const basicFloor = Math.max(0, unmarriedHouseholdFloor(amounts) - careTotal);
    const floorOf = (/** @type {any} */ item) => {
        const share = shares?.find(row => row.profileId === item.profileId)?.share;
        return Number.isFinite(share) ? basicFloor * Number(share) : Math.max(0, item.shared || 0) * ratio;
    };
    const capacity = items.map(item => payableLiquidity(portfolio, item.profileId) - floorOf(item));
    let deficit = capacity.reduce((sum, value) => sum + Math.max(0, -value), 0);
    return { ratio, cut: new Map(items.map((item, index) => {
        // NK-2b (FR-84 Punkte 18/19 nach dem Wortlaut): Die Einkünfte der Person im Heim zahlen zuerst ihr Heim; nur der Rest und ihr Geld
        // decken die Lücke beim Grundbedarf zu Hause.
        const reserved = heimIncomeReserve(item, shares, credits);
        const cover = Math.min(Math.max(0, capacity[index] - reserved), deficit);
        deficit -= cover;
        return [item.profileId, Math.max(0, Math.max(0, item.care || 0) - Math.max(0, capacity[index] - cover))];
    })) };
}

/** Auszahlungsanteile, wenn die Auszahlung kleiner ist als der Plan (Liquiditätslücke) oder die geplante Ausgabe getrennt bezahlt wird.
 * Ohne tragende Person wie bisher linear nach Vermögensanteil. Bei „Eine Person trägt“ (FR-80, VK-2b P1-3) wird der Plan für den
 * tatsächlich gezahlten Betrag neu verteilt: Die Anteile sind dort nicht linear (Rückgriff und Einkünfte der anderen Person liegen
 * schon bei ihr), eine Kürzung über `share` würde nur die tragende Person kürzen und der anderen ihren übernommenen Teil lassen.
 * FR-84 (NK-1b): Die nicht bezahlbare eigene Pflege (`careCut`, Hilfe zur Pflege) fällt vor der Neuverteilung heraus; `target` ist
 * die Zielentnahme ohne sie.
 * @param {{items: any[], credits?: any}} plan Plan über Zielentnahme, verbrauchte Einkünfte und geplante Ausgabe.
 * @param {any[]} shares Anteile aus `unmarriedYearShares`.
 * @param {{payout: number, incomeConsumed: number, plannedExpense: number, target: number, ratio?: number}} amounts
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param {Map<string, number>|null} [careCut] Nicht bezahlbare eigene Pflege je Person.
 * @returns {{items: any[], careCut?: {profileId: string, amount: number}}} */
export function unmarriedPayoutPlan(plan, shares, { payout, incomeConsumed, plannedExpense, target, ratio = undefined }, portfolio, careCut = null) {
    const cut = (/** @type {string} */ id) => careCut?.get(id) || 0;
    if (shares.some(row => row.carries)) {
        const reduced = shares.map(row => ({ ...row, care: Math.max(0, row.care - cut(row.profileId)) }));
        const base = unmarriedWithdrawalPlan(reduced, payout + incomeConsumed, portfolio, true, plan.credits || null);
        const carrier = base.items.find(item => reduced.find(row => row.profileId === item.profileId)?.carries);
        const revised = capCarrierToPayable(base, reduced, portfolio, ratio === undefined || !carrier ? undefined : carrier.shared * ratio);
        return { ...plan, items: revised.items, ...(revised.attacked ? { attacked: revised.attacked } : {}),
            ...(/** @type {any} */ (revised).careCut ? { careCut: /** @type {any} */ (revised).careCut } : {}) };
    }
    return { ...plan, items: plan.items.map((item, i) => ({ ...item, ...(cut(item.profileId) > 0 ? { care: Math.max(0, item.care - cut(item.profileId)) } : {}),
        withdrawalAmount: Math.max(0, item.withdrawalAmount - cut(item.profileId) - plannedExpense * shares[i].share - (target - payout) * shares[i].share) })) };
}

/** FR-81: Grundbedarf im Haushalt = Floor nach Einkünften plus verbrauchte Einkünfte, höchstens der Floor selbst.
 * @param {{incomeConsumed: number, netFloorYear: number, floor?: number}} amounts */
export function unmarriedHouseholdFloor({ incomeConsumed, netFloorYear, floor }) {
    return Math.max(0, Math.min(netFloorYear + incomeConsumed, Number.isFinite(floor) ? Number(floor) : Infinity));
}

/** FR-81/FR-84: Gezahlte Beträge je Person nach der Reihenfolge Grundbedarf, eigene Pflege, Flex aufteilen. Der Anteil am Grundbedarf
 * ist der Grundbedarf des Haushalts ohne Pflege (Floor nach Einkünften plus verbrauchte Einkünfte, höchstens der Floor, abzüglich der
 * Pflegekosten) im Verhältnis des gemeinsamen Anteils der Person. Was danach an eigener Pflege fehlt, trägt der Staat (Hilfe zur
 * Pflege); was am Flex fehlt, ist eine Kürzung des Flex-Anteils. Eine Lücke im Grundbedarf deckt der Partner (FR-84 Punkt 12).
 * @param {{items: {profileId: string, care?: number}[]}} plan Plan der Auszahlung (mit eigener Pflege je Person).
 * @param {{items: {planned: number, amount: number}[]}} paid Ergebnis von `debitUnmarriedPlan` (gleiche Reihenfolge).
 * @param {{payout: number, incomeConsumed: number, netFloorYear: number, floor?: number}} amounts
 * @param {number} [careCut] NK-2b: vorab als Hilfe gekürzte eigene Pflege (nicht im Plan, aber im Haushaltsbedarf).
 * @returns {{profileId: string, floorGap: number, careAid: number, flexCut: number}[]} */
export function unmarriedPayoutAccounting(plan, paid, amounts, careCut = 0) {
    const rows = paid.items.map((row, index) => {
        const care = Math.min(Math.max(0, Number(plan.items[index]?.care) || 0), Math.max(0, row.planned));
        return { profileId: plan.items[index]?.profileId, planned: row.planned, amount: row.amount, care, shared: Math.max(0, row.planned - care) };
    });
    const careTotal = rows.reduce((sum, row) => sum + row.care, 0), sharedTotal = rows.reduce((sum, row) => sum + row.shared, 0);
    // NK-2b (Fable P2-3): Die vorab als Hilfe gekürzte Pflege steckt noch im Haushaltsbedarf; sie ist kein Grundbedarf.
    const basicFloor = Math.max(0, unmarriedHouseholdFloor(amounts) - careTotal - Math.max(0, careCut));
    const ratio = sharedTotal > 0 ? Math.min(1, basicFloor / sharedTotal) : 0;
    return rows.map(row => {
        const floor = row.shared * ratio, floorPaid = Math.min(row.amount, floor);
        const carePaid = Math.min(row.care, Math.max(0, row.amount - floorPaid));
        const flexPaid = Math.max(0, row.amount - floorPaid - carePaid);
        return { profileId: /** @type {string} */ (row.profileId), floorGap: floor - floorPaid, careAid: row.care - carePaid,
            flexCut: Math.max(0, row.shared - floor - flexPaid) };
    });
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param plan
 * @returns Ergebnis der Operation.
 */
export function debitUnmarriedPlan(portfolio, plan) {
    const rows = plan.items.map(item => ({ planned: item.withdrawalAmount,
        ...debitAccount(portfolio, portfolio.personAccounts.find(row => row.profileId === item.profileId), item.withdrawalAmount) }));
    syncPersonalLiquidity(portfolio);
    return { mode: plan.mode, items: rows, total: rows.reduce((sum, row) => sum + row.amount, 0), ...(plan.attacked ? { attacked: plan.attacked } : {}) };
}

/** NK-2b (FR-84 Punkte 18/19): Teil der verbrauchten Einkünfte, den die Person im Heim zuerst für ihr Heim einsetzt (höchstens die eigene
 * Pflege); 0 für alle anderen. @param {{profileId: string, care?: number}} item @param {any[]|null|undefined} shares
 * @param {{profileId: string, amount: number}[]|null|undefined} credits @returns {number} */
export function heimIncomeReserve(item, shares, credits) {
    if (!shares?.find(row => row.profileId === item.profileId)?.inHome) return 0;
    const income = Math.max(0, (credits || []).find(row => row.profileId === item.profileId)?.amount || 0);
    return Math.min(income, Math.max(0, item.care || 0));
}
