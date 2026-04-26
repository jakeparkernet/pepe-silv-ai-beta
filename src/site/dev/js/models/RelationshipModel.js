class RelationshipModel {
    constructor (relationshipData) {
        this.id = relationshipData.id;
        this.source = relationshipData.source;
        this.target = relationshipData.target;
        this.relation = relationshipData.relation;
        this.evidence = relationshipData.evidence
        this.type = relationshipData.type;
    }
}

export { RelationshipModel };