// Ausschließlich Anzeige: vorhandene Beträge runden, keine Budgetentscheidung.
/**
 * @param value Zu verarbeitender Wert.
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const moneyCents = value => {
    const scaled = value * 100;
    return Math.round(scaled + Number.EPSILON * Math.max(1, Math.abs(scaled)));
};
/**
 * @param cents Wert für den bestehenden Aufrufvertrag.
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const wholeEuro = cents => Math.round(cents / 100);

/** Der Rest liegt ausschließlich beim vorhandenen Entnahme-/Anlagebetrag.
 *
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function projectMonthlyFlow({ income, oneTime = 0, withdrawal = 0, budget, expenses = 0, saving = 0 }) {
    const cents = Object.fromEntries(Object.entries({ income, oneTime, withdrawal, budget, expenses, saving })
        .map(([key, value]) => [key, moneyCents(value)]));
    const euros = Object.fromEntries(Object.entries(cents).map(([key, value]) => [key, wholeEuro(value)]));
    const balance = values => {
        const rest = values.budget + values.expenses + values.saving - values.income - values.oneTime - values.withdrawal;
        const transfer = values.withdrawal - values.saving + rest;
        // Auch an der Rundungsgrenze bleiben beide Beträge ohne negatives Vorzeichen.
        values.withdrawal = Math.max(0, transfer);
        values.saving = Math.max(0, -transfer);
    };
    balance(cents); balance(euros);
    return { cents, euros };
}

/**
 * @param details Wert für den bestehenden Aufrufvertrag.
 * @param totalEuro Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function roundedIncomeDetails(details, totalEuro) {
    const result = details.map(item => ({ ...item, amount: Math.floor(moneyCents(item.amount) / 100) }));
    const rest = totalEuro - result.reduce((sum, item) => sum + item.amount, 0);
    // Größte Nachkommaanteile zuerst; kleine Einkünfte werden dadurch nie negativ.
    const order = details.map((item, index) => ({ index, fraction: moneyCents(item.amount) % 100 }))
        .sort((a, b) => b.fraction - a.fraction);
    for (const { index } of order.slice(0, Math.max(0, rest))) result[index].amount++;
    return result;
}

/**
 * @param host Wert für den bestehenden Aufrufvertrag.
 * @param details Wert für den bestehenden Aufrufvertrag.
 * @param format Wert für den bestehenden Aufrufvertrag.
 * @param notes Wert für den bestehenden Aufrufvertrag.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function renderIncomeDetails(host, details, format, notes = []) {
    if (!host) return;
    const doc = host.ownerDocument || globalThis.document;
    host.replaceChildren();
    host.hidden = details.length === 0 && notes.length === 0;
    const summary = doc.createElement('summary');
    summary.textContent = `Feste Einkünfte · ${details.length} ${details.length === 1 ? 'Einkunft' : 'Einkünfte'}`;
    const list = doc.createElement('div'); list.className = 'monthly-flow-details';
    host.append(summary, list);
    for (const item of details) {
        const row = doc.createElement('div'); row.className = 'monthly-flow-detail-row';
        const label = doc.createElement('span'); label.textContent = item.label;
        const amount = doc.createElement('span'); amount.textContent = format(item.amount);
        row.append(label, amount); list.appendChild(row);
    }
    if (notes.length) {
        const hints = doc.createElement('div'); hints.className = 'monthly-flow-income-notes';
        hints.append(...notes); host.appendChild(hints);
    }
}

/** Gemeinsamer schmaler Balken; Anlage ist der nicht verbrauchte Einkunftsanteil.
 *
 * @param host Wert für den bestehenden Aufrufvertrag.
 * @param flow Wert für den bestehenden Aufrufvertrag.
 * @param {number} cut Wert für den bestehenden Aufrufvertrag.
 * @param format Wert für den bestehenden Aufrufvertrag.
 * @returns {void} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function renderMonthlyFlowBar(host, flow, cut = 0, format = String) {
    if (!host) return;
    host.replaceChildren();
    if (!flow) return;
    const doc = host.ownerDocument || globalThis.document;
    const { income, oneTime, withdrawal, budget, expenses, saving } = flow.euros;
    const consumedIncome = Math.min(income, budget + expenses);
    const consumedOneTime = Math.max(0, Math.min(oneTime, budget + expenses - consumedIncome));
    const parts = [
        ['income', 'Feste Einkünfte', consumedIncome],
        ['one-time', 'Einmalige Einkünfte', consumedOneTime],
        ['withdrawal', 'aus dem Vermögen', withdrawal],
        ['saving', 'angelegt', saving],
        ['cut', 'gekürzt', Math.max(0, Math.round(cut))]
    ];
    const total = parts.reduce((sum, [, , amount]) => sum + amount, 0);
    for (const [kind, label, amount] of parts) {
        if (amount <= 0) continue;
        const part = doc.createElement('span'); part.className = `monthly-flow-part monthly-flow-${kind}`;
        part.style.width = `${amount / total * 100}%`;
        part.title = `${label} ${format(amount)}`;
        host.appendChild(part);
    }
}
