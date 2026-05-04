"""
Freeze Dance mode Playwright helper. Opens browser windows, each joining a
session and waiting for the host to start the first round.

Usage:
    python test_freeze_dance.py <CODE> [base_url] [client_count]

Examples:
    python test_freeze_dance.py ABC123
    python test_freeze_dance.py ABC123 http://mt-toolkit.expo.app/:8081
    python test_freeze_dance.py ABC123 http://mt-toolkit.expo.app/:8081 8
"""

import asyncio
import random
import sys

from playwright.async_api import async_playwright

NAMES = [
    "Alice", "Bob", "Charlie", "Dana", "Evie", "Frank",
    "Grace", "Henry", "Iris", "Jack", "Kara", "Leo",
]

DEFAULT_URL = "http://mt-toolkit.expo.app/"
DEFAULT_CLIENTS = 6


async def join_client(context, base_url: str, code: str, name: str, index: int):
    page = await context.new_page()
    await page.set_viewport_size({"width": 390, "height": 844})
    await page.goto(f"{base_url}/join/{code}")
    await page.wait_for_selector('input[placeholder="Your name"]')
    await page.fill('input[placeholder="Your name"]', name)
    await page.get_by_text("Let's go").first.click()
    print(f"  [{index + 1}] {name} joined — waiting for host to start")
    return page


async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    code = sys.argv[1].strip().upper()
    base_url = sys.argv[2].rstrip("/") if len(sys.argv) > 2 else DEFAULT_URL
    client_count = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_CLIENTS
    names = random.sample(NAMES, min(client_count, len(NAMES)))

    print(f"\nOpening {len(names)} freeze dance clients -> {base_url}/join/{code}")
    print(f"Names: {', '.join(names)}\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)

        pages = []
        for i, name in enumerate(names):
            ctx = await browser.new_context()
            page = await join_client(ctx, base_url, code, name, i)
            pages.append(page)
            await asyncio.sleep(0.3)

        print(f"\nAll {len(names)} clients joined.")
        print("Go to the host page, pick a playlist, and start the round.")
        print("Hit Play — clients should show DANCE! (green). Hit Pause — they should FREEZE! (red).")
        print("Mark anyone who moved as out. Then hit Next Round to go again.")
        print("\nPress Enter here to close all browsers when done.")
        await asyncio.get_event_loop().run_in_executor(None, input)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
