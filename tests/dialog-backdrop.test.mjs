import { bindDialogBackdrop } from '../app/shared/dialog-backdrop.js';

const listeners = {}, background = { addEventListener: (type, handler) => { listeners[type] = handler; } };
const field = {};
let closed = 0;
bindDialogBackdrop(background, () => closed++);
for (const [start, end] of [[field, background], [background, field], [field, field]]) {
    listeners.mousedown({ target: start, preventDefault() {} });
    listeners.click({ target: end });
    assertEqual(closed, 0, 'Ziehen über den Rand und Feldklick schließen nicht');
}
listeners.click({ target: background });
assertEqual(closed, 0, 'Klick ohne vorherigen Mausdruck schließt nicht');
listeners.mousedown({ target: background, preventDefault() {} });
listeners.click({ target: background });
assertEqual(closed, 1, 'Vollständiger Hintergrundklick schließt');
listeners.click({ target: background });
assertEqual(closed, 1, 'Ein Mausdruck wird nur einmal verwendet');

// Nativer Dialog: ein Druck innerhalb seines Rechtecks zählt nicht als Hintergrund.
bindDialogBackdrop(background, () => closed++, event => event.target === background && event.clientX < 10);
listeners.mousedown({ target: background, clientX: 20, preventDefault() {} });
listeners.click({ target: background, clientX: 0 });
assertEqual(closed, 1, 'Aus nativer Dialogfläche herausziehen schließt nicht');
listeners.mousedown({ target: background, clientX: 0, preventDefault() {} });
listeners.click({ target: background, clientX: 0 });
assertEqual(closed, 2, 'Nativer vollständiger Hintergrundklick schließt');
