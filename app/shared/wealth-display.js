import { formatDisplayNumber } from './designsystem-number-format.js';
import { infoPopoverContentHtml } from './designsystem-info-popover.js';
import { escapeHtml } from './security-utils.js';
import { immobilienWertverlauf, immobilienWertAm } from '../profile/profile-immobilien.js';

export const allocationNames = Object.freeze({ aktien: 'Aktien', aktien_alt: 'Aktien Altbestand', aktien_neu: 'Aktien Neubestand',
    geldmarkt: 'Geldmarkt', cash: 'Tagesgeld', gold: 'Gold', anleihe: 'Anleihen', homeSelf: 'Immobilien selbst genutzt', homeRented: 'Immobilien vermietet' });

/** Anzeige optionaler Anlagen; keine Änderung der Plan- oder Bestandswerte.
 *
 * @param active Wert für den bestehenden Aufrufvertrag.
 * @param amount Wert für den bestehenden Aufrufvertrag.
 * @returns {boolean} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const optionalWealthVisible = (active, amount) => active === true || amount > 0;

/**
 * @param value Zu verarbeitender Wert.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const wealthMoney = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }) : '—';
export const propertyHistoryNotice = 'Die gestapelte Fläche zeigt das Gesamtvermögen. Immobilien zählen an jedem Tag mit dem damals gültigen Wert. Veränderung, Entnahmen und Rendite beziehen sich auf das Geldvermögen.';
export const percentileWealthNotice = 'Eine eindeutige Aufteilung gibt es für Perzentile nicht: Die Summe der Klassen-Perzentile ist nicht das Perzentil der Summe; die angezeigten Geld- und Immobilienanteile stammen aus denselben nach Gesamtvermögen sortierten Beobachtungen und werden am selben Rang interpoliert. Die Pfadauswahl bleibt beim Geldvermögen.';

/**
 * @param profiles Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function propertyParts(profiles = []) {
    const homes = profiles.flatMap(person => person.values?.immobilien || []);
    const self = homes.filter(home => home.nutzung === 'selbst').reduce((sum, home) => sum + home.wert, 0);
    const rented = homes.filter(home => home.nutzung === 'vermietet').reduce((sum, home) => sum + home.wert, 0);
    return { self, rented, total: self + rented, present: homes.length > 0 };
}

/** Ausschließlich lesende Anzeige; Geldmarkt und Tagesgeld gehören zur Liquidität.
 *
 * @param allocation Wert für den bestehenden Aufrufvertrag.
 * @param homes Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function wealthAllocationRows(allocation = {}, homes = {}) {
    homes ||= {};
    const parts = [
        [allocationNames.cash, allocation.cash ?? 0], [allocationNames.geldmarkt, allocation.geldmarkt ?? 0],
        [allocationNames.aktien, allocation.aktien ?? ((allocation.aktien_alt ?? 0) + (allocation.aktien_neu ?? 0))],
        [allocationNames.gold, allocation.gold ?? 0], [allocationNames.anleihe, allocation.anleihe ?? 0],
        [allocationNames.homeSelf, homes.self ?? 0], [allocationNames.homeRented, homes.rented ?? 0]
    ].filter(([, value]) => value !== 0);
    const total = parts.reduce((sum, [, value]) => sum + value, 0);
    return parts.map(([label, value]) => ({ label, amount: wealthMoney(value), share: total > 0 ? formatDisplayNumber(value / total, { unit: 'ratio', fractionDigits: 1 }) : '' }));
}

/**
 * @param allocation Wert für den bestehenden Aufrufvertrag.
 * @param homes Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function wealthAllocationText(allocation, homes) {
    return wealthAllocationRows(allocation, homes).map(row => `${row.label} ${row.amount} (${row.share})`).join(' · ') || 'Alle Anlageklassen 0 €';
}

/**
 * @param allocation Wert für den bestehenden Aufrufvertrag.
 * @param homes Wert für den bestehenden Aufrufvertrag.
 * @param {string} [notice] Erklärtext unter der Aufteilung im selben Popover.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function wealthInfo(allocation, homes, notice = '') {
    const rows = wealthAllocationRows(allocation, homes);
    const content = rows.length ? `<span class="ds-wealth-allocation">${rows.map(row => `<span>${escapeHtml(row.label)}</span><span class="ds-wealth-amount">${escapeHtml(row.amount)}</span><span class="ds-wealth-share">${escapeHtml(row.share)}</span>`).join('')}</span>` : 'Alle Anlageklassen 0 €';
    const explanation = notice ? `<small class="ds-explanation">${escapeHtml(notice)}</small>` : '';
    return infoPopoverContentHtml('Aufteilung des Vermögens', content + explanation);
}

/**
 * @param money Wert für den bestehenden Aufrufvertrag.
 * @param homes Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function wealthDetail(money, homes) {
    return homes?.present || homes?.total > 0 ? `davon Geldvermögen ${wealthMoney(money)} · Immobilien ${wealthMoney(homes.total)}` : '';
}

/**
 * @param allocation Wert für den bestehenden Aufrufvertrag.
 * @param homes Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function wealthAllocation(allocation = {}, homes = {}) {
    return { ...allocation, homeSelf: homes.self || 0, homeRented: homes.rented || 0 };
}

/** Eigene Anzeigeprojektion; Tageswerte und Messkennzahlen bleiben unverändert. FR-85: An jedem Tag zählt der damals gültige
 * Immobilienwert, vor dem ersten Eintrag der erste bekannte Wert; eine entfernte Immobilie zählt bis zu ihrem Ende.
 *
 * @param history Wert für den bestehenden Aufrufvertrag.
 * @param profiles Personen mit `values.immobilien` und optional `immobilienBeendet` (Verläufe entfernter Immobilien).
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function withPropertyHistory(history, profiles = []) {
    if (!history) return history;
    const homes = profiles.flatMap(person => person.values?.immobilien || []);
    const ended = profiles.flatMap(person => person.immobilienBeendet || []);
    if (!homes.length && !ended.length) return history;
    const rows = [...homes.map(home => ({ nutzung: home.nutzung, verlauf: immobilienWertverlauf(home), ende: null })),
        ...ended.map(home => ({ nutzung: home.nutzung, verlauf: home.wertverlauf, ende: home.ende }))];
    const points = history.points.map(point => {
        const date = point.date ?? (Number.isInteger(point.day) ? new Date(point.day * 86400000).toISOString().slice(0, 10) : null);
        const valued = rows.filter(row => !row.ende || !date || date <= row.ende)
            .map(row => ({ nutzung: row.nutzung, wert: date ? immobilienWertAm(row.verlauf, date) : row.verlauf.at(-1).wert }));
        const parts = propertyParts([{ values: { immobilien: valued } }]);
        return { ...point, property: parts, totalWithHomes: Number.isFinite(point.total) ? point.total + parts.total : null };
    });
    return { ...history, hasHomes: true, points, end: points.at(-1) || null };
}
