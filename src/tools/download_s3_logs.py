#!/usr/bin/env python3
"""
Download all files from S3 bucket pepe-logs/jobs prefix to local directory.
Preserves S3 folder structure.
"""

import argparse
import os
import sys

import boto3
from botocore.exceptions import ClientError


def get_client(args):
    kwargs = {}
    if args.access_key:
        kwargs["aws_access_key_id"] = args.access_key
    if args.secret_key:
        kwargs["aws_secret_access_key"] = args.secret_key
    if args.region:
        kwargs["region_name"] = args.region

    return boto3.client("s3", **kwargs)


def download_objects(s3_client, bucket, prefix, local_dir):
    paginator = s3_client.get_paginator("list_objects_v2")

    total_files = 0
    downloaded = 0
    errors = 0

    print(f"Scanning s3://{bucket}/{prefix} ...")

    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        contents = page.get("Contents", [])
        if not contents:
            continue

        total_files += len(contents)

        for obj in contents:
            key = obj["Key"]
            relative_path = key[len(prefix):].lstrip("/")

            if not relative_path:
                continue

            local_path = os.path.join(local_dir, relative_path)
            local_folder = os.path.dirname(local_path)

            os.makedirs(local_folder, exist_ok=True)

            try:
                s3_client.download_file(bucket, key, local_path)
                print(f"  Downloaded: {relative_path}")
                downloaded += 1
            except ClientError as e:
                print(f"  ERROR downloading {relative_path}: {e}")
                errors += 1

    print(f"\nDone: {downloaded}/{total_files} files downloaded ({errors} errors)")
    return downloaded, errors


def main():
    parser = argparse.ArgumentParser(description="Download pepe-logs/jobs from S3")
    parser.add_argument("--bucket", default="pepe-logs", help="S3 bucket name")
    parser.add_argument("--prefix", default="jobs", help="S3 key prefix")
    parser.add_argument("--local-dir", default="downloaded_logs", help="Local directory to download to")
    parser.add_argument("--access-key", default=os.getenv("AWS_ACCESS_KEY_ID_SYNC"), help="AWS access key")
    parser.add_argument("--secret-key", default=os.getenv("AWS_SECRET_ACCESS_KEY_SYNC"), help="AWS secret key")
    parser.add_argument("--region", default=os.getenv("AWS_DEFAULT_REGION_SYNC", "us-east-2"), help="AWS region")

    args = parser.parse_args()

    client = get_client(args)

    full_prefix = f"{args.prefix}/" if not args.prefix.endswith("/") else args.prefix

    print(f"Downloading from s3://{args.bucket}/{full_prefix}")
    print(f"Target directory: {os.path.abspath(args.local_dir)}")
    print()

    download_objects(client, args.bucket, full_prefix, args.local_dir)


if __name__ == "__main__":
    main()
