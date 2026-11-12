import { createCareValuesDraft, readCareValues, residentialComponents, residentialMonthly } from './household-care-values.js';
import { projectCareValuesForYear, resolveCarePrices } from './care-prices.js';
import { annualCareProfileId, careSettingsStorage, sharesHouseholdCareValues } from './care-profile-settings.js';
import { persistenceStorage } from './persistence-facade.js';
import { parseHouseholdPlanNumber } from './household-plan-fields.js';
import { careTodayOwnValuesForClosing } from './care-today-closing.js';

const month = value => value.split('-').reverse().join('.');
const money = value => value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
const percent = value => value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
const HOME_PARTS = [['care', 'homeCare', 'Pflegeanteil vor Zuschuss'], ['board', 'homeBoard', 'Unterkunft und Verpflegung'], ['invest', 'homeInvest', 'Investitionskosten']];
const GRADES = [1, 2, 3, 4, 5];
// Geschützte Leerzeichen: „ab 4. Jahr 2.111 €“ bricht nicht mitten im Eintrag um.
const heimYears = components => [1, 2, 3, 4].map(year => `${year === 4 ? 'ab 4.' : `${year}.`} Jahr ${money(residentialMonthly(components, year))} €`).join(' · ');
const heimParts = components => `Je Monat vor Zuschuss: ${HOME_PARTS.map(([part, , title]) => `${title.replace(' vor Zuschuss', '')} ${money(components[part])} €`).join(' · ')}`;
const sameAmount = (a, b) => Math.abs(a - b) < 0.005;

