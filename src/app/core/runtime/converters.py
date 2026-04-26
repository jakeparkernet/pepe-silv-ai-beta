def serialize_entity (entity):

    evidence_ids = []

    return {
        id: entity.id,
        name: entity.name,
        evidence_ids: entity.evidence
    }