// Ohne Engine ladbar: Auswahl und Namen werden auch beim Seitenstart gebraucht.
export const MUSTER_HAUSHALTE = Object.freeze([
    Object.freeze({ id: 'max-erika', name: 'Max und Erika', label: 'Max und Erika – Paar in Rente, Aktien-ETF' }),
    Object.freeze({ id: 'renate', name: 'Renate', label: 'Renate – allein, knapp, Aktien/Anleihen 50/50' }),
    Object.freeze({ id: 'jan-lena', name: 'Jan und Lena', label: 'Jan und Lena – früher Ruhestand, 10 % Gold' }),
    Object.freeze({ id: 'helga-werner', name: 'Helga und Werner', label: 'Helga und Werner – vorsichtig, Aktien/Anleihen/Gold 50/30/20' })
]);
export const DEFAULT_MUSTER_HAUSHALT = MUSTER_HAUSHALTE[0].id;

export function musterHaushalt(householdId = DEFAULT_MUSTER_HAUSHALT) {
    const household = MUSTER_HAUSHALTE.find(entry => entry.id === householdId);
    if (!household) throw new Error('Beschädigter Spielbereich-Zustand: unbekannter Beispielhaushalt. Bitte den Spielbereich beenden.');
    return household;
}
