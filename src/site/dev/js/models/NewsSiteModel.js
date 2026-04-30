// import { EntityModel } from "./EntityModel.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { EntityModel } = appModules.models.EntityModel;

class NewsSiteModel extends EntityModel {
    constructor (newsSiteData) {
        super(newsSiteData);
        this.domain = newsSiteData.domain;
    }
}

export { NewsSiteModel };