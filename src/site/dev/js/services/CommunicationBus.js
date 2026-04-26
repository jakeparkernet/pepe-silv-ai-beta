import { Events } from "../utils/Events.js";

class CommunicationBus {
    constructor() {
        this.subscribeOnComplete = this.subscribeOnComplete.bind(this);

        this.baseUrl = "http://0.0.0.0:8080"
        this.sessionId = "sess_" + crypto.randomUUID();

        this.knownJobIds = new Set();
        this.interest = new Set();
        this.cacheUpdatedAt = {};

        this.pollIntervalMs = 1000;
        this.highInterestIntervalMs = 1000;
        this._pollTimer = null;
        this._polling = false;

        this.events = new Events();

        this._listeners = new Map();
        this.jobUpdates = [];
        this.completeListeners = {};

        this.startPolling();
    }

    static getInstance() {
        if (CommunicationBus.instance == null) {
            CommunicationBus.instance = new CommunicationBus();
        }

        return CommunicationBus.instance;
    }
    
    async healthCheck() {
        const url = new URL(`${this.baseUrl}/api/health`);

        try {
            const res = await fetch(url.toString(), { method: "GET" });

            if (!res.ok) {
                const text = await res.text().catch(() => "");
                const error = new Error(`healthCheck failed: ${res.status} ${res.statusText}`);
                throw error;
            }

            const data = await res.json();
            return data;
        }
        catch (exception) {
            console.log(exception);
            throw exception;
        }
    }

    getSessionId() {
        return this.sessionId;
    }

    watchJob(jobId) {
        let isNew = this.interest.has(jobId) === false;
        this.interest.add(jobId);

        return isNew
    }

    unwatchJob(jobId) {
        this.interest.delete(jobId);
    }

    enqueueJob(jobSpec, onComplete = null) {
        return new Promise(async (resolve, reject) => {
            const res = await fetch(`${this.baseUrl}/api/enqueue`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    ...jobSpec,
                }),
            });

            if (!res.ok) {
                const text = await res.text().catch(() => "");
                const error = new Error(`enqueueJob failed: ${res.status} ${res.statusText}`);
                error.responseText = text;
                this.events.fire("error", error);
                reject(error);
            }

            const data = await res.json();
            if (data && data.job) {

                if (onComplete) {
                    this.subscribeOnComplete(data.job.id, onComplete);
                }

                this.knownJobIds.add(data.id);
                if (this.watchJob(data.id)) {
                    this.fireJobUpdatedSafe(data.job.id, data);
                }
            }

            resolve(data);
        });
    }

    subscribeOnComplete (jobId, onComplete) {
        if (this.completeListeners[jobId] == null) {
            this.completeListeners[jobId] = [];
        }
        
        this.completeListeners[jobId].push(onComplete);
    }

    async fetchSessionJobs() {
        const url = new URL(`${this.baseUrl}/api/get-session-jobs`);
        url.searchParams.set("session_id", this.sessionId);

        const res = await fetch(url.toString(), { method: "GET" });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const error = new Error(`fetchSessionJobs failed: ${res.status} ${res.statusText}`);
            error.responseText = text;
            this.events.fire("error", error);
            throw error;
        }

        const data = await res.json();
        this.events.fire("session-jobs-found", data);

        return data;
    }

    async fetchJobsBatch(jobIds) {
        if (!jobIds || jobIds.length === 0) {
            return { jobs: [] };
        }

        const res = await fetch(`${this.baseUrl}/api/jobs/batch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ids: jobIds,
                if_changed_since: this.cacheUpdatedAt,
            }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const error = new Error(`fetchJobsBatch failed: ${res.status} ${res.statusText}`);
            error.responseText = text;
            this.events.fire("error", error);
            throw error;
        }

        const data = await res.json();

        if (Array.isArray(data.jobs)) {
            for (const job of data.jobs) {
                const job_id = job.id;
                this.cacheUpdatedAt[job_id] = job.updated_at || now();
                this.knownJobIds.add(job_id);

                this.fireJobUpdatedSafe(job_id, job);

                if (job.status === "COMPLETE") {
                    this.unwatchJob(job_id);

                    this.events.fire("on-complete", job);

                    if (this.completeListeners[job.id]) {
                        for (let i = 0; i < this.completeListeners[job.id].length; i++) {
                            this.completeListeners[job.id][i](job);
                        }
                    }
                }
            }
        }

        return data;
    }

    startPolling() {
        if (this._polling) return;
        this._polling = true;
        this._scheduleNextPoll(0);
    }

    stopPolling() {
        this._polling = false;
        if (this._pollTimer !== null) {
            clearTimeout(this._pollTimer);
            this._pollTimer = null;
        }
    }

    _scheduleNextPoll(delayMs) {
        if (!this._polling) return;
        if (this._pollTimer !== null) {
            clearTimeout(this._pollTimer);
        }

        this._pollTimer = setTimeout(() => this._pollLoop(), delayMs);
    }

    fireJobUpdatedSafe (job_id, job) {
        for (let i = 0; i < this.jobUpdates.length; i++) {
            if (this.jobUpdates[i].job_id == job_id &&
                this.jobUpdates[i].job.updated_at == job.updated_at) {
                    return;
                }
        }

        this.jobUpdates.push({
            job_id,
            job
        });

        this.events.fire("job-updated", { job_id: job_id, job: job });
    }

    async _pollLoop() {
        if (!this._polling) return;

        try {
            const sessionData = await this.fetchSessionJobs();

            for (const [job_id, job] of Object.entries(sessionData.result.job_ids)) {
                if (!this.knownJobIds.has(job_id)) {
                    this.knownJobIds.add(job_id);
                }
                if (this.watchJob(job_id)) {
                    if (job.id == null) {
                        job.id = job_id;
                    }
                    
                    this.fireJobUpdatedSafe(job_id, job);
                }
            }

            const jobIds = Array.from(this.interest);
            if (jobIds.length > 0) {

                if (this.fetchCount == null) {
                    this.fetchCount = 0;
                }

                let dataFrame = await this.fetchJobsBatch(jobIds);
                if (dataFrame.jobs.length > 0) {
                    console.log("------" + this.fetchCount);
                    this.fetchCount++;
                }
            }

            const hasInterest = this.interest.size > 0;
            const base = hasInterest ? this.highInterestIntervalMs : this.pollIntervalMs;
            const jitter = 0;// Math.random() * 0.3 * base;
            this._scheduleNextPoll(base + jitter);
        } catch (err) {
            console.error(err);
            this.events.fire("error", err);
            //this._scheduleNextPoll(this.pollIntervalMs * 2);
        }
    }
}

export { CommunicationBus };