/** Entwurf bleibt bis zum Jahresbatch ausschließlich im Dialog. FR-73 Punkt 9: Liegt die Abschlussinflation vor,
 * zeigt der Entwurf Staffel, Deckel und Heim-Bestandteile × (1 + Inflation) × (1 + Kostenanstieg) sowie eigene Ausgaben
 * × (1 + Inflation), stets aus der eingefrorenen Ausgangsbasis gerechnet. Eigene Eingaben bleiben erhalten und werden
 * nicht nochmals erhöht; eine geänderte Inflation rechnet die Vorschläge neu und hebt die Bestätigung auf.
 *
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function createAnnualCareEditor({ doc, targetYear, listen, storage = persistenceStorage, onState = () => {} }) {
    const planningYear = targetYear + 1;
    // Argon FR73A B2: Preisbesitzer wie im Abschlussbatch, nicht die zuletzt geöffnete Außenperson.
    const careProfileId = annualCareProfileId(storage);
    const legacy = careSettingsStorage(storage, careProfileId), shared = sharesHouseholdCareValues(storage, careProfileId);
    // Eingefrorene Ausgangsbasis: der gespeicherte Record; jede Fortschreibung rechnet von hier aus.
    const original = readCareValues(storage);
    // Der Kostenanstieg kommt mit den Preisen: markiert aus dem Record, sonst Altbestand über den Resolver (PFA-2 B6).
    const basePrices = resolveCarePrices(original, legacy, { shared }), driftPercent = basePrices.driftPercent;
    const official = legacy.getItem('sim_pflegeKostenStaffelPreset') === 'amtlich';
    let inflationRate = /** @type {number|null} */ (null);
    /** Vorschlag für das neue Planjahr; ohne Inflation die unveränderte Basis mit ergänztem Preisblock. */
    const proposal = () => inflationRate === null
        ? { ...structuredClone(original), prices: { costs: { ...basePrices.costs }, maximumFloor: basePrices.maximumFloor,
            ownExpensesMonthly: basePrices.ownExpensesMonthly, origin: basePrices.origin, priceYear: basePrices.priceYear ?? planningYear } }
        : projectCareValuesForYear(original, { inflationRate, driftPercent, priceYear: planningYear, legacySource: legacy, shared });
    let proposed = proposal(), proposedHome = residentialComponents(proposed.residential);
    const draft = createCareValuesDraft(proposed, planningYear);
    // Angezeigt wird auf Cent gerundet; ein unberührtes Feld behält den genauen Bestandteil.
    const shownHome = () => Object.fromEntries(HOME_PARTS.map(([part]) => [part, Number(proposedHome[part].toFixed(2))]));
    const node = (tag, text = '', className = '') => { const el = doc.createElement(tag); el.textContent = text; el.className = className; return el; };
    const root = node('section', '', 'annual-care-editor'); root.dataset.annualCareEditor = '';
    const explanation = node('p', '', 'annual-care-explanation'); explanation.dataset.annualCareExplanation = ''; root.append(explanation);
    const columns = node('div', '', 'close-dialog-columns'); root.append(columns);
    const headings = new Map();
    const heading = (key, title, part, label, href) => {
        const head = node('div', '', 'annual-care-heading'), meta = node('small');
        const link = href ? node('a', label, 'ds-text-link') : null;
        if (link) { link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        const render = next => {
            meta.textContent = `${next.asOf ? `Stand ${month(next.asOf)} · ` : next.priceYear ? `Preisstand ${next.priceYear} · ` : ''}${next.origin}${link ? ' · ' : ''}`;
            if (link) meta.append(link);
        };
        render(part); head.append(node('h4', title), meta);
        const group = node('section'); columns.append(group); group.append(head);
        headings.set(key, render);
        return group;
    };
    const allowance = heading('allowance', 'Pflegegeld je Grad', original.allowance, 'Bundesgesundheitsministerium', original.allowance.source);
    const tiles = node('div', '', 'annual-care-grades'), displays = new Map();
    for (const grade of GRADES) {
        const tile = node('div'), value = node('strong', grade === 1 ? '—' : money(original.allowance.values[grade]) + ' €');
        tile.append(node('small', `Grad ${grade}`), value); tiles.append(tile); displays.set(String(grade), value);
    }
    allowance.append(node('small', '€/Monat'), tiles);
    const residential = heading('residential', 'Heim-Eigenanteil im ersten Jahr', proposed.residential, 'vdek', original.residential.source);
    const home = node('div', '', 'annual-care-home'), homeValue = node('strong', `${money(proposed.residential.monthly)} €/Monat`);
    // FR-72: Der Heimwert gilt für jede Heimpflege in Simulator und Balance, nicht nur für den amtlichen Durchschnitt.
    home.append(node('span', 'für jede Heimpflege, erstes Jahr nach Zuschuss'), homeValue); residential.append(home);
    const homeParts = node('small', heimParts(proposedHome), 'annual-care-home-parts');
    homeParts.dataset.annualCareHomeParts = ''; residential.append(homeParts);
    const homeYears = node('small', `Nach Zuschuss der Kasse: ${heimYears(proposedHome)}`, 'annual-care-home-years');
    homeYears.dataset.annualCareHomeYears = ''; residential.append(homeYears);
    // FR-73 P8: Staffel zu Hause, Deckel und eigene Ausgaben im Heim gehören zum Haushalt.
    const prices = heading('prices', 'Pflege zu Hause und eigene Ausgaben im Heim', proposed.prices, '', null);
    const priceTiles = node('div', '', 'annual-care-grades'); priceTiles.dataset.annualCarePrices = '';
    for (const grade of GRADES) {
        const tile = node('div'), value = node('strong', money(proposed.prices.costs[grade]) + ' €');
        tile.append(node('small', `Grad ${grade}`), value); priceTiles.append(tile); displays.set(`cost${grade}`, value);
    }
    prices.append(node('small', official ? '€/Jahr zu Hause · Simulator rechnet mit dem amtlichen Durchschnitt aus den Heimwerten' : '€/Jahr zu Hause'), priceTiles);
    const extra = node('div', '', 'annual-care-home');
    const maxFloor = node('strong', `${money(proposed.prices.maximumFloor)} €/Jahr`), ownExpenses = node('strong', `${money(proposed.prices.ownExpensesMonthly)} €/Monat`);
    extra.append(node('span', 'Maximaler Pflege-Floor je Person'), maxFloor, node('span', 'Eigene Ausgaben im Heim je Person'), ownExpenses); prices.append(extra);
    displays.set('maxFloor', maxFloor); displays.set('ownExpenses', ownExpenses);
    // FR-73 Punkt 13: eigene Werte „Pflegekosten heute über die Kasse hinaus“ je Person, fortgeschrieben wie die Staffel;
    // unter „Werte ändern …“ je Person änderbar (Gutachten PFA-4, Befund 3), der bestätigte Betrag geht in den Abschlussbatch.
    const ownValues = node('small', '', 'annual-care-own-values'); ownValues.dataset.annualCareOwnValues = ''; ownValues.hidden = true; prices.append(ownValues);
    const ownKey = profileId => `own:${profileId}`;
    /** @type {Record<string, number>} Bestätigte eigene Beträge je Person (nur berührte Felder). */
    let careToday = {};
    let ownRows = careTodayOwnValuesForClosing(storage, { inflationRate: inflationRate ?? 0, driftPercent });
    const ownProposed = row => inflationRate === null ? row.monthly : row.projected;
    const renderOwnValues = () => {
        ownRows = careTodayOwnValuesForClosing(storage, { inflationRate: inflationRate ?? 0, driftPercent });
        ownValues.hidden = !ownRows.length;
        ownValues.textContent = ownRows.length ? `Eigener Wert Pflege zu Hause je Person: ${ownRows.map(row => `${row.name} ${money(row.monthly)} €${inflationRate === null
            ? '' : ` → ${money(careToday[row.profileId] ?? row.projected)} €`}/Monat`).join(' · ')}` : '';
    };
    renderOwnValues();
    const actions = node('div', '', 'annual-care-actions');
    const confirmButton = doc.createElement('button'); confirmButton.textContent = 'Unverändert bestätigen'; confirmButton.className = 'ds-button ds-button-primary';
    const edit = doc.createElement('button'); edit.textContent = 'Werte ändern …'; edit.className = 'ds-button ds-button-secondary';
    confirmButton.type = edit.type = 'button'; confirmButton.dataset.annualCareConfirm = '';
    edit.dataset.annualCareEdit = ''; actions.append(confirmButton, edit); root.append(actions);
    const panel = node('div', '', 'annual-care-fields'); panel.hidden = true; panel.dataset.annualCareFields = '';
    const inputs = new Map(), errors = new Map(), touched = new Set();
    /** Vorgeschlagener Wert eines Feldes aus dem aktuellen Vorschlag. */
    const proposedValue = key => key.startsWith('home') ? shownHome()[HOME_PARTS.find(([, field]) => field === key)[0]]
        : key.startsWith('cost') ? proposed.prices.costs[Number(key.slice(4))] : key === 'maxFloor' ? proposed.prices.maximumFloor
            : key === 'ownExpenses' ? proposed.prices.ownExpensesMonthly
                : key.startsWith('own:') ? ownProposed(ownRows.find(row => ownKey(row.profileId) === key)) : original.allowance.values[key];
    const fieldSpecs = [...[2, 3, 4, 5].map(grade => [String(grade), `Pflegegeld Grad ${grade} (€/Monat)`]),
        ...HOME_PARTS.map(([, field, title]) => [field, `Heim: ${title} (€/Monat)`]),
        ...GRADES.map(grade => [`cost${grade}`, `Pflege zu Hause Grad ${grade} (€/Jahr)`]),
        ['maxFloor', 'Maximaler Pflege-Floor (€/Jahr)'], ['ownExpenses', 'Eigene Ausgaben im Heim (€/Monat)'],
        ...ownRows.map(row => [ownKey(row.profileId), `Pflege zu Hause ${row.name}: eigener Wert (€/Monat)`]), ['from', 'gültig ab']];
    for (const [key, label] of fieldSpecs) {
        const row = node('div', '', 'ds-field'), input = node('input'), title = node('label', label), error = node('small', '', 'household-plan-error');
        input.type = 'text'; input.id = `annualCare_${key}`; input.dataset.annualCareField = key; input.className = 'ds-input';
        input.value = key === 'from' ? `01.${planningYear}` : money(proposedValue(key)) + ' €';
        input.setAttribute('inputmode', key === 'from' ? 'numeric' : 'decimal'); title.setAttribute('for', input.id);
        error.id = `${input.id}_error`; error.hidden = true; input.setAttribute('aria-describedby', error.id);
        if (key === 'from') input.placeholder = 'MM.JJJJ';
        row.append(title, input, error); panel.append(row); inputs.set(key, input); errors.set(key, error);
        if (key !== 'from') {
            listen(input, 'focus', () => { input.select?.(); });
            listen(input, 'blur', () => { const amount = parseHouseholdPlanNumber(input.value, 'floorBedarf'); if (Number.isFinite(amount) && amount >= 0) input.value = money(amount) + ' €'; });
        }
        listen(input, 'input', () => { if (key !== 'from') touched.add(key); update(); onState(); });
        listen(input, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur?.(); } });
    }
    panel.append(node('small', 'Geänderte Werte erhalten die Herkunft „von Hand“ und werden nicht nochmals fortgeschrieben. Gespeichert wird erst mit dem Jahresabschluss.'));
    root.append(panel);
    let valid = true;
    const renderExplanation = () => {
        explanation.textContent = inflationRate === null
            ? 'Diese Werte rechnen Simulator und Balance für Pflege. Staffel, Deckel und Heimkosten werden mit der Inflation des Jahres und dem Kostenanstieg fortgeschrieben, sobald die Inflation vorliegt; eigene Ausgaben im Heim nur mit der Inflation. Pflegegeld und Kassenleistungen ändern sich nur per Gesetz.'
            : `Fortgeschrieben für ${planningYear}: Staffel, Deckel und Heim-Bestandteile × Inflation ${percent(inflationRate)} % × Kostenanstieg über der Inflation ${percent(driftPercent)} %, eigene Ausgaben im Heim × Inflation, auf ganze Euro gerundet. Pflegegeld und Kassenleistungen ändern sich nur per Gesetz.`;
    };
    function update() {
        const next = structuredClone(proposed), home = { ...proposedHome }; valid = true; careToday = {};
        const shown = shownHome();
        for (const [key, input] of inputs) {
            let error = '';
            if (key === 'from') { if (!/^(0?[1-9]|1[0-2])[./]\d{4}$/.test(input.value.trim())) error = 'Bitte MM.JJJJ eingeben.'; }
            else {
                const amount = parseHouseholdPlanNumber(input.value, 'floorBedarf');
                if (!Number.isFinite(amount) || amount < 0) error = 'Bitte einen Betrag ab 0 eingeben.';
                else if (!touched.has(key)) { /* unberührt: Vorschlag */ }
                else if (key.startsWith('home')) { const [part] = HOME_PARTS.find(([, field]) => field === key); if (!sameAmount(amount, shown[part])) home[part] = amount; }
                else if (key.startsWith('cost')) next.prices.costs[Number(key.slice(4))] = amount;
                else if (key === 'maxFloor') next.prices.maximumFloor = amount;
                else if (key === 'ownExpenses') next.prices.ownExpensesMonthly = amount;
                else if (key.startsWith('own:')) careToday[key.slice(4)] = amount;
                else next.allowance.values[key] = amount;
            }
            input.setAttribute('aria-invalid', String(Boolean(error))); errors.get(key).textContent = error; errors.get(key).hidden = !error; valid &&= !error;
        }
        confirmButton.disabled = !valid;
        const homeChanged = HOME_PARTS.some(([part]) => home[part] !== proposedHome[part]);
        if (valid && homeChanged) {
            const components = { care: home.care, board: home.board, invest: home.invest };
            next.residential = { ...next.residential, components, monthly: residentialMonthly(components) };
        }
        if (valid) {
            const [m, y] = inputs.get('from').value.trim().split(/[./]/), validFrom = `${y}-${m.padStart(2, '0')}`;
            const allowanceChanged = [2, 3, 4, 5].some(grade => next.allowance.values[grade] !== proposed.allowance.values[grade]);
            const pricesChanged = GRADES.some(grade => next.prices.costs[grade] !== proposed.prices.costs[grade])
                || next.prices.maximumFloor !== proposed.prices.maximumFloor || next.prices.ownExpensesMonthly !== proposed.prices.ownExpensesMonthly;
            if (allowanceChanged) Object.assign(next.allowance, { origin: 'von Hand', validFrom, asOf: validFrom });
            if (homeChanged) Object.assign(next.residential, { origin: 'von Hand', validFrom, asOf: validFrom });
            if (pricesChanged) Object.assign(next.prices, { origin: 'von Hand', priceYear: Number(y) });
            if (touched.size) draft.change(next); else draft.propose(next);
            headings.get('allowance')(next.allowance); headings.get('residential')(next.residential); headings.get('prices')(next.prices);
            for (const grade of [2, 3, 4, 5]) displays.get(String(grade)).textContent = money(next.allowance.values[grade]) + ' €';
            for (const grade of GRADES) displays.get(`cost${grade}`).textContent = money(next.prices.costs[grade]) + ' €';
            maxFloor.textContent = `${money(next.prices.maximumFloor)} €/Jahr`; ownExpenses.textContent = `${money(next.prices.ownExpensesMonthly)} €/Monat`;
            homeValue.textContent = money(next.residential.monthly) + ' €/Monat';
            homeParts.textContent = heimParts(residentialComponents(next.residential));
            homeYears.textContent = `Nach Zuschuss der Kasse: ${heimYears(residentialComponents(next.residential))}`;
        } else draft.change(draft.read().values);
        confirmButton.textContent = touched.size ? 'Werte bestätigen' : 'Unverändert bestätigen';
        renderExplanation(); renderOwnValues();
    }
    /** Abschlussinflation setzen; nur eine Änderung rechnet neu und hebt eine Bestätigung auf.
     * @param {number|null} rate Inflation in Prozent oder null, solange sie fehlt. @returns {boolean} Ob sich der Vorschlag geändert hat. */
    const setInflation = rate => {
        const next = Number.isFinite(rate) ? Number(rate) : null;
        if (next === inflationRate) return false;
        inflationRate = next; proposed = proposal(); proposedHome = residentialComponents(proposed.residential);
        ownRows = careTodayOwnValuesForClosing(storage, { inflationRate: inflationRate ?? 0, driftPercent });
        for (const [key, input] of inputs) if (key !== 'from' && !touched.has(key)) input.value = money(proposedValue(key)) + ' €';
        update();
        return true;
    };
    renderExplanation();
    listen(edit, 'click', () => { panel.hidden = !panel.hidden; edit.setAttribute('aria-expanded', String(!panel.hidden)); });
    listen(confirmButton, 'click', () => { if (!valid) return; draft.confirmValues(); confirmButton.textContent = 'Bestätigt'; onState(); });
    // `careToday` nennt die bestätigten eigenen Beträge je Person; unberührte Felder fehlen und werden im Abschluss fortgeschrieben.
    return { root, setInflation, read: () => ({ ...draft.read(), confirmed: valid && draft.read().confirmed, careToday: { ...careToday } }), accept: draft.accept };
}
