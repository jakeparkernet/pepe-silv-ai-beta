import asyncio
import os
import json
from test_edge import run_test

queries = [
    "what company runs cnn.com?",
    "what company is the news site theverge.com?",
    "what company is the site bloomberg.com?",
    "what company is the news site fox.com?",
    "what company is the news site cbs.com?",
    "what company is the news site box.com?",
    "what company is the news site bbc.com?",
    "what company is the news site abcnews.go.com?",
    "which news company runs nbc.com?",
    "who owns warner brothers?"
]

count = len(queries)
target_count = count
complete_count = 0
done_event = asyncio.Event()

def on_complete(result):
    global complete_count
    print(result)

    # Get the directory where the current script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # Build a path for the output file in the same directory
    file_path = os.path.join(script_dir, f"brave_search_multi_test_results{complete_count}.json")

    with open(file_path, "w") as f:
        json.dump(result, f, indent=2)

    complete_count += 1
    if complete_count >= target_count:
        done_event.set()

async def main():
    for query in queries:
        run_test(query, on_complete)

    await done_event.wait()
    print(f"Reached {target_count} completions, continuing...")

asyncio.run(main())
