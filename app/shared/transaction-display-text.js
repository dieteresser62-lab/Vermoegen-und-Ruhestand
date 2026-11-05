/** Nur die Handelsanzeige: Rundungsreste unter einem halben Cent sind null.
 *
 * @param value Zu verarbeitender Wert.
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function displayTradeAmount(value) {
    const amount = Number(value);
    return Number.isFinite(amount) && Math.abs(amount) >= .005 ? amount : 0;
}

/** Nur Anzeigetitel; Engine-Handlungen und Exporttexte bleiben unverändert.
 *
 * @param value Zu verarbeitender Wert.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function translateBufferActionText(value) {
    return String(value ?? '')
        .replaceAll('Notfall-Verkauf (Puffer-Auffüllung)', 'Tagesgeld bis zum Mindestpuffer aufgefüllt')
        .replaceAll('Notfall-Verkauf (Puffer-Sicherung)', 'Tagesgeld-Mindestpuffer gesichert')
        .replaceAll('Notfall-Refill', 'Tagesgeld bis zum Mindestpuffer aufgefüllt');
}
