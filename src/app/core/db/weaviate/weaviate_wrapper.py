from __future__ import annotations

from datetime import datetime, timezone, timedelta, time, date
from dotenv import load_dotenv
import os
import json
import re
import sys
import weaviate
from weaviate.classes.query import QueryReference
from weaviate.classes.config import Property, DataType, ReferenceProperty, Configure
from weaviate.classes.init import Auth, AdditionalConfig, Timeout
import importlib
import atexit
import importlib.util
import asyncio
from typing import Any, Dict, List, Optional, Tuple, Mapping, MutableMapping

load_dotenv()

URL: Optional[str] = os.getenv("WEAVIATE_URL")
APIKEY: Optional[str] = os.getenv("WEAVIATE_APIKEY")
OPENAI_APIKEY: Optional[str] = os.getenv("OPENAI_APIKEY")

_INIT_TIMEOUT = 30

_QUERY_TIMEOUT = 60
_INSERT_TIMEOUT = 120

async def create_async_client() -> weaviate.WeaviateAsyncClient:
    headers = {"X-OpenAI-Api-Key": OPENAI_APIKEY} if OPENAI_APIKEY else None
    additional_config = AdditionalConfig(
        timeout=Timeout(init=_INIT_TIMEOUT, query=_QUERY_TIMEOUT, insert=_INSERT_TIMEOUT)
    )
    client = weaviate.use_async_with_weaviate_cloud(
        cluster_url=URL,
        auth_credentials=Auth.api_key(APIKEY) if APIKEY else None,
        headers=headers,
        additional_config=additional_config,
    )
    print(f"Connecting to Weaviate at: {URL!r}")

    await client.connect()
    return client

async def close (client) -> None:
    if client is not None:
        try:
            await client.close()
        finally:
            client = None


def load_schema_from_file(file_path):
    """Load schema from a file path"""
    module = import_module_from_filepath(file_path)
    get_schema_function = getattr(module, "get_schema")
    schema = get_schema_function()
    
    # Add standard key_value_store property to all schemas
    key_value_store = [
        Property(name="key", data_type=DataType.TEXT),
        Property(name="value", data_type=DataType.TEXT),
    ]
    schema["properties"].append(
        Property(name="key_value_store", data_type=DataType.OBJECT_ARRAY, nested_properties=key_value_store)
    )

    schema["properties"].append(
        Property(name="notes", data_type=DataType.TEXT)
    )
    
    return schema

def get_collection_schema(collection_name):
    """Get schema for a collection by name"""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    sub_dir = os.path.join(current_dir, "schemas")

    if sub_dir not in sys.path:
        sys.path.insert(0, sub_dir)

    file_path = f"{sub_dir}/get_schema_{collection_name.lower()}.py"
    return load_schema_from_file(file_path)

def get_collection_reference_names(collection_name):
    """Get reference property names for a collection"""
    schema = get_collection_schema(collection_name)
    reference_properties = schema.get("references", [])
    return [ref.name for ref in reference_properties]

async def get_collection (client, collection_name):
    """Get a collection, creating it if it doesn't exist"""   
    if not await client.collections.exists(collection_name):
        return await create_collection(client, collection_name)
    return client.collections.get(collection_name)

async def create_collection(client, collection_name):
    """Create a new collection with schema"""
    schema = get_collection_schema(collection_name)
    print(f"Creating collection: {collection_name}")
        
    # Create collection with properties only (references added later)
    filtered_schema_object = {
        "name": schema["name"],
        "properties": schema["properties"],
        "vector_config": Configure.Vectors.text2vec_openai()
    }
    collection = await client.collections.create(**filtered_schema_object)
        
    return collection

#async def delete_all_collections(client):
#    """Delete all collections defined in schema files"""
#    schema_file_paths = read_files_from_subdirectory("schemas")
#
#    for file_path in schema_file_paths:
#        schema = load_schema_from_file(file_path)
#        class_name = schema["name"]
#        await delete_collection(client, class_name)


#async def delete_collection(client, collection_name: str):
#    # Instantiate async client
#    await client.connect()
#    try:
#        # Delete the collection
#        await client.collections.delete(collection_name)
#        print(f"Deleted collection {collection_name}")
#    except Exception as e:
#        print(f"Error deleting collection {collection_name}: {e}")
#        raise

async def ensure_all_collections(client):
    """Ensure all collections exist with proper references"""
    schema_file_paths = read_files_from_subdirectory("schemas")
    schemas = []

    # First pass: create all collections (without references to avoid dependency issues)
    for file_path in schema_file_paths:
        schema = load_schema_from_file(file_path)
        class_name = schema["name"]
        
        # This will create the collection if it doesn't exist
        await get_collection(client, class_name)
        schemas.append(schema)

    # Second pass: add references (after all collections exist)
    for schema in schemas:
        references = schema.get("references", [])
        if references:
            class_name = schema["name"]
            collection = await get_collection(client, class_name)
            await configure_references(client, collection, references)

