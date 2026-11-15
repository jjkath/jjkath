# jjkath astrophotography

Celestron Origin captures and observing notes from Santa Fe, New Mexico. The project site is [jjkath.github.io/jjkath](https://jjkath.github.io/jjkath/).

## Review and publish

Apply the release on a branch based on `main`. Copy the files in this release into the repository root.

1. Open a pull request for the release branch. The Pages workflow builds a downloadable review artifact for pull requests.
2. In the existing repository, open **Settings → Pages → Build and deployment** and select **GitHub Actions** as the source when ready to cut over.
3. Merge the release branch into `main`. The workflow builds the static journal and deploys it to the existing Pages address. Check the **Actions** run and open the site to verify the release.

The build writes only the public site to `_site/`. It processes the catalog from `journal/_posts/` each time a capture is added. You can also build the release locally with Python 3.12 or later.

```bash
python3 -m pip install -r journal/requirements.txt
python3 journal/build.py --output _site --bundle AP_Blog_Preview.html
```

## Add new captures

From iPad, put the best originals and any Origin **Image Stacking Replay** recordings in a Drive folder. Include the target, local capture date, integration time when known, and a short observing note. Keep the original files in Drive.

On the computer preparing the update, use ImageMagick 7 with the relevant image codecs. Video import also uses FFmpeg with H.264 and AAC support.

```bash
python3 journal/add_capture.py /path/to/master.tiff --target m51 --date 2026-11-14 --confirm-date --seconds 1800 --description "The faint bridge toward the companion is visible in this exposure."
python3 journal/build.py --output _site --bundle AP_Blog_Preview.html
```

The importer keeps the native dimensions by default. When a capture needs edge cleanup, taper the affected areas to black on a full-size lossless working copy and keep the untouched master in Drive. Provide the working copy to the importer. Omit `--seconds` when the exposure is unavailable and use `--confirm-date` after verifying the date. Use `--name`, `--catalog`, and `--kind` for a new target or `--replay /path/to/recording.mov` for a real replay. The importer rejects exact duplicate sources and prepares a web image, a thumbnail, a full-resolution lossless file, and a Markdown post. To attach a replay to an existing capture, convert its recording to MP4, put it under `journal/assets/replays/`, and set the post's `replay` field to the file name.

Captures appear under the same target automatically. A new comparison date requires an aligned WebP on the target's comparison grid and an entry in `journal/alignments.json`. Object labels and sky footprints require a plate solution for the published frame in `journal/sky_fields.json`.

## Image and catalog data

Full screen loads the full-resolution lossless file for each capture. Fit shows the entire frame, and zoom lets you inspect details. Details lists the megapixels, frame size, and source metadata. Watermark toggles the object, observing date, and known integration time as a viewer overlay. Open full-resolution file opens the image by itself.

Compare Nights uses the field shared by the aligned captures. The 16-bit adjustment view of Andromeda uses resampled data from the full-frame TIFF. Open full-resolution file gives the native-size 16-bit PNG. The histogram plots source brightness and the selected display curve.

Object name and position records adapted from [OpenNGC](https://github.com/mattiaverga/OpenNGC) by Mattia Verga are available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The changes select objects on each solved image, project them to image positions, and add field outlines. Selected stellar coordinates are from [SIMBAD](https://simbad.u-strasbg.fr/simbad/) and [MAST](https://archive.stsci.edu/hut/stars.html). The online map uses [Aladin Lite](https://aladin.cds.unistra.fr/AladinLite/) from CDS, Strasbourg and the DSS2 color survey.
