/** @import {GenerationId,WorkerEnvelope,WorkerPayload,WorkerJob,WorkerPoolOptions,WorkerJobOptions,WorkerFailure} from '../typcheck/rechenkern' */
"use strict";

import { WorkerTelemetry } from './worker-telemetry.js';

const MAX_REMEMBERED_CANCELLED_GENERATIONS = 32;

export class WorkerGenerationCancelledError extends Error {
    /** @param {GenerationId} generationId
 * @param {unknown} reason */
    constructor(generationId, reason = null) {
        const reasonMessage = reason instanceof Error ? reason.message : String(reason || '').trim();
        super(reasonMessage || `Worker generation ${String(generationId)} was cancelled.`);
        this.name = 'AbortError';
        this.code = 'WORKER_GENERATION_CANCELLED';
        this.generationId = generationId;
        if (reason instanceof Error && reason !== this) this.cause = reason;
    }
}

export class WorkerPoolDisposedError extends Error {
    constructor() {
        super('WorkerPool has been disposed.');
        this.name = 'WorkerPoolDisposedError';
        this.code = 'WORKER_POOL_DISPOSED';
    }
}

export class WorkerPool {
    /** @param {WorkerPoolOptions} options */
    constructor({ workerUrl, size = 1, type = 'module', onProgress = null, onError = null, telemetryName = 'default' } = {}) {
        if (!workerUrl) {
            throw new Error('WorkerPool requires workerUrl');
        }
        this.workerUrl = workerUrl;
        this.size = Math.max(1, Number(size) || 1);
        this.type = type;
        this.onProgress = typeof onProgress === 'function' ? onProgress : null;
        this.onError = typeof onError === 'function' ? onError : null;
        this.telemetry = new WorkerTelemetry(telemetryName);

        this.workers = /** @type {Worker[]} */ ([]);
        this.idle = /** @type {Worker[]} */ ([]);
        this.queue = /** @type {WorkerJob[]} */ ([]);
        this.jobs = /** @type {Map<number,Pick<WorkerJob,"resolve"|"reject"|"generationId"> & {worker:Worker}>} */ (new Map());
        this.nextJobId = 1;
        this.workerIds = new Map();
        this.nextWorkerId = 1;
        this.workerReady = new WeakMap();
        this.retiredWorkers = new WeakSet();
        this.poolDisabled = false;
        this.poolFailureReason = /** @type {Error|null} */ (null);
        this.disposed = false;
        this.consecutiveBootstrapFailures = 0;
        this.maxBootstrapFailures = Math.max(3, this.size * 2);
        this.cancelledGenerations = /** @type {Set<GenerationId>} */ (new Set());
        this.generationCancelPromises = /** @type {Map<GenerationId,Promise<{generationId:GenerationId;activeJobs:number;queuedJobs:number;terminatedWorkers:number}>>} */ (new Map());

        this._initWorkers();
    }

    _initWorkers() {
        while (this.workers.length < this.size) {
            const worker = this._createWorker();
            this.workers.push(worker);
            this.idle.push(worker);
        }
        this._syncTelemetryWorkerCount();
    }

    _syncTelemetryWorkerCount() {
        if (this.telemetry) this.telemetry.workerCount = this.workers.length;
    }

    ensureCapacity() {
        if (this.disposed) throw new WorkerPoolDisposedError();
        if (this.poolDisabled) throw this._getPoolDisabledError();
        this._initWorkers();
        this._drainQueue();
        return this.workers.length;
    }

    _createWorker() {
        const worker = new Worker(this.workerUrl, { type: this.type });
        worker.onmessage = event => this._handleMessage(worker, event.data);
        worker.onerror = error => this._handleError(worker, error);
        const workerId = `worker-${this.nextWorkerId++}`;
        this.workerIds.set(worker, workerId);
        this.workerReady.set(worker, false);
        return worker;
    }


    /** @param {Worker} worker */
    _isLiveWorker(worker) {
        return !this.retiredWorkers.has(worker) && this.workers.includes(worker);
    }


