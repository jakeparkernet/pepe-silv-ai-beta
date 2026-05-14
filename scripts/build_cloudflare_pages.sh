#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$root_dir/src/site/dev"
output_dir="$root_dir/dist/cloudflare-pages"
three_examples_dir="$output_dir/js/thirdparty/three.js-r181/examples"

rm -rf "$output_dir"
mkdir -p "$output_dir"
cp -a "$source_dir/." "$output_dir/"

# The app imports Three addons from examples/jsm only. The rest of the Three
# examples tree is demo content and includes files over Cloudflare Pages' 25 MiB
# per-asset limit.
if [[ -d "$three_examples_dir" ]]; then
    find "$three_examples_dir" -mindepth 1 -maxdepth 1 ! -name jsm -exec rm -rf {} +
fi

oversized_file="$(find "$output_dir" -type f -size +25M -print -quit)"
if [[ -n "$oversized_file" ]]; then
    echo "Cloudflare Pages asset exceeds 25 MiB: $oversized_file" >&2
    exit 1
fi
