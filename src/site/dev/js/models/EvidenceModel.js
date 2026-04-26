class EvidenceModel {
    constructor (evidenceData) {
        this.id = evidenceData.id;
        this.excerpt = evidenceData.excerpt;
        this.source = evidenceData.source;
        this.date = evidenceData.date;
        this.raw = evidenceData;
    }
}

export { EvidenceModel };
