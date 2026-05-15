#!/usr/bin/env bash
set -euo pipefail

project_name="${CLOUDFLARE_PAGES_PROJECT_NAME:-pepe-silv-ai-beta}"
production_branch="${CLOUDFLARE_PAGES_PRODUCTION_BRANCH:-main}"
expected_owner="${CLOUDFLARE_PAGES_REPO_OWNER:-jakeparkernet}"
expected_repo="${CLOUDFLARE_PAGES_REPO_NAME:-pepe-silv-ai-beta}"
apply=false

usage() {
    cat <<EOF
Usage: CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... $0 [--apply]

Checks the Cloudflare Pages Git integration for ${project_name}.

Options:
  --apply    Patch the project to enable production auto-deploys from ${production_branch}
  --help     Show this help

Optional env vars:
  CLOUDFLARE_PAGES_PROJECT_NAME       default: pepe-silv-ai-beta
  CLOUDFLARE_PAGES_PRODUCTION_BRANCH  default: main
  CLOUDFLARE_PAGES_REPO_OWNER         default: jakeparkernet
  CLOUDFLARE_PAGES_REPO_NAME          default: pepe-silv-ai-beta
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply)
            apply=true
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" || -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
    echo "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required." >&2
    exit 2
fi

api_base="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project_name}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

api() {
    local method="$1"
    local url="$2"
    local data_file="${3:-}"
    if [[ -n "$data_file" ]]; then
        curl -fsS -X "$method" "$url" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data-binary "@${data_file}"
    else
        curl -fsS -X "$method" "$url" \
            -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
    fi
}

current_json="$tmp_dir/current.json"
patch_json="$tmp_dir/patch.json"
patched_json="$tmp_dir/patched.json"

api GET "$api_base" > "$current_json"

python3 - "$current_json" "$expected_owner" "$expected_repo" "$production_branch" <<'PY'
import json
import sys

path, expected_owner, expected_repo, production_branch = sys.argv[1:]
payload = json.load(open(path, encoding="utf-8"))
if not payload.get("success"):
    print(json.dumps(payload.get("errors") or payload, indent=2))
    raise SystemExit(1)

project = payload["result"]
source = project.get("source") or {}
config = source.get("config") or {}
build = project.get("build_config") or {}

print(f"Project: {project.get('name')}")
print(f"Source type: {source.get('type') or '(none/direct upload)'}")
print(f"Repository: {config.get('owner') or '(none)'}/{config.get('repo_name') or '(none)'}")
print(f"Production branch: {config.get('production_branch') or '(none)'}")
print(f"Production auto-deploys enabled: {config.get('production_deployments_enabled')}")
print(f"Legacy deploys enabled: {config.get('deployments_enabled')}")
print(f"Build command: {build.get('build_command') or '(none)'}")
print(f"Build output directory: {build.get('destination_dir') or '(none)'}")
print(f"Root directory: {build.get('root_dir') or '(blank/repo root)'}")

problems = []
if source.get("type") != "github":
    problems.append("Project is not connected to GitHub. Recreate it as a Git-integrated Pages project.")
if config.get("owner") != expected_owner:
    problems.append(f"Expected GitHub owner {expected_owner!r}, found {config.get('owner')!r}.")
if config.get("repo_name") != expected_repo:
    problems.append(f"Expected GitHub repo {expected_repo!r}, found {config.get('repo_name')!r}.")
if config.get("production_branch") != production_branch:
    problems.append(f"Expected production branch {production_branch!r}, found {config.get('production_branch')!r}.")
if config.get("production_deployments_enabled") is not True:
    problems.append("Production auto-deploys are not enabled.")
if build.get("build_command") != "bash scripts/build_cloudflare_pages.sh":
    problems.append("Build command does not match this repo.")
if build.get("destination_dir") != "dist/cloudflare-pages":
    problems.append("Build output directory does not match this repo.")
if build.get("root_dir") not in (None, ""):
    problems.append("Root directory should be blank/repo root.")

if problems:
    print("\nProblems:")
    for problem in problems:
        print(f"- {problem}")
else:
    print("\nCloudflare Pages Git auto-deploy config already matches this repo.")
PY

if [[ "$apply" != true ]]; then
    echo
    echo "Dry run only. Re-run with --apply to patch fixable project settings."
    exit 0
fi

python3 - "$current_json" "$patch_json" "$production_branch" <<'PY'
import json
import sys

current_path, patch_path, production_branch = sys.argv[1:]
payload = json.load(open(current_path, encoding="utf-8"))
project = payload["result"]
source = project.get("source") or {}
if source.get("type") != "github":
    raise SystemExit("Cannot patch Git auto-deploys because this Pages project is not GitHub-backed.")

source_config = dict(source.get("config") or {})
source_config["deployments_enabled"] = True
source_config["production_deployments_enabled"] = True
source_config["production_branch"] = production_branch

patch = {
    "build_config": {
        "build_command": "bash scripts/build_cloudflare_pages.sh",
        "destination_dir": "dist/cloudflare-pages",
        "root_dir": "",
    },
    "source": {
        "type": "github",
        "config": source_config,
    },
}

with open(patch_path, "w", encoding="utf-8") as handle:
    json.dump(patch, handle)
PY

api PATCH "$api_base" "$patch_json" > "$patched_json"

python3 - "$patched_json" <<'PY'
import json
import sys

payload = json.load(open(sys.argv[1], encoding="utf-8"))
if not payload.get("success"):
    print(json.dumps(payload.get("errors") or payload, indent=2))
    raise SystemExit(1)
print("Patched Cloudflare Pages project settings.")
PY

api GET "$api_base" > "$current_json"
python3 - "$current_json" "$expected_owner" "$expected_repo" "$production_branch" <<'PY'
import json
import sys

path, expected_owner, expected_repo, production_branch = sys.argv[1:]
project = json.load(open(path, encoding="utf-8"))["result"]
source = project.get("source") or {}
config = source.get("config") or {}
build = project.get("build_config") or {}

checks = {
    "source type is github": source.get("type") == "github",
    "repo owner matches": config.get("owner") == expected_owner,
    "repo name matches": config.get("repo_name") == expected_repo,
    "production branch matches": config.get("production_branch") == production_branch,
    "production auto-deploys enabled": config.get("production_deployments_enabled") is True,
    "build command matches": build.get("build_command") == "bash scripts/build_cloudflare_pages.sh",
    "output directory matches": build.get("destination_dir") == "dist/cloudflare-pages",
    "root directory is repo root": build.get("root_dir") in (None, ""),
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    print("Cloudflare config still has failing checks:")
    for name in failed:
        print(f"- {name}")
    raise SystemExit(1)
print("Verified Cloudflare Pages Git auto-deploy config.")
PY
