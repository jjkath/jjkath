"""Prepare one approved capture for the observing journal."""
import argparse
from datetime import date
import hashlib
import os
from pathlib import Path
from subprocess import CalledProcessError, run
from tempfile import TemporaryDirectory

import yaml

from build import KINDS, SITE, SLUG, read_posts


def magick(*args, capture=False):
    result = run(["magick", *map(str, args)], check=True, capture_output=capture, text=True)
    return result.stdout


def digest(path):
    with path.open("rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def add_capture(options):
    site = options.site.resolve()
    source = options.image.resolve(strict=True)
    if not source.is_file():
        raise ValueError("image must be a file")
    note = options.description.strip()
    if not note:
        raise ValueError("a capture description is required")
    if options.seconds is not None and options.seconds < 1:
        raise ValueError("--seconds must be positive")

    when = options.date.isoformat()
    target = options.target
    identifier = options.id or f"{target}-{when}"
    if not SLUG.fullmatch(target) or not SLUG.fullmatch(identifier):
        raise ValueError("target and capture IDs use lowercase letters, numbers and hyphens")
    source_hash = digest(source)
    posts = [fields for fields, _ in read_posts(site)]
    if any(p.get("source_sha256") == source_hash for p in posts):
        raise ValueError("this source image is already in the journal")
    if any(p["capture_id"] == identifier for p in posts):
        raise ValueError("capture ID already exists; use --id for a distinct capture on the same date")
    same_target = next((p for p in posts if p["target_id"] == target), None)
    if same_target:
        name, catalog, kind = (same_target[key] for key in ("title", "catalog_id", "kind"))
        if any(value is not None and value != expected for value, expected in
               zip((options.name, options.catalog, options.kind), (name, catalog, kind))):
            raise ValueError("target metadata differs from the existing entry")
    else:
        if not all((options.name, options.catalog, options.kind)):
            raise ValueError("new targets require --name, --catalog and --kind")
        name, catalog, kind = options.name, options.catalog, options.kind

    frame_info = magick(source, "-auto-orient", "-format", "%w %h\n", "info:", capture=True).splitlines()
    if len(frame_info) != 1:
        raise ValueError("choose a single stacked image")
    width, height = map(int, frame_info[0].split())
    left, top, right, bottom = [
        round(pct * size / 100) for pct, size in zip(options.crop, (width, height, width, height))
    ]
    if min(left, top, right, bottom) < 0 or left + right >= width or top + bottom >= height:
        raise ValueError("crop must leave part of the original frame")
    crop = f"{width-left-right}x{height-top-bottom}+{left}+{top}"
    full = identifier + ".webp"
    thumb = identifier + "-thumb.webp"
    filename = f"{when}-{identifier}.md"
    entry = {
        "title": name, "target_id": target, "catalog_id": catalog, "kind": kind,
        "capture_id": identifier, "capture_date": when, "date_confirmed": options.confirm_date,
        "image": full, "thumbnail": thumb, "source_sha256": source_hash,
    }
    if options.seconds is not None:
        entry["integration_seconds"] = options.seconds
    if options.replay:
        entry["replay"] = identifier + ".mp4"
    metadata = yaml.safe_dump(entry, allow_unicode=True, sort_keys=False)
    image_dir = site / "assets" / "images"
    with TemporaryDirectory(dir=site) as directory:
        temp = Path(directory)
        pipeline = [source, "-auto-orient", "-crop", crop, "+repage"]
        if options.levels:
            black, white, gamma = options.levels
            if not (0 <= black < white <= 100 and gamma > 0):
                raise ValueError("--levels needs 0 ≤ black < white ≤ 100 and a positive gamma")
            pipeline.extend(("-level", f"{black}%,{white}%,{gamma}"))
        magick(*pipeline, "-strip", "-colorspace", "sRGB", "-define", "webp:method=5", "-quality", "91", temp / full)
        magick(temp / full, "-resize", "680x>", "-strip", "-quality", "84", temp / thumb)
        new_hash = digest(temp / full)
        if any(digest(image_dir / post["image"]) == new_hash for post in posts):
            raise ValueError("the rendered capture is already in the journal")
        (temp / filename).write_text(f"---\n{metadata}---\n\n{note}\n", encoding="utf-8")
        outputs = [(temp / full, image_dir / full), (temp / thumb, image_dir / thumb)]
        if options.replay:
            replay = entry["replay"]
            replay_file = options.replay.resolve(strict=True)
            run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-i",str(replay_file),
                 "-map","0:v:0","-map","0:a?","-vf","pad=ceil(iw/2)*2:ceil(ih/2)*2",
                 "-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",
                 str(temp / replay)], check=True)
            replays = site / "assets" / "replays"
            replays.mkdir(exist_ok=True)
            outputs.append((temp / replay, replays / replay))
        outputs.append((temp / filename, site / "_posts" / filename))
        written = []
        try:
            for src, dest in outputs:
                os.link(src, dest)
                written.append(dest)
        except OSError:
            for dest in written:
                dest.unlink()
            raise
    for _, output in outputs:
        print(output.relative_to(site))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--target", required=True, help="Target ID, such as m51")
    parser.add_argument("--date", required=True, type=date.fromisoformat, help="Local capture date, YYYY-MM-DD")
    parser.add_argument("--description", required=True, help="Observing note")
    parser.add_argument("--confirm-date", action="store_true", help="The date was verified")
    parser.add_argument("--seconds", type=int, help="Total integration in seconds")
    parser.add_argument("--name", help="Object name for a new target")
    parser.add_argument("--catalog", help="Catalog name for a new target, such as M27")
    parser.add_argument("--kind", choices=KINDS, help="Object type for a new target")
    parser.add_argument("--id", help="A custom ID for another capture of this target on the same date")
    parser.add_argument("--crop", nargs=4, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"), type=float,
                        default=(0, 0, 0, 0), help="Percent of frame trimmed at each edge")
    parser.add_argument("--levels", nargs=3, metavar=("BLACK", "WHITE", "GAMMA"), type=float,
                        help="Optional display stretch for a linear stacked source")
    parser.add_argument("--replay", type=Path, help="Optional Origin stacking replay video, converted using FFmpeg")
    parser.add_argument("--site", type=Path, default=SITE, help=argparse.SUPPRESS)
    options = parser.parse_args()
    try:
        add_capture(options)
    except (ValueError, OSError, CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
