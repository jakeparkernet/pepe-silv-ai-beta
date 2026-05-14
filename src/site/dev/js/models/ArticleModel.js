// import { InvestigationModel } from "./InvestigationModel.js";
// import { OwnershipTreeModel } from "./OwnershipTreeModel.js";
// import { NewsSiteModel } from "./NewsSiteModel.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { InvestigationModel } = appModules.models.InvestigationModel;
const { OwnershipTreeModel } = appModules.models.OwnershipTreeModel;
const { NewsSiteModel } = appModules.models.NewsSiteModel;

class ArticleModel {
    constructor (articleData) {
        this.updateModel = this.updateModel.bind(this);

        this.updateModel(articleData);
    }

    updateModel (articleData) {
        this.id = articleData.id ?? articleData?.article?.id;
        this.url = articleData.url ?? articleData?.article?.url;
        this.status = articleData.status ?? articleData?.article?.status;
        this.mode = articleData.mode ?? articleData?.article?.mode ?? "article";
        this.subjectNodeLabel = this.mode === "company_pair" ? "Company A" : "Article subject";
        this.newsSiteNodeLabel = this.mode === "company_pair" ? "Company B" : "News site";
        this.subjectRelationLabel = this.mode === "company_pair" ? "compared with" : "wrote about";

        let investigationData = articleData?.ownershipTreeObj?.investigation_data;

        if (investigationData == null) {
            return;
        }

        this.investigationModel = new InvestigationModel(investigationData);
        this.articleSubject = window[`apps_${performance.timeOrigin}`].pepe.entities[investigationData.article_subject.id];
        this.newsSite = new NewsSiteModel(investigationData.news_site);
        this.topOwner = this.investigationModel.topOwner;
        
        let ownershipTree = articleData.ownership_tree;

        let newsSiteTreeData = this.getOwnershipTreeByTargetEntity(
            [ownershipTree.a_ownership_tree,
             ownershipTree.b_ownership_tree],
             this.newsSite.id
            );

        newsSiteTreeData.topOwner = this.topOwner;
        this.newsSiteTree = new OwnershipTreeModel(newsSiteTreeData);

        let subjectTreeData = this.getOwnershipTreeByTargetEntity(
            [ownershipTree.a_ownership_tree,
             ownershipTree.b_ownership_tree],
             this.articleSubject.id
            );

        subjectTreeData.topOwner = this.topOwner;
        this.subjectTree = new OwnershipTreeModel(subjectTreeData);
    }

    getOwnershipTreeByTargetEntity (ownershipTrees, targetEntityId) {
        for (let i = 0; i < ownershipTrees.length; i++) {
            if (ownershipTrees[i].target_entity.id == targetEntityId) {
                return ownershipTrees[i];
            }
        }
    }
}

export { ArticleModel };