async def add_reference_property(client, collection_name, property_name, target_collection):
    """Safely add a reference property to a collection"""
    collection = await get_collection(client, collection_name)
    try:
        await collection.config.add_reference(ReferenceProperty(name=property_name, target_collection=target_collection))
        print(f"   ✅ Added reference '{property_name}' to '{collection_name}' -> '{target_collection}'")
        return True
    except Exception as e:
        if "already exists" in str(e).lower():
            print(f"   ⚠️ Reference '{property_name}' already exists in '{collection_name}', skipping")
            return True
        else:
            print(f"   ❌ Failed to add reference '{property_name}' to '{collection_name}': {e}")
            raise

async def configure_references(client, collection, references):
    """Configure references for a collection using the safe add_reference_property function"""
    if not references:
        return
    
    # Get collection name
    collection_name = getattr(collection, 'name', getattr(collection, '_name', 'Unknown'))
    print(f"   🔗 Configuring references for collection '{collection_name}'...")
    
    for reference in references:
        await add_reference_property(client, collection_name, reference.name, reference.target_collection)

async def has_reference(client, collection_name, from_uuid, property_name, to_uuid):
    """Check if a specific reference exists between two objects"""
    if from_uuid is None:
        raise ValueError("UUID is None, cannot fetch object.")
        
    entry = await fetch_full_object_by_id(client, collection_name, str(from_uuid))
    
    if not hasattr(entry, 'references') or entry.references is None or entry.references.get(property_name) is None:
        return False
    
    for reference in entry.references.get(property_name).objects:
        if str(reference.uuid) == str(to_uuid):
            return reference
        
    return False

async def add_object_reference(client, collection: str, from_uuid: str, prop_name: str, to_uuid: str) -> None:
    """Create a single cross-reference: (collection/from_uuid).prop_name -> to_uuid."""
    collection = client.collections.use(collection)
    # v4 method: reference_add(from_uuid, prop_name, to_uuid)
    await collection.data.reference_add(from_uuid, prop_name, to_uuid)

async def insert_object(client, collection_name, properties, uuid=None, auto_format_dates=True, overwrite=False) -> None:
    """Insert one object with a specific UUID."""
    collection = client.collections.use(collection_name)
    return await collection.data.insert(properties=properties, uuid=uuid)

async def delete_object (client, collection_name: str, uuid):
    collection = await get_collection(client, collection_name)
    await collection.data.delete_by_id(uuid)

async def get_object_property(collection_name, uuid, property_name):
    """Get a specific property from an object"""
    entry = await fetch_full_object_by_id(client, collection_name, uuid)
    if entry and hasattr(entry, 'properties') and entry.properties:
        return entry.properties.get(property_name)
    return None

def _auto_format_date_properties(properties: Any, *, in_place: bool = False) -> Any:
    """
    Recursively convert datetime-like values inside `properties` into strings.

    Converts:
      - datetime -> ISO 8601 via datetime.isoformat()
      - date     -> ISO 8601 via date.isoformat()
      - time     -> ISO 8601 via time.isoformat()

    Traverses:
      - dict-like mappings
      - lists / tuples
      - sets (returns a new set with converted elements)

    Args:
        properties: Any nested structure (dict/list/etc).
        in_place: If True and `properties` is a mutable mapping/list, mutate it.
                  Otherwise returns a deep-converted copy.

    Returns:
        The converted structure (same object if in_place=True where possible).
    """

    def _convert(obj: Any) -> Any:
        # datetime is also a date; check datetime first.
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, date) and not isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, time):
            return obj.isoformat()

        # Mappings (dict-like)
        if isinstance(obj, Mapping):
            if in_place and isinstance(obj, MutableMapping):
                # mutate mapping values in place
                for k, v in list(obj.items()):
                    obj[k] = _convert(v)
                return obj
            # return a new dict (preserving type if you want is trickier;
            # dict is usually fine for "properties")
            return {k: _convert(v) for k, v in obj.items()}

        # Sequences
        if isinstance(obj, list):
            if in_place:
                for i in range(len(obj)):
                    obj[i] = _convert(obj[i])
                return obj
            return [_convert(v) for v in obj]

        if isinstance(obj, tuple):
            return tuple(_convert(v) for v in obj)

        # Sets
        if isinstance(obj, set):
            # can't safely mutate elements while iterating; rebuild
            return {_convert(v) for v in obj}

        # Leave everything else alone
        return obj

    return _convert(properties)

async def update_object_properties(client, uuid, collection_name, properties, auto_format_dates=True):
    """Update properties of an object
    
    Args:
        uuid: Object UUID
        collection_name: Name of the collection
        properties: Properties to update
        auto_format_dates: If True, automatically format date fields to RFC3339
    """
    collection = await get_collection(client, collection_name)
    
    if auto_format_dates:
        properties = _auto_format_date_properties(properties)
    
    if "key_value_store" in properties:
        key_value_store = properties["key_value_store"]

        current_object = await fetch_object_by_id(client, collection_name, uuid)
        current_key_value_store = current_object.properties["key_value_store"]

        def get_from_entries (key, entries):
            for entry in entries:
                if entry["key"] == key:
                    return entry

            return None

        def set_entry (key, value, entries):
            entries = entries.copy()
            for i, entry in enumerate(entries):
                if entry["key"] == key:
                    entries[i]["value"] = value
                    
            return entries

        to_add = []
        for new_entry in key_value_store:
            existing = get_from_entries(new_entry["key"], current_key_value_store)

            if existing:
                current_key_value_store = set_entry(new_entry["key"], new_entry["value"], current_key_value_store)
            else:
                to_add.append(new_entry)

        properties["key_value_store"] = to_add + current_key_value_store

    await collection.data.update(uuid, properties)

