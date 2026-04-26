class EntityModel {
    constructor (entityData) {
        this.id = entityData.id;
        this.created_at = entityData.created_at;
        this.name = entityData.name;
        this.aliases = entityData.aliases;
        this.tags = entityData.tags;
        this.type = entityData.type;
        this.entity_type = entityData.entity_type;
        this.relationships = entityData.relationships;
        this.evidence = entityData.evidence;
        this.notes = entityData.notes;
        this.status = entityData.status;
        this.context = entityData.context;
        this.metadata = entityData.metadata;
        this.flatname = entityData.flatname;
        this.top_dog = entityData.top_dog;
    }
}

export { EntityModel };
