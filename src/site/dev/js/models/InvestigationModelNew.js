import { EntityModel } from "./EntityModel.js";
import { RelationshipModel } from "./RelationshipModel.js";
import { EvidenceModel } from "./EvidenceModel.js";
import { NewsSiteModel } from "./NewsSiteModel.js";
import { ArticleModel } from "./ArticleModel.js";

class InvestigationModelNew {
    constructor (investigationData) {
        this.id = investigationData.id;
        
        this.evidence = new Map();
        investigationData.evidence.forEach((evidenceData) => {
            this.evidence.set(evidenceData.id, new EvidenceModel(evidenceData));
        });

        let hydratedNewsSiteData = {
            id: investigationData.newsSite.id,
            domain: investigationData.newsSite.domain,
            name: investigationData.newsSite.name,
            aliases: investigationData.newsSite.aliases,
            relationships: []
        };
        this.newsSite = new NewsSiteModel(hydratedNewsSiteData);

        this.entities = new Map();
        investigationData.entities.forEach((entityData) => {
            this.entities.set(entityData.id, new EntityModel(entityData));
        });

        this.entities.set(this.newsSite.id, this.newsSite);

        this.topOwner = this.entities.get(investigationData.topOwner);

        this.relationships = new Map();
        investigationData.relationships.forEach((relationshipData) => {
            let hydratedRelationshipData = {
                id: relationshipData.id,
                source: this.entities.get(relationshipData.source_entity),
                target: this.entities.get(relationshipData.target_entity),
                relation: relationshipData.relation,
                type: relationshipData.type,
                evidence: []
            };

            relationshipData.evidence.forEach((id) => {
                hydratedRelationshipData.evidence.push(
                    this.evidence.get(id)
                );
            });

            this.relationships.set(relationshipData.id, new RelationshipModel(hydratedRelationshipData));
        });

        this.entities.forEach((entityModel, id) => {
            for (let i = 0; i < entityModel.relationships.length; i++) {
                entityModel.relationships[i] = this.relationships.get(
                    entityModel.relationships[i]
                )
            };
        });

        this.subjectRelationships = [];
        investigationData.subjectRelationships.forEach((id) => {
            this.subjectRelationships.push(
                this.relationships.get(id)
            );
        });

        this.newsSiteRelationships = [];
        investigationData.newsSiteRelationships.forEach((id) => {
            this.newsSiteRelationships.push(
                this.relationships.get(id)
            );
        });

        let hydratedArticleData = {
            id: investigationData.article.id,
            url: investigationData.article.url,
            subjects: [],
            newsSite: this.newsSite
        };
        investigationData.article.subjects.forEach((id) => {
            hydratedArticleData.subjects.push(
                this.entities.get(id)
            );
        });

        this.article = new ArticleModel(hydratedArticleData);
    }
}

export { InvestigationModelNew };