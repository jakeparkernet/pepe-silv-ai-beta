class OwnershipTreeModel {

    constructor (ownershipTree) {
        this.ownershipTree = ownershipTree;
        this.ownerEntities = this.ownershipTree.owner_entities;
        this.topOwner = ownershipTree.topOwner;
        this.targetEntity = ownershipTree.target_entity;
        this.relationships = ownershipTree.relationships;
    }

    getOwnerRelationshipModel (targetEntityId) {
        for (const [id, relationship] of Object.entries(this.ownershipTree.relationships)) {
            if (relationship.target_entity_id == targetEntityId) {
                return window[`apps_${performance.timeOrigin}`].pepe.relationships[id];
            }
        }

        return null;
    }

    getOwnershipChain () {
        const chain = [];

        if (!this.topOwner || !this.topOwner.id) {
            return [{ entity: this.targetEntity, relationship: null }];
        }

        if (this.topOwner.id === this.targetEntity.id) {
            return [{ entity: this.topOwner, relationship: null }];
        }

        chain.push({ entity: this.topOwner, relationship: null });

        let currentEntityId = this.topOwner.id;
        const visited = new Set([currentEntityId]);

        while (true) {
            const rel = this.findOwnershipRelationshipBySource(currentEntityId);
            if (rel) {
                let nextEntity;
                if (this.targetEntity && rel.target_entity_id === this.targetEntity.id) {
                    nextEntity = this.targetEntity;
                } else {
                    nextEntity = this.ownerEntities[rel.target_entity_id];
                }
                if (!nextEntity) {
                    break;
                }
                chain.push({ entity: nextEntity, relationship: rel });
                visited.add(rel.target_entity_id);
                currentEntityId = rel.target_entity_id;

                if (this.targetEntity && this.targetEntity.id === currentEntityId) {
                    break;
                }
            } else {
                break;
            }
        }
        
        const lastItem = chain[chain.length - 1];
        if (this.targetEntity && (!lastItem || lastItem.entity.id !== this.targetEntity.id)) {
            const lastRel = this.findOwnershipRelationshipBySource(lastItem?.entity.id);
            chain.push({ entity: this.targetEntity, relationship: lastRel });
        }
        
        return chain;
    }

    findOwnershipRelationship (targetEntityId) {
        for (const [id, rel] of Object.entries(this.relationships)) {
            if (rel.target_entity_id === targetEntityId) {
                return rel;
            }
        }
        return null;
    }

    findOwnershipRelationshipBySource (sourceEntityId) {
        for (const [id, rel] of Object.entries(this.relationships)) {
            if (rel.source_entity_id === sourceEntityId) {
                return rel;
            }
        }
        return null;
    }

    getEntityById(entityId) {
        if (entityId == null) {
            return null;
        }

        if (this.targetEntity?.id === entityId) {
            return this.targetEntity;
        }

        if (this.topOwner?.id === entityId) {
            return this.topOwner;
        }

        return this.ownerEntities?.[entityId]
            ?? window[`apps_${performance.timeOrigin}`]?.pepe?.entities?.[entityId]
            ?? null;
    }

    getParentRelationships(targetEntityId) {
        const relationships = [];

        for (const [id, relationship] of Object.entries(this.relationships ?? {})) {
            if (relationship.target_entity_id !== targetEntityId) {
                continue;
            }

            relationships.push(
                window[`apps_${performance.timeOrigin}`]?.pepe?.relationships?.[id]
                ?? relationship
            );
        }

        return relationships;
    }

    getUpwardOwnershipGraph() {
        const targetId = this.targetEntity?.id;
        if (targetId == null) {
            return { levels: [], edges: [] };
        }

        const levels = [[targetId]];
        const edges = [];
        const visited = new Set([targetId]);
        let currentLevelIds = [targetId];

        while (currentLevelIds.length > 0) {
            const nextLevelIds = [];
            const nextLevelSeen = new Set();

            for (let i = 0; i < currentLevelIds.length; i++) {
                const childId = currentLevelIds[i];
                const parentRelationships = this.getParentRelationships(childId);

                for (let j = 0; j < parentRelationships.length; j++) {
                    const relationship = parentRelationships[j];
                    const sourceId = relationship?.source ?? relationship?.source_entity_id;
                    const targetIdForRelationship = relationship?.target ?? relationship?.target_entity_id ?? childId;
                    const parentEntity = this.getEntityById(sourceId);

                    if (sourceId == null || parentEntity == null) {
                        continue;
                    }

                    edges.push({
                        sourceId,
                        targetId: targetIdForRelationship,
                        relationship
                    });

                    if (visited.has(sourceId) || nextLevelSeen.has(sourceId)) {
                        continue;
                    }

                    nextLevelSeen.add(sourceId);
                    nextLevelIds.push(sourceId);
                }
            }

            if (nextLevelIds.length === 0) {
                break;
            }

            for (let i = 0; i < nextLevelIds.length; i++) {
                visited.add(nextLevelIds[i]);
            }

            levels.push(nextLevelIds);
            currentLevelIds = nextLevelIds;
        }

        return { levels, edges };
    }
}

export { OwnershipTreeModel };
