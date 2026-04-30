import { EntityModel } from "./EntityModel.js";

class InvestigationModel {
    constructor(investigationData) {
        this.updateModel = this.updateModel.bind(this);
        this.updateModel(investigationData);
    }

    updateModel (investigationData) {
        this.commonOwnerResults = investigationData?.common_owner_results ?? {};
        const commonOwners = this.commonOwnerResults?.common_owners ?? {};

        this.commonOwnerEntities = new Map();

        for (const [key, value] of Object.entries(commonOwners)) {
            let entityModel = new EntityModel(value);
            this.commonOwnerEntities.set(entityModel.id, entityModel);
        }
        
        if (investigationData.top_owner) {
            this.topOwner = new EntityModel(investigationData.top_owner);
        }
    }
}

export { InvestigationModel };
