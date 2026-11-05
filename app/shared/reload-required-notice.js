/** Eigener Hinweis überlebt spätere Statusmeldungen des Navigationsguards.
 *
 * @param options Optionen des Aufrufers.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function renderReloadRequiredNotice({ doc, win, id, message }) {
    const host = doc?.getElementById?.('suiteNavigationStatus');
    if (!host || !doc.createElement) return null;
    const existing = doc.getElementById(id);
    if (existing) return existing;
    const notice = doc.createElement('p');
    notice.id = id;
    notice.className = 'ds-note';
    notice.textContent = `${message} `;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'ds-button';
    button.textContent = 'Jetzt neu laden';
    button.addEventListener('click', () => win?.location?.reload());
    notice.appendChild(button);
    if (host.insertAdjacentElement) host.insertAdjacentElement('afterend', notice);
    else doc.body?.appendChild(notice);
    return notice;
}