    /** @param {unknown} error */
    _formatErrorMessage(error) {
        if (!error) return 'Unknown worker error';
        if (error instanceof Error) return /** @type {Partial<WorkerFailure>} */ (error).message || String(error);
        const message = (typeof /** @type {Partial<WorkerFailure>} */ (error).message === 'string' && /** @type {Partial<WorkerFailure>} */ (error).message.trim()) ? /** @type {Partial<WorkerFailure>} */ (error).message.trim() : '';
        const filename = typeof /** @type {Partial<WorkerFailure>} */ (error).filename === 'string' ? /** @type {Partial<WorkerFailure>} */ (error).filename : '';
        const lineno = Number.isFinite(/** @type {Partial<WorkerFailure>} */ (error).lineno) && /** @type {Partial<WorkerFailure>} */ (error).lineno > 0 ? /** @type {Partial<WorkerFailure>} */ (error).lineno : null;
        const colno = Number.isFinite(/** @type {Partial<WorkerFailure>} */ (error).colno) && /** @type {Partial<WorkerFailure>} */ (error).colno > 0 ? /** @type {Partial<WorkerFailure>} */ (error).colno : null;
        const location = filename
            ? `${filename}${lineno ? `:${lineno}` : ''}${colno ? `:${colno}` : ''}`
            : '';
        if (message && location) return `${message} @ ${location}`;
        if (message) return message;
        if (location) return `Worker script error @ ${location}`;
        return String(error);
    }

    /** @param {unknown} error
 * @param {Worker} worker */
    _toError(error, worker) {
        if (error instanceof Error) {
            return error;
        }
        const workerId = this._getWorkerId(worker);
        const msg = this._formatErrorMessage(error);
        const normalized = /** @type {WorkerFailure} */ (new Error(`[WorkerPool:${workerId}] ${msg}`));
        if (error && typeof error === 'object') {
            if (typeof /** @type {Partial<WorkerFailure>} */ (error).filename === 'string') normalized.filename = /** @type {Partial<WorkerFailure>} */ (error).filename;
            if (Number.isFinite(/** @type {Partial<WorkerFailure>} */ (error).lineno)) normalized.lineno = /** @type {Partial<WorkerFailure>} */ (error).lineno;
            if (Number.isFinite(/** @type {Partial<WorkerFailure>} */ (error).colno)) normalized.colno = /** @type {Partial<WorkerFailure>} */ (error).colno;
        }
        return normalized;
    }


    /** @param {Error} reason */
    _disablePool(reason) {
        if (this.poolDisabled) return;
        this.poolDisabled = true;
        this.poolFailureReason = reason instanceof Error ? reason : new Error(String(reason));
        this._rejectAllJobs(this.poolFailureReason, 'pool-disabled');
        for (const worker of [...this.workers]) {
            this._retireWorker(worker, this.poolFailureReason);
        }
        this.workers = [];
        this.idle = [];
        this.workerIds.clear();
        this._syncTelemetryWorkerCount();
    }

    _getPoolDisabledError() {
        if (this.poolFailureReason instanceof Error) {
            return this.poolFailureReason;
        }
        return new Error('WorkerPool disabled due to repeated worker bootstrap failures.');
    }

    /** @param {Worker} worker */
    _getWorkerId(worker) {
        return this.workerIds.get(worker) || 'unknown';
    }

    /** @param {number} jobId
 * @param {string} workerId
 * @param {Error} error */
    _recordJobFailure(jobId, workerId, error) {
        this.telemetry?.recordJobFailed(jobId, workerId, error);
    }


    /** @param {Error} error */
    _rejectAllJobs(error, workerId = 'pool') {
        for (const [jobId, job] of [...this.jobs.entries()]) {
            this.jobs.delete(jobId);
            this._recordJobFailure(jobId, workerId, error);
            job.reject(error);
        }
        while (this.queue.length > 0) {
            const job = this.queue.shift();
            if (!job) continue;
            this._recordJobFailure(job.jobId, workerId, error);
            job.reject(error);
        }
    }

    /** @param {Worker} worker
 * @param {Error} error */
    _rejectJobsForWorker(worker, error) {
        const workerId = this._getWorkerId(worker);
        for (const [jobId, job] of [...this.jobs.entries()]) {
            if (job.worker !== worker) continue;
            this.jobs.delete(jobId);
            this._recordJobFailure(jobId, workerId, error);
            job.reject(error);
        }
    }


    /** @param {Worker} worker
 * @param {Error|null} error */
    _retireWorker(worker, error = null) {
        if (!worker || this.retiredWorkers.has(worker)) return false;
        this.retiredWorkers.add(worker);
        if (error) this._rejectJobsForWorker(worker, error);
        const index = this.workers.indexOf(worker);
        if (index !== -1) this.workers.splice(index, 1);
        this.idle = this.idle.filter(item => item !== worker);
        this.workerIds.delete(worker);
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        this._syncTelemetryWorkerCount();
        return index !== -1;
    }

    /** @param {Pick<WorkerJob,"generationId">} job
 * @param {WorkerEnvelope} message */
    _messageMatchesGeneration(job, message) {
        if (job.generationId == null) return true;
        return message?.generationId === job.generationId;
    }

