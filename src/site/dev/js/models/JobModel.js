import { diffObjects } from "../utils/objectUtils.js";
import { Node } from "../models/Node.js";
import { tryApplyDiff } from "../utils/objectUtils.js";

class JobModel {
    constructor(job) {
        this.onJobComplete = this.onJobComplete.bind(this);

        this.prevJobData = structuredClone(job);
        this.changes = {};

        this.childJobModels = new Map();

        this.applyJob(job);
    }

    addChildJobModel(jobModel) {
        this.childJobModels.set(jobModel.job.id, jobModel);
    }

    applyJob(job) {
        this.changes = diffObjects(this.prevJobData, job);

        this.job = job;

        if (job.status == "COMPLETE") {
            this.onJobComplete();
        }

        this.tryMarkDirty(
            tryApplyDiff(
                this.job,
                this.changes));

        this.prevJobData = structuredClone(job);
    }

    tryMarkDirty(isDirty) {
        if (isDirty) {
            this.isDirty = true;
        }
    }

    markClean () {
        this.isDirty = false;
    }

    onJobComplete() { }

    getJob() {
        return this.job;
    }

    getJobId() {
        return this.getJob().id;
    }

    getJobLabel() {
        return this.getJob().label;
    }

    getJobDescription() {
        return this.getJob().description;
    }

    getChanges() {
        return this.changes;
    }
}

export { JobModel };