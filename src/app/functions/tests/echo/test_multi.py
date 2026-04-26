import asyncio
from test_edge import run_test

count = 10
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
    for _ in range(count):
        run_test(on_complete)

    await done_event.wait()
    print(f"Reached {target_count} completions, continuing...")

asyncio.run(main())
