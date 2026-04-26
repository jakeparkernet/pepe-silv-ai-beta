class RefinedResultsModel {
    constructor (output) {
        
        this.results = [];
        
        let pageResults = output.links;
        for (let i = 0; i < pageResults.length; i++) {
            this.results.push({
                url: pageResults[i],
                title: "",
                description: ""
            });
        }
    }
}

export { RefinedResultsModel };