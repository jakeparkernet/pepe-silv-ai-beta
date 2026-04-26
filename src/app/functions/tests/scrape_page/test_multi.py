import asyncio
from test_edge import run_test

urls = [
    "https://www.theverge.com",
    "https://www.cnn.com",
    "https://www.fox.com",
    "https://www.cbs.com",
    "https://www.bbc.com",
    "https://abcnews.go.com/",
    "https://www.bloomberg.com",
    "https://www.vox.com",
    "https://www.blackrock.com",
    "https://www.google.com",
]

count = len(urls)
target_count = count
complete_count = 0
done_event = asyncio.Event()

def on_complete(result):
    global complete_count
    print(result)
    complete_count += 1
    if complete_count >= target_count:
        done_event.set()

async def main():
    for url in urls:
        run_test(url, on_complete)

    await done_event.wait()
    print(f"Reached {target_count} completions, continuing...")

asyncio.run(main())