    /** @param {Worker} worker
 * @param {WorkerEnvelope} message */
    _handleMessage(worker, message) {
        if (!this._isLiveWorker(worker) || !message || typeof message !== 'object') return;
        const jobId = message.jobId;
        if (!jobId) return;

        const job = this.jobs.get(jobId);
        if (!job || job.worker !== worker) return;
        if (!this._messageMatchesGeneration(job, message)) {
            this._handleError(worker, new Error(
                `Worker generation mismatch for job ${String(jobId)}: expected ${String(job.generationId)}, received ${String(message.generationId)}.`
            ));
            return;
        }

        this.workerReady.set(worker, true);
        this.consecutiveBootstrapFailures = 0;

        if (message.type === 'progress') {
            this.onProgress?.(message);
            return;
        }

        this.jobs.delete(jobId);

        let hasMoreJobs = false;
        for (const activeJob of this.jobs.values()) {
            if (activeJob.worker === worker) {
                hasMoreJobs = true;
                break;
            }
        }

        if (!hasMoreJobs && !this.idle.includes(worker)) {
            this.idle.push(worker);
        }

        this._drainQueue();

        if (message.type === 'error') {
            const err = new Error(message.message || 'Worker error');
            err.stack = message.stack || err.stack;
            this._recordJobFailure(jobId, this._getWorkerId(worker), err);
            job.reject(err);
            return;
        }

        this.telemetry?.recordJobComplete(jobId, this._getWorkerId(worker), message.elapsedMs);
        job.resolve(message);
    }


    /** @param {Worker} worker
 * @param {unknown} error */
    _handleError(worker, error) {
        if (!this._isLiveWorker(worker)) return;
        const normalizedError = this._toError(error, worker);
        const isBootstrapFailure = this.workerReady.get(worker) !== true;
        if (isBootstrapFailure) {
            this.consecutiveBootstrapFailures += 1;
        } else {
            this.consecutiveBootstrapFailures = 0;
        }
        this.onError?.(normalizedError);
        this._retireWorker(worker, normalizedError);

        if (isBootstrapFailure && this.consecutiveBootstrapFailures >= this.maxBootstrapFailures) {
            const message = [
                'WorkerPool disabled after repeated bootstrap failures.',
                `workerUrl=${String(this.workerUrl)}`,
                `failures=${this.consecutiveBootstrapFailures}`,
                `lastError=${this._formatErrorMessage(normalizedError)}`
            ].join(' ');
            this._disablePool(new Error(message));
            return;
        }
        if (this.poolDisabled || this.disposed) return;

        // Runtime/bootstrap errors retain the historical immediate replacement policy.
        // User cancellation uses cancelGeneration() and deliberately skips this path.
        const replacement = this._createWorker();
        this.workers.push(replacement);
        this.idle.push(replacement);
        this._syncTelemetryWorkerCount();
        this._drainQueue();
    }

    _drainQueue() {
        if (this.disposed || this.poolDisabled) {
            const error = this.disposed ? new WorkerPoolDisposedError() : this._getPoolDisabledError();
            while (this.queue.length > 0) {
                const job = this.queue.shift();
                if (!job) continue;
                this._recordJobFailure(job.jobId, this.disposed ? 'pool-disposed' : 'pool-disabled', error);
                job.reject(error);
            }
            return;
        }
        while (this.idle.length > 0 && this.queue.length > 0) {
            const worker = /** @type {Worker} */ (this.idle.pop());
            const job = /** @type {WorkerJob} */ (this.queue.shift());
            if (this.cancelledGenerations.has(job.generationId)) {
                const error = new WorkerGenerationCancelledError(job.generationId);
                this._recordJobFailure(job.jobId, 'cancelled', error);
                job.reject(error);
                continue;
            }
            this.jobs.set(job.jobId, { ...job, worker });
            this.telemetry?.recordJobStart(job.jobId, this._getWorkerId(worker), job.payload);
            try {
                worker.postMessage(job.payload, job.transferables);
            } catch (postMessageError) {
                this._handleError(worker, postMessageError);
            }
        }
    }

    /** @param {WorkerPayload} payload
 * @param {WorkerJobOptions} options */
    _resolveGeneration(payload, options) {
        const generationId = options?.generationId ?? payload?.generationId ?? null;
        return generationId == null ? null : generationId;
    }


    /** @param {GenerationId} generationId */
    _assertCanSchedule(generationId) {
        if (this.disposed) throw new WorkerPoolDisposedError();
        if (this.poolDisabled) throw this._getPoolDisabledError();
        if (generationId != null && this.cancelledGenerations.has(generationId)) {
            throw new WorkerGenerationCancelledError(generationId);
        }
    }

