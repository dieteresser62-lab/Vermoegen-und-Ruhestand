import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { ActionRenderer as Implementation } from '../app/balance/balance-renderer-action/renderer.js';
import { detailsMethods } from '../app/balance/balance-renderer-action/details.js';
import { cashRebalanceMethods } from '../app/balance/balance-renderer-action/cash-rebalance.js';
import { transactionMethods } from '../app/balance/balance-renderer-action/transaction.js';

assertEqual(ActionRenderer, Implementation, 'Die Fassade erhält dieselbe Rendererklasse');
const renderer = new ActionRenderer({ outputs: {} });
const other = new ActionRenderer({ outputs: {} });
assert(renderer.dom !== other.dom, 'Renderer halten getrennte DOM-Kontexte');
renderer.copyText = 'nur diese Instanz';
assertEqual(other.getActionCopyText(), '', 'Kopiertext bleibt auf seiner Instanz');

for (const methods of [detailsMethods, cashRebalanceMethods, transactionMethods]) {
    for (const [name, implementation] of Object.entries(methods)) {
        const descriptor = Object.getOwnPropertyDescriptor(ActionRenderer.prototype, name);
        assert(descriptor && !descriptor.enumerable && descriptor.writable && descriptor.configurable,
            `${name}: Klassenmethoden behalten ihre Prototypdeskriptoren`);
        assertEqual(descriptor.value.length, implementation.length, `${name}: Signaturlänge bleibt erhalten`);
        const sentinel = {};
        let receiver;
        let args;
        methods[name] = function (...values) { receiver = this; args = values; return sentinel; };
        try {
            const inputs = Array.from({ length: 6 }, () => ({}));
            const result = renderer[name](...inputs);
            assertEqual(result, sentinel, `${name}: Delegation erhält den Rückgabewert`);
            assertEqual(receiver, renderer, `${name}: Delegation nutzt dieselbe Rendererinstanz`);
            assert(args.every((value, index) => value === inputs[index]), `${name}: Argumente behalten Identität und Reihenfolge`);
        } finally {
            methods[name] = implementation;
        }
    }
}
