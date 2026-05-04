"""
Silent Disco Playwright helper. Opens browser windows, each joining a session
and choosing a music genre.

Usage:
    python test_silent_disco.py <CODE> [base_url] [client_count]

Examples:
    python test_silent_disco.py ABC123
    python test_silent_disco.py ABC123 http://mt-toolkit.expo.app/:8081 6
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
DEFAULT_CLIENTS = 4


async def join_client(context, base_url: str, code: str, name: str, index: int):
    page = await context.new_page()
    await page.set_viewport_size({"width": 390, "height": 844})
    await page.goto(f"{base_url}/join/{code}")

    await page.wait_for_selector('input[placeholder="Your name"]')
    await page.fill('input[placeholder="Your name"]', name)
    await page.get_by_text("Let's go").first.click()

    # Wait for genre picker to appear, then pick one
    try:
        await page.wait_for_selector('text="Pick your vibe"', timeout=5000)
        genre_rows = page.locator('[data-testid="genre-row"]')
        count = await genre_rows.count()
        if count > 0:
            await genre_rows.nth(index % count).click()
        else:
            # Fallback: click any pressable that isn't the join button
            rows = page.locator('div[role="button"]')
            row_count = await rows.count()
            if row_count > 0:
                await rows.nth(index % row_count).click()
    except Exception:
        pass

    print(f"  [{index + 1}] {name} joined and picked a genre")
    return page


async def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    code = sys.argv[1].strip().upper()
    base_url = sys.argv[2].rstrip("/") if len(sys.argv) > 2 else DEFAULT_URL
    client_count = int(sys.argv[3]) if len(sys.argv) > 3 else DEFAULT_CLIENTS
    names = random.sample(NAMES, min(client_count, len(NAMES)))

    print(f"\nOpening {len(names)} silent disco clients -> {base_url}/join/{code}")
    print(f"Names: {', '.join(names)}\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)

        for i, name in enumerate(names):
            ctx = await browser.new_context()
            await join_client(ctx, base_url, code, name, i)
            await asyncio.sleep(0.3)

        print("\nClients joined. Use the host page to play/pause the session.")
        print("Press Enter here to close all browsers when done.")
        await asyncio.get_event_loop().run_in_executor(None, input)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
