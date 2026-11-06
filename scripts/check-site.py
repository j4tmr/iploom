"""Validate the static Pages payload without fetching external URLs."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote

root = Path(__file__).resolve().parents[1] / "site"

class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.links, self.headings = set(), [], 0
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            assert attrs["id"] not in self.ids, f"Duplicate id: {attrs['id']}"
            self.ids.add(attrs["id"])
        if tag == "h1": self.headings += 1
        if tag == "img": assert attrs.get("alt"), "Image needs alt text"
        for key in ("href", "src"):
            if key in attrs: self.links.append(attrs[key])

for path in root.glob("*.html"):
    page = Page()
    page.feed(path.read_text())
    assert page.headings == 1, "Expected one h1"
    for value in page.links:
        url = urlsplit(value)
        if url.scheme or url.netloc:
            assert url.scheme == "https", f"Non-HTTPS external URL: {value}"
            continue
        target = (path.parent / unquote(url.path)).resolve() if url.path else path
        assert target.is_relative_to(root), f"Path escapes site: {value}"
        assert target.exists(), f"Missing asset: {value}"
        if url.fragment and target == path:
            assert url.fragment in page.ids, f"Missing anchor: {value}"
    print(f"OK {path.name}: {len(page.links)} links/assets, {len(page.ids)} anchors")
