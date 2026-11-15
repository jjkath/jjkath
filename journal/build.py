"""Build the static observing journal from individual capture posts."""
import argparse
import base64
from datetime import date
import json
from pathlib import Path
import re
import shutil

import yaml

SITE = Path(__file__).resolve().parent
KINDS = ("Galaxies", "Nebulae", "Star clusters", "Galaxy clusters")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
IMAGE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\.webp")
REPLAY = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\.mp4")
PRECISION = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\.rgb16")
DETAIL = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\.(?:webp|png)")
SHA256 = re.compile(r"[0-9a-f]{64}")


def read_post(path):
    text = path.read_text(encoding="utf-8")
    header, delimiter, note = text.removeprefix("---\n").partition("\n---\n")
    if not text.startswith("---\n") or not delimiter or not note.strip():
        raise ValueError(f"{path.name}: expected front matter and a capture note")
    attributes = yaml.safe_load(header)
    if not isinstance(attributes, dict):
        raise ValueError(f"{path.name}: front matter must be a mapping")
    return attributes, note.strip()


def read_posts(site):
    for path in sorted((site / "_posts").glob("*.md")):
        try:
            fields, note = read_post(path)
            fields["capture_date"] = date.fromisoformat(str(fields["capture_date"])).isoformat()
            for key in ("title", "catalog_id", "image", "thumbnail", "target_id", "capture_id", "kind"):
                if not isinstance(fields[key], str) or not fields[key].strip():
                    raise ValueError(f"{key} must be text")
            for key in ("target_id", "capture_id"):
                if not SLUG.fullmatch(fields[key]):
                    raise ValueError(f"invalid {key}: {fields[key]}")
            if path.name != f"{fields['capture_date']}-{fields['capture_id']}.md":
                raise ValueError("filename must match the capture date and ID")
            if fields["kind"] not in KINDS:
                raise ValueError("unknown target type")
            for key in ("date_confirmed", "cover"):
                if type(fields.get(key, False)) is not bool:
                    raise ValueError(f"{key} must be true or false")
            seconds = fields.get("integration_seconds")
            if seconds is not None and (type(seconds) is not int or seconds < 1):
                raise ValueError("integration_seconds must be a positive whole number")
            if "source_sha256" in fields and not SHA256.fullmatch(str(fields["source_sha256"])):
                raise ValueError("invalid source_sha256")
        except (KeyError, ValueError, yaml.YAMLError) as error:
            raise ValueError(f"{path.name}: {error}") from error
        yield fields, note


def read_catalog(site, asset_url):
    sky = json.loads((site / "sky_fields.json").read_text(encoding="utf-8"))
    precision = json.loads((site / "precision.json").read_text(encoding="utf-8"))
    detail_path = site / "detail.json"
    details = json.loads(detail_path.read_text(encoding="utf-8")) if detail_path.is_file() else {}
    targets = {}
    identifiers = set()
    source_digests = set()
    for post, note in read_posts(site):
        target_id = post["target_id"]
        capture_id = post["capture_id"]
        metadata = dict(name=post["title"], catalog=post["catalog_id"], kind=post["kind"])
        target = targets.setdefault(target_id, dict(id=target_id, captures=[], **metadata))
        if any(target[key] != value for key, value in metadata.items()):
            raise ValueError(f"{capture_id}: conflicting information for {target_id}")
        if capture_id in identifiers:
            raise ValueError(f"{capture_id}: duplicate capture ID")
        identifiers.add(capture_id)
        digest = post.get("source_sha256")
        if digest in source_digests:
            raise ValueError(f"{capture_id}: source image is already in the catalog")
        if digest:
            source_digests.add(digest)
        if post.get("cover"):
            if "cover" in target:
                raise ValueError(f"{target_id}: more than one gallery cover")
            target["cover"] = capture_id
        capture = dict(
            id=capture_id, date=post["capture_date"], confirmed=post.get("date_confirmed", False),
            seconds=post.get("integration_seconds"), description=note,
            full=asset_url("images",post["image"]), thumb=asset_url("images",post["thumbnail"]),
        )
        if capture_id in sky:
            capture["sky"] = dict(sky[capture_id])
            survey = f"{capture_id}.webp"
            if (site / "assets" / "surveys" / survey).is_file():
                capture["sky"]["survey"] = asset_url("surveys", survey)
        if capture_id in precision:
            data = precision[capture_id]
            if any(type(data[key]) is not int or data[key] < 1 for key in ("width","height")):
                raise ValueError(f"{capture_id}: invalid precision image dimensions")
            capture["precision"] = {k:v for k,v in data.items() if k != "file"}
            capture["precision"]["url"] = asset_url("precision",data["file"])
        if post.get("replay"):
            capture["replay"] = asset_url("replays",post["replay"])
        detail = post.get("detail",details.get(capture_id))
        if detail:
            url = asset_url("detail",detail["file"])
            capture["detail"] = {**detail,"url":url}
        target["captures"].append(capture)
    if not targets:
        raise ValueError("no capture posts found")
    for target in targets.values():
        target.setdefault("cover", target["captures"][-1]["id"])
    comparisons = json.loads((site / "alignments.json").read_text(encoding="utf-8"))
    for target_id, alignment in comparisons.items():
        target = targets[target_id]
        captures = alignment["captures"]
        options = alignment["default"]
        available = {item["id"] for item in target["captures"]}
        if len(options) != 2 or len(set(options)) != 2 or not set(options) <= captures.keys() <= available:
            raise ValueError(f"{target_id}: invalid aligned capture set")
        if any(type(alignment[key]) is not int or alignment[key] <= 0 for key in ("width", "height")):
            raise ValueError(f"{target_id}: invalid aligned image size")
        target["comparison"] = {**alignment, "captures": {key: asset_url("images",file) for key, file in captures.items()}}
    return list(targets.values())


