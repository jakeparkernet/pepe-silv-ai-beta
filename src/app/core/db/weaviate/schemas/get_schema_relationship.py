from weaviate.classes.config import Property, DataType, ReferenceProperty

def get_schema ():     
    return {
        "name": "Relationship",
        "properties": [
            Property(name="uuid", data_type=DataType.UUID),
            Property(name="relation", data_type=DataType.TEXT),
            Property(name="is_ownership", data_type=DataType.BOOL)
        ],
        "references": [
            ReferenceProperty(name="source_entity", target_collection="Entity"),
            ReferenceProperty(name="target_entity", target_collection="Entity"),
            ReferenceProperty(name="evidence", target_collection="Evidence"),
        ]
    }