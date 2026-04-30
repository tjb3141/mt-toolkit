from pathlib import Path
from playwright.sync_api import sync_playwright

svg = Path(r"D:\Google Drive\8. Passion Projects\Riley Silent Disco\static\favicon.svg").read_text()
html = f'<!DOCTYPE html><html><body style="margin:0;padding:0;background:transparent">{svg}</body></html>'
out = r"D:\Google Drive\8. Passion Projects\Riley Silent Disco\static\favicon.png"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 512, "height": 512})
    page.set_content(html)
    page.wait_for_timeout(300)
    page.screenshot(path=out, clip={"x": 0, "y": 0, "width": 512, "height": 512})
    browser.close()

print("done:", out)