async def fetch_object_by_id(client, collection_name, uuid):
    collection = await get_collection(client, collection_name)
    return await collection.query.fetch_object_by_id(
        uuid=uuid,
        include_vector=False
    )

async def fetch_full_object_by_id(client, collection_name, uuid):
    """Fetch an object with all its references"""
    reference_property_names = [
        rp for rp in get_collection_reference_names(collection_name) if rp
    ]
    collection = await get_collection(client, collection_name)

    if reference_property_names:
        return_references = [QueryReference(link_on=rp) for rp in reference_property_names]
        return await collection.query.fetch_object_by_id(
            uuid=uuid,
            include_vector=False,
            return_references=return_references
        )
    else:
        return await collection.query.fetch_object_by_id(
            uuid=uuid,
            include_vector=False
        )

async def fetch_evidence_with_metadata(client, uuid: str) -> Optional[Dict[str, Any]]:
    """Fetch an Evidence object with additional metadata (creationTimeUnix, lastUpdateTimeUnix).
    
    Returns dict with 'properties' (evidence data) and 'metadata' (creationTimeUnix, lastUpdateTimeUnix).
    """
    query = f"""
    {{
        Get {{
            Evidence (where: {{path: ["uuid"], operator: Equal, valueText: "{uuid}"}}) {{
                date
                excerpt
                source
                _additional {{
                    creationTimeUnix
                    lastUpdateTimeUnix
                }}
            }}
        }}
    }}
    """
    
    result = await query_raw(client, query)
    
    if not result:
        return None
    
    data = getattr(result, "data", None)
    get_block = None
    
    if isinstance(data, dict):
        get_block = data.get("Get", {})
    elif data is None:
        get_attr = getattr(result, "get", None)
        if isinstance(get_attr, dict):
            get_block = get_attr
    
    if not get_block:
        return None
    
    evidence_data = get_block.get("Evidence", [])
    if not evidence_data:
        return None
    
    return evidence_data[0]

async def update_object(client, collection: str, uuid: str, properties: Dict[str, Any]) -> None:
    """Update (patch) properties of an existing object."""
    collection = client.collections.use(collection)
    await collection.data.update(uuid, properties=properties)

async def get_object_references(client, collection_name, uuid, reference_name):
    """Get references from an object"""
    entry = await fetch_full_object_by_id(client, collection_name, uuid)

    if not hasattr(entry, 'references') or entry.references is None or reference_name not in entry.references:
        return None

    return entry.references[reference_name].objects

async def get_object_metadata(client, collection_name, uuid, key):
    """Get a metadata key-value pair from an object"""
    key_value_store = await get_object_property(client, collection_name, uuid, "key_value_store")
    
    if not key_value_store:
        return None

    for pair in key_value_store:
        if pair.get("key") == key:
            return pair
    
    return None

async def set_object_metadata(client, collection_name, uuid, key, value):
    """Set a metadata key-value pair on an object"""
    if not isinstance(value, str):
        value = str(value)

    key_value_store = await get_object_property(client, collection_name, uuid, "key_value_store")
    
    if not key_value_store:
        key_value_store = []

    found = False
    for pair in key_value_store:
        if pair.get("key") == key:
            pair["value"] = value
            found = True
            break
    
    if not found:
        key_value_store.append({
            "key": key,
            "value": value
        })

    await update_object_properties(client, uuid, collection_name, {"key_value_store": key_value_store}, auto_format_dates=False)


async def query_raw(client, query):
    """Run a raw GraphQL query and return a normalized dict."""
    class_name = extract_class_name_from_graphql(query)
    if class_name is not None:
        await get_collection(client, class_name)

    result = await client.graphql_raw_query(query)
    return result

def extract_class_name_from_graphql(query_string):
    """Extract the class name from a GraphQL query string"""
    match = re.search(r'Get\s*{\s*(\w+)\s*\(where', query_string, re.DOTALL)
    if match:
        return match.group(1)
    return None

async def get_server_time(use_default_tz=True):
    pass

def import_module_from_filepath(filepath):
    """Import a module directly from a given file path"""
    module_name = os.path.splitext(os.path.basename(filepath))[0]
    spec = importlib.util.spec_from_file_location(module_name, filepath)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def read_files_from_subdirectory(sub_dir_name):
    """Read all Python files from a specified subdirectory"""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    sub_dir = os.path.join(current_dir, sub_dir_name)

    file_paths = []
    for root, dirs, files in os.walk(sub_dir):
        for file_name in files:
            if file_name.endswith(".py"):
                file_path = os.path.join(root, file_name)
                file_paths.append(file_path)

    return file_paths
