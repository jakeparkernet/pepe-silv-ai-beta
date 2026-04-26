from weaviate.classes.config import Property, DataType, ReferenceProperty

def get_schema ():
    return {
        "name": "Evidence",
        "properties": [
            Property(name="uuid", data_type=DataType.UUID),
            Property(name="excerpt", data_type=DataType.TEXT),
            Property(name="source", data_type=DataType.TEXT, skip_vectorization=True, vectorize_property_name=False),
            Property(name="date", data_type=DataType.DATE, skip_vectorization=True, vectorize_property_name=False),
        ],
    }