def build(site, output, bundle=None):
    assets = site / "assets"
    watermark_font = Path("fonts/zalando-sans-expanded-latin.woff2")
    files = {watermark_font, Path("fonts/OFL-Zalando-Sans-Expanded.txt")}
    derivatives_path = site / "web_derivatives.json"
    derivatives = json.loads(derivatives_path.read_text(encoding="utf-8")) if derivatives_path.is_file() else {}
    kinds = {"images":(IMAGE,"image/webp"), "surveys":(IMAGE,"image/webp"), "replays":(REPLAY,"video/mp4"),"detail":(DETAIL,None),
             "precision":(PRECISION,"application/octet-stream")}

    def asset_url(folder, filename):
        pattern, _ = kinds[folder]
        if not isinstance(filename, str) or not pattern.fullmatch(filename):
            raise ValueError(f"Invalid {folder} asset: {filename}")
        generated = folder == "images" and filename in derivatives
        if not generated and not (assets / folder / filename).is_file():
            raise ValueError(f"Missing {folder} asset: {filename}")
        files.add(Path(folder) / filename)
        return f"assets/{folder}/{filename}"

    catalog = read_catalog(site, asset_url)

    def render(targets, inline_font=False):
        data = json.dumps(targets, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
        styles = (assets / "gallery.css").read_text(encoding="utf-8")
        if inline_font:
            encoded_font = base64.b64encode((assets / watermark_font).read_bytes()).decode("ascii")
            styles = styles.replace(f"assets/{watermark_font.as_posix()}", f"data:font/woff2;base64,{encoded_font}")
        script = "\n".join((assets / name).read_text(encoding="utf-8") for name in ("image-processing.js","atlas.js","gallery.js"))
        html = (site / "index.template.html").read_text(encoding="utf-8")
        html = html.replace("<!-- styles -->", f"<style>\n{styles}</style>")
        return html.replace(
            "<!-- scripts -->",
            f'<script id="catalog-data" type="application/json">{data}</script>\n<script>\n{script}</script>',
        )

    for filename in sorted(files):
        destination = output / "assets" / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        if filename.parent == Path("images") and filename.name in derivatives:
            from PIL import Image

            source = derivatives[filename.name]
            if not isinstance(source, str) or not DETAIL.fullmatch(source):
                raise ValueError(f"Invalid lossless source for {filename.name}: {source}")
            with Image.open(assets / "detail" / source) as image:
                image.convert("RGB").save(destination, "WEBP", quality=92, method=4)
        else:
            shutil.copyfile(assets / filename, destination)
    (output / "index.html").write_text(render(catalog), encoding="utf-8")
    if bundle:
        def embedded(folder, filename):
            if folder == "detail":
                return None
            asset_url(folder,filename)
            content = base64.b64encode((output / "assets" / folder / filename).read_bytes()).decode("ascii")
            return f"data:{kinds[folder][1]};base64," + content
        bundle.write_text(render(read_catalog(site, embedded), inline_font=True), encoding="utf-8")
    print(f"Built {len(catalog)} targets and {sum(len(t['captures']) for t in catalog)} captures in {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=SITE / "dist")
    parser.add_argument("--bundle", type=Path, help="Optional standalone HTML preview")
    options = parser.parse_args()
    build(SITE, options.output, options.bundle)
