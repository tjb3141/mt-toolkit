"""
Partners mode test helper — opens 6 browser windows, each joining a session.

Usage:
    python test_partners.py <CODE> [base_url]

Examples:
    python test_partners.py ABC123
    python test_partners.py ABC123 http://mt-toolkit.expo.app/:8081
"""

import asyncio
import random
import sys
from playwright.async_api import async_playwright

NAMES = ["Alice", "Bob", "Charlie", "Dana", "Evie", "Frank", "Grace", "Henry",
         "Iris", "Jack", "Kara", "Leo"]

DEFAULT_URL = "http://mt-toolkit.expo.app/"


async def join_client(context, base_url: str, code: str, name: str, index: int):
    page = await context.new_page()
    await page.set_viewport_size({"width": 390, "height": 844})
    await page.goto(f"{base_url}/join/{code}")
    await page.wait_for_selector('input[placeholder="Your name"]')
    await page.fill('input[placeholder="Your name"]', name)
    await page.get_by_text("Let's go").first.click()
    print(f"  [{index + 1}] {name} joined")
    return page


async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    code = sys.argv[1].strip().upper()
    base_url = sys.argv[2].rstrip("/") if len(sys.argv) > 2 else DEFAULT_URL
    names = random.sample(NAMES, 6)

    print(f"\nOpening 6 partners clients -> {base_url}/join/{code}")
    print(f"Names: {', '.join(names)}\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)

        pages = []
        for i, name in enumerate(names):
            ctx = await browser.new_context()
            page = await join_client(ctx, base_url, code, name, i)
            pages.append(page)
            await asyncio.sleep(0.3)

        print(f"\nAll 6 joined. Go assign partners on the host page.")
        print("Press Enter here to close all browsers when done.")
        await asyncio.get_event_loop().run_in_executor(None, input)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
