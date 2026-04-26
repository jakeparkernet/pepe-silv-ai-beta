import { EntityModel } from "./EntityModel.js";

class NewsSiteModel extends EntityModel {
    constructor (newsSiteData) {
        super(newsSiteData);
        this.domain = newsSiteData.domain;
    }
}

export { NewsSiteModel };