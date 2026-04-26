from weaviate.classes.config import Property, DataType, ReferenceProperty

def get_schema ():
    return {
        "name": "NewsSite",
        "properties": [
            Property(name="uuid", data_type=DataType.UUID),
            Property(name="domain", data_type=DataType.TEXT)
        ],
        "references": [
            ReferenceProperty(name="entity", target_collection="Entity"),
            ReferenceProperty(name="evidence", target_collection="Evidence"),
        ]
    }