    /** @param {WorkerPayload} payload
 * @param {Transferable[]} transferables
 * @param {WorkerJobOptions} options
 * @returns {Promise<WorkerEnvelope>} */
    runJob(payload, transferables = [], options = {}) {
        const generationId = this._resolveGeneration(payload, options);
        try {
            this._assertCanSchedule(generationId);
            this.ensureCapacity();
        } catch (error) {
            return Promise.reject(error);
        }
        const jobId = this.nextJobId++;
        const message = generationId == null
            ? { ...payload, jobId }
            : { ...payload, jobId, generationId };
        this.telemetry?.recordJobStart(jobId, 'pending', message);
        return new Promise((resolve, reject) => {
            this.queue.push({ jobId, payload: message, transferables, resolve, reject, generationId });
            this._drainQueue();
        });
    }

    /** @param {WorkerPayload} payload
 * @param {Transferable[]} transferables
 * @param {WorkerJobOptions} options */
    async broadcast(payload, transferables = [], options = {}) {
        const generationId = this._resolveGeneration(payload, options);
        this._assertCanSchedule(generationId);
        this.ensureCapacity();
        const responses = [];
        for (const worker of [...this.workers]) {
            responses.push(this._sendDirect(worker, payload, transferables, { generationId }));
        }
        return Promise.all(responses);
    }

    /** @param {Worker} worker
 * @param {WorkerPayload} payload
 * @param {Transferable[]} transferables
 * @param {WorkerJobOptions} options
 * @returns {Promise<WorkerEnvelope>} */
    _sendDirect(worker, payload, transferables = [], options = {}) {
        const generationId = this._resolveGeneration(payload, options);
        try {
            this._assertCanSchedule(generationId);
            if (!this._isLiveWorker(worker)) throw new Error('Cannot send to a retired worker.');
        } catch (error) {
            return Promise.reject(error);
        }
        const jobId = this.nextJobId++;
        const message = generationId == null
            ? { ...payload, jobId }
            : { ...payload, jobId, generationId };
        return new Promise((resolve, reject) => {
            this.jobs.set(jobId, { resolve, reject, worker, generationId });
            const idleIndex = this.idle.indexOf(worker);
            if (idleIndex !== -1) this.idle.splice(idleIndex, 1);
            this.telemetry?.recordJobStart(jobId, this._getWorkerId(worker), message);
            try {
                worker.postMessage(message, transferables);
            } catch (postMessageError) {
                this.jobs.delete(jobId);
                const normalizedError = this._toError(postMessageError, worker);
                reject(normalizedError);
                this._handleError(worker, normalizedError);
            }
        });
    }


    /** @param {GenerationId} generationId
 * @param {unknown} reason */
    cancelGeneration(generationId, reason = null) {
        if (generationId == null || String(generationId).trim() === '') {
            return Promise.reject(new Error('cancelGeneration requires a non-empty generationId.'));
        }
        const existing = this.generationCancelPromises.get(generationId);
        if (existing) return existing;

        const error = reason instanceof Error
            ? reason
            : new WorkerGenerationCancelledError(generationId, reason);
        this.cancelledGenerations.add(generationId);

        let queuedJobs = 0;
        this.queue = this.queue.filter(job => {
            if (job.generationId !== generationId) return true;
            queuedJobs += 1;
            this._recordJobFailure(job.jobId, 'cancelled', error);
            job.reject(error);
            return false;
        });

        const workersToTerminate = new Set();
        let activeJobs = 0;
        for (const [jobId, job] of [...this.jobs.entries()]) {
            if (job.generationId !== generationId) continue;
            activeJobs += 1;
            this.jobs.delete(jobId);
            workersToTerminate.add(job.worker);
            this._recordJobFailure(jobId, this._getWorkerId(job.worker), error);
            job.reject(error);
        }
        for (const worker of workersToTerminate) {
            this._retireWorker(worker, error);
        }
        this._drainQueue();

        const result = Promise.resolve({
            generationId,
            activeJobs,
            queuedJobs,
            terminatedWorkers: workersToTerminate.size
        });
        this.generationCancelPromises.set(generationId, result);
        while (this.generationCancelPromises.size > MAX_REMEMBERED_CANCELLED_GENERATIONS) {
            const oldest = /** @type {GenerationId} */ (this.generationCancelPromises.keys().next().value);
            this.generationCancelPromises.delete(oldest);
            this.cancelledGenerations.delete(oldest);
        }
        return result;
    }

    dispose() {
        if (this.disposed) return false;
        this.disposed = true;
        this.poolDisabled = true;
        const error = new WorkerPoolDisposedError();
        this._rejectAllJobs(error, 'pool-disposed');
        for (const worker of [...this.workers]) {
            this._retireWorker(worker, error);
        }
        this.workers = [];
        this.idle = [];
        this.queue = [];
        this.jobs.clear();
        this.workerIds.clear();
        this._syncTelemetryWorkerCount();
        this.telemetry?.printReport();
        return true;
    }
}
