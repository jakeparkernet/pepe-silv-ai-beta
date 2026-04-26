Full setup and Readme in progress.

The gist:
PepeSilv.AI finds common owners between news sites and the companies they write about, and displays the information in an interesting yet digeitable manner.

How it works:
Pepe looks at a url, determines if it's a news article, then if it is about a specific or prominently featured company or product, and then if it is, 
it recursively finds the parent companies of the article subject and the news site until it gets companies or organizations that are not product-producing (i.e. they just invest and do nothing else).

Setup:
- Server runs on python (design for fly.io but can can be adapted to anything)
- LLM and scrape calls happen via edge (lambda) to keep the server freed up
- Results write to supabase, which feeds into the website
- Weaviate is used to store Entities, Relationships, and Evidence, but will likely be removed soon since it's not being used for it's no longer needed
- Website is html, vanilla es6 js, and css. ThreeJS for 3D rendering and D3 for the sane view
