/** Nur ein vollständiger Hintergrundklick schließt: Herausziehen beim Markieren bleibt folgenlos.
 * Der Aufrufer behält seine Schließprüfung samt Rückfrage bei ungespeicherten Eingaben.
 * @param {HTMLElement|null} backdrop @param {() => unknown} close
 * @param {(event: MouseEvent) => boolean} [isBackground] */
export function bindDialogBackdrop(backdrop, close, isBackground = event => event.target === backdrop) {
    if (!backdrop) return;
    let startedOnBackground = false;
    backdrop.addEventListener('mousedown', event => {
        startedOnBackground = isBackground(event);
        if (startedOnBackground) event.preventDefault();
    });
    backdrop.addEventListener('click', event => {
        const complete = startedOnBackground && isBackground(event);
        startedOnBackground = false;
        if (complete) close();
    });
}
