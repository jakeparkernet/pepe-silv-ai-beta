import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import argparse
import asyncio
import json
import os
from weaviate.classes.query import QueryReference
from app.core.db.weaviate import weaviate_wrapper as ww

COLLECTIONS = ["Entity", "Evidence", "Article", "NewsSite", "Relationship", "KeyValue"]
DEFAULT_OUTPUT_DIR = "backups"

_s3_client = None


def _get_s3_client():
    global _s3_client
    if _s3_client is None:
        import boto3
        _s3_client = boto3.client(
            "s3",
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID_WEAVIATE"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY_WEAVIATE"),
            region_name=os.getenv("AWS_DEFAULT_REGION_WEAVIATE", "us-east-2"),
        )
    return _s3_client


def _get_s3_bucket():
    return os.getenv("S3_BUCKET_WEAVIATE", "")


def _write_to_s3(collection_name: str, uuid: str, data: dict, prefix: str = "weaviate"):
    client = _get_s3_client()
    bucket = _get_s3_bucket()
    key = f"{prefix}/{collection_name}/{collection_name}-{uuid}.json"
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=json.dumps(data, indent=2, default=str).encode("utf-8"),
        ContentType="application/json",
    )
    return key


async def backup_collection(client, collection_name: str, obj_uuid: str = None, max_per_collection: int = 1, output_dir: str = DEFAULT_OUTPUT_DIR, use_local: bool = True, use_s3: bool = False, s3_prefix: str = "weaviate"):
    collection = await ww.get_collection(client, collection_name)

    if use_local:
        output_folder = os.path.join(output_dir, collection_name)
        os.makedirs(output_folder, exist_ok=True)

    ref_props = ww.get_collection_reference_names(collection_name)
    return_refs = [QueryReference(link_on=rp) for rp in ref_props] if ref_props else None

    count = 0
    async for obj in collection.iterator(include_vector=False, return_references=return_refs):
        uuid = str(obj.uuid)

        if obj_uuid and uuid != obj_uuid:
            continue

        props = {}
        if obj.properties:
            props = dict(obj.properties)

        refs = {}
        if obj.references:
            for ref_name, ref_obj in obj.references.items():
                if ref_obj and hasattr(ref_obj, 'objects') and ref_obj.objects:
                    refs[ref_name] = [{"uuid": str(o.uuid), "collection": o.collection} for o in ref_obj.objects]

        data = {"uuid": uuid, "properties": props, "references": refs}

        if use_local:
            file_name = f"{collection_name}-{uuid}.json"
            file_path = os.path.join(output_folder, file_name)
            with open(file_path, "w") as f:
                json.dump(data, f, indent=2, default=str)

        if use_s3:
            key = _write_to_s3(collection_name, uuid, data, s3_prefix)
            print(f"Uploaded to s3://{_get_s3_bucket()}/{key}")

        count += 1
        if max_per_collection and count >= max_per_collection:
            break

    print(f"Backed up {count} objects from {collection_name}")


async def main():
    parser = argparse.ArgumentParser(description="Backup Weaviate collections to JSON")
    parser.add_argument("--collection", "-c", help="Specific collection to backup")
    parser.add_argument("--id", "-i", help="Specific object UUID to backup")
    parser.add_argument("--max", "-m", type=int, default=1, help="Max objects per collection (default: 1, 0 for unlimited)")
    parser.add_argument("--output", "-o", default=DEFAULT_OUTPUT_DIR, help="Output directory")
    parser.add_argument("--s3", action="store_true", help="Upload to S3")
    parser.add_argument("--s3-prefix", default="weaviate", help="S3 key prefix (default: weaviate)")
    parser.add_argument("--skip-local", action="store_true", help="Skip local backup (use with --s3)")
    args = parser.parse_args()

    use_local = not args.skip_local

    client = await ww.create_async_client()
    try:
        if args.collection:
            await backup_collection(client, args.collection, obj_uuid=args.id, max_per_collection=args.max, output_dir=args.output, use_local=use_local, use_s3=args.s3, s3_prefix=args.s3_prefix)
        else:
            for coll in COLLECTIONS:
                await backup_collection(client, coll, max_per_collection=args.max, output_dir=args.output, use_local=use_local, use_s3=args.s3, s3_prefix=args.s3_prefix)
    finally:
        await ww.close(client)


if __name__ == "__main__":
    asyncio.run(main())
