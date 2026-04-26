from weaviate.classes.config import Property, DataType, ReferenceProperty

def get_schema ():
    return {
        "name": "Entity",
        "properties": [
            Property(name="uuid", data_type=DataType.UUID),
            Property(name="name", data_type=DataType.TEXT),
            Property(name="context", data_type=DataType.TEXT),
            Property(name="tags", data_type=DataType.TEXT_ARRAY),
            Property(name="aliases", data_type=DataType.TEXT_ARRAY),
            Property(name="type", data_type=DataType.TEXT, skip_vectorization=True, vectorize_property_name=False),
            Property(name="flatname", data_type=DataType.TEXT),
            Property(name="top_dog", data_type=DataType.BOOL)
        ],
        "references": [
            ReferenceProperty(name="evidence", target_collection="Evidence"),
        ]
    }