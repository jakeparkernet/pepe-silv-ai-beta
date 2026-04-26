from weaviate.classes.config import Property, DataType, ReferenceProperty

def get_schema ():
    return {
        "name": "Article",
        "properties": [
            Property(name="uuid", data_type=DataType.UUID),
            Property(name="url", data_type=DataType.TEXT),
        ],
        "references": [
            ReferenceProperty(name="news_site", target_collection="NewsSite"),
            ReferenceProperty(name="entities", target_collection="Entity"),
            # TODO: Remove this property and create a function in the db adapter that finds them
            #  Query through graphql in weaviate to get is_ownership relationships for an entity
            #  and then recurse up the chain. More compute but always up to date.
            #  Conversely, consider adding a 'last-updated' property and then when an entity's
            #  ownership changes, query for all articles with that entity and update this field accordingly
            #  if it hasn't been updated prior to the change
            ReferenceProperty(name="conflicting_relationships", target_collection="Relationship"),
        ]
    }