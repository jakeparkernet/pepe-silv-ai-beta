class SearchResultsModel {
    constructor (output) {
        this.results = [];
        
        let pageResults = output.pages[0].web.results;
        for (let i = 0; i < pageResults.length; i++) {
            this.results.push({
                url: pageResults[i].url,
                title: pageResults[i].title,
                description: pageResults[i].description
            });
        }
    }
}

export { SearchResultsModel };