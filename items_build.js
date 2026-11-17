import base64
import json
import time
import urllib.parse
import requests

API_URL = "https://minecraft.wiki"
HEADERS = {
    "User-Agent": "StrawberryMCWikiBuilder/1.0 (https://github.com)"
}


def get_category_members(category, limit=None):
    """Fetches page titles from a Minecraft Wiki category via MediaWiki API."""
    titles = []
    params = {
        "action": "query",
        "list": "categorymembers",
        "cmtitle": f"Category:{category}",
        "cmnamespace": 0,  # Main articles only
        "cmlimit": 500,
        "format": "json",
    }

    while True:
        response = requests.get(
            API_URL, params=params, headers=HEADERS, timeout=15
        )
        data = response.json()

        for member in data.get("query", {}).get("categorymembers", []):
            titles.append(member["title"])
            if limit and len(titles) >= limit:
                return titles

        if "continue" in data:
            params["cmcontinue"] = data["continue"]["cmcontinue"]
        else:
            break

    return titles


def get_invicon_base64(item_name):
    """Fetches the Invicon PNG for an item and encodes it as a Base64 data URI."""
    # Minecraft Wiki stores inventory icons as "File:Invicon <Item Name>.png"
    file_title = f"File:Invicon {item_name}.png"
    params = {
        "action": "query",
        "titles": file_title,
        "prop": "imageinfo",
        "iiprop": "url",
        "format": "json",
    }

    res = requests.get(API_URL, params=params, headers=HEADERS, timeout=15).json()
    pages = res.get("query", {}).get("pages", {})

    for page_id, page_data in pages.items():
        if page_id == "-1":
            return None  # Icon does not exist under this exact name

        image_info = page_data.get("imageinfo", [])
        if image_info:
            img_url = image_info[0]["url"]
            img_res = requests.get(img_url, headers=HEADERS, timeout=15)
            if img_res.status_code == 200:
                encoded = base64.b64encode(img_res.content).decode("utf-8")
                return f"data:image/png;base64,{encoded}"

    return None


def main():
    print("Fetching item and block lists from Minecraft Wiki API...")
    # Remove limit=25 when you are ready to fetch the entire wiki
    items = get_category_members("Items", limit=25)
    blocks = get_category_members("Blocks", limit=25)

    # Combine and deduplicate while preserving alphabetical order
    all_names = sorted(list(set(items + blocks)))
    print(f"Found {len(all_names)} entries. Downloading and encoding icons...")

    output_items = []

    for name in all_names:
        b64_image = get_invicon_base64(name)
        if not b64_image:
            print(f"Skipping '{name}' (no standard Invicon found)")
            continue

        wiki_slug = urllib.parse.quote(name.replace(" ", "_"))
        output_items.append({
            "name": name.lower(),
            "link": f"https://minecraft.wiki/w/{wiki_slug}",
            "image": b64_image,
        })
        print(f"Added: {name}")

        # Polite delay to respect Minecraft Wiki rate limits
        time.sleep(0.1)

    with open("items.json", "w", encoding="utf-8") as f:
        json.dump({"items": output_items}, f, indent=2)

    print(f"\nDone! Saved {len(output_items)} items to items.json.")


if __name__ == "__main__":
    main()
