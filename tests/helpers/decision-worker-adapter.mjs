// Browser-Worker-Vertrag auf echten Node-Threads für Vergleichstests/Messungen.
import { Worker as Thread } from 'node:worker_threads';
import { serialize } from 'node:v8';
export class DecisionNodeWorker {
    static instances = [];
    static sentBytes = 0;
    static receivedBytes = 0;
    constructor(url) {
        this.terminated = false;
        DecisionNodeWorker.instances.push(this);
        const source = `import { parentPort } from 'node:worker_threads';
            const pending = [];
            globalThis.self = { postMessage: value => parentPort.postMessage(value) };
            parentPort.on('message', data => self.onmessage ? self.onmessage({ data }) : pending.push(data));
            await import(${JSON.stringify(url.href)});
            for (const data of pending) self.onmessage({ data });`;
        this.thread = new Thread(new URL(`data:text/javascript,${encodeURIComponent(source)}`));
        this.thread.on('message', data => {
            DecisionNodeWorker.receivedBytes += serialize(data).byteLength;
            this.onmessage?.({ data });
        });
        this.thread.on('error', error => this.onerror?.(error));
    }
    postMessage(data) {
        DecisionNodeWorker.sentBytes += serialize(data).byteLength;
        this.thread.postMessage(data);
    }
    terminate() { this.terminated = true; return this.thread.terminate(); }
}
