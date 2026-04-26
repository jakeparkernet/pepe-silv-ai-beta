from weaviate.classes.config import Property, DataType, ReferenceProperty

def get_schema ():
    return {
        "name": "KeyValue",
        "properties": [
            Property(name="name", data_type=DataType.TEXT),
            Property(name="value", data_type=DataType.TEXT),
        ]
    }