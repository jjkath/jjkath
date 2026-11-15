(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const targets = JSON.parse(byId("catalog-data").textContent);
  const formatDate = new Intl.DateTimeFormat("en-US", {month:"long",day:"numeric",year:"numeric",timeZone:"UTC"});
  const dateLabel = (capture) => formatDate.format(new Date(capture.date + "T12:00:00Z"));
  const routeTo = (target, capture) => "#target/" + target.id + "/" + capture.id;
  const photo = (target, id) => target.captures.find((item) => item.id === id);
  const coverFor = (target) => photo(target, target.cover);
  const baseline = byId("baseline");
  const stage = byId("stage");
  const viewerFrame = byId("viewer-frame");
  const compactFullScreen = matchMedia("(max-width: 680px), (max-height: 500px) and (pointer: coarse)");
  const adjustmentPanel = byId("image-adjustments");
  const canvas = byId("adjusted");
  const nightImage = byId("night-image");
  const nightCanvas = byId("night-adjusted");
  const imageCache = new WeakMap();
  const histogramCache = new WeakMap();
  const skyOverlay = byId("object-overlay");
  const shortDate = new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
  const imageNumber = new Intl.NumberFormat("en-US",{maximumFractionDigits:1});

  const adjustmentDefaults = {
    midtone:0, black:0, white:100, saturation:100, structure:0, scale:"balanced", stars:0, smoothing:0, warm:0,
    stretch:"power"
  };
  const presets = [
    {id:"baseline", name:"Baseline", hint:"The cleaned capture with its saved color."},
    {id:"faint", name:"Reveal faint detail", midtone:51, black:.25, white:95, saturation:94,
      structure:19, smoothing:28, shoulder:10, skyLift:7,
      hint:"Lift dim signal across the frame with a gentle increase in local contrast."},
    {id:"nebula", name:"Nebula structure", midtone:44, black:.35, white:96, saturation:104, structure:46,
      scale:"broad", smoothing:29, stars:8, shoulder:14, skyLift:6,
      hint:"Bring out cloud edges, filaments, and dark pockets across a nebula."},
    {id:"galaxy", name:"Galaxy detail", midtone:34, black:.45, white:94, saturation:101, structure:43,
      scale:"fine", smoothing:26, shoulder:18, skyLift:5,
      hint:"Increase contrast in spiral arms, dust lanes, and small knots within a galaxy."},
    {id:"andromeda", name:"Andromeda look", stretch:"asinh", midtone:11, black:1.5, white:91,
      saturation:78, smoothing:18, structure:12, shoulder:38, skyLift:5,
      andromeda:{midtone:-9, black:2, white:87.9, saturation:48, smoothing:12, structure:0, warm:1},
      precision:{midtone:68, black:6.1, white:23.2, saturation:66, smoothing:29, structure:0, warm:2, shoulder:30},
      hint:"Inspired by the Origin HEIC. Lift the outer disk and dust lanes while softening bright cores."},
    {id:"hdr-core", name:"HDR core", stretch:"asinh", midtone:22, black:.6, saturation:96, structure:78,
      smoothing:26, skyLift:5, effect:"hdr", amountLabel:"Core compression",
      hint:"Soften bright extended cores while keeping faint surroundings visible. Try Orion or a bright galaxy."},
    {id:"local-contrast", name:"Local contrast", stretch:"asinh", midtone:13, black:1, saturation:96,
      structure:58, smoothing:24, shoulder:10, skyLift:5, effect:"local", amountLabel:"Local contrast",
      hint:"Adjust contrast within smaller regions to reveal dust lanes, spiral arms, and cloud edges."},
    {id:"nebula-colors", name:"Nebula colors", stretch:"asinh", midtone:21, black:.45, saturation:103,
      structure:59, smoothing:28, shoulder:10, skyLift:5, effect:"cloud-color", amountLabel:"Cloud color boost",
      hint:"Strengthen colors already present in the clouds while protecting the dark background and compact stars."},
    {id:"warm", name:"Warm nebula", midtone:42, black:.35, saturation:106, structure:34, scale:"broad",
      smoothing:30, stars:7, warm:14, shoulder:13, skyLift:5,
      hint:"Warm the bright clouds while keeping the sky and compact stars closer to their original colors."},
    {id:"contrast", name:"High contrast", midtone:24, black:1.1, white:87, saturation:105,
      structure:27, shoulder:10, skyLift:-1.5,
      hint:"Darken the sky and increase separation in brighter structure."},
    {id:"mono", name:"Monochrome", midtone:34, black:.65, white:94, saturation:0,
      structure:28, shoulder:11, skyLift:4,
      hint:"Inspect brightness and structure in grayscale."},
    {id:"false", name:"False color", midtone:34, black:.25, white:94, structure:24, smoothing:28, skyLift:4,
      hint:"Map brightness to a display palette. Colors represent intensity."}
  ];
  const numericControls = ["midtone", "black", "white", "saturation", "structure", "stars", "smoothing", "warm"];
  const presetControls = [...numericControls,"scale","stretch"];

  const paletteStops = {
    gold:[[0,[3,5,13]],[.22,[20,31,75]],[.43,[54,93,157]],[.65,[178,132,68]],[.86,[255,211,125]],[1,[255,246,220]]],
    teal:[[0,[3,8,13]],[.22,[15,50,67]],[.43,[36,113,126]],[.66,[163,64,88]],[.85,[238,122,123]],[1,[255,238,219]]],
    violet:[[0,[7,5,17]],[.22,[55,25,87]],[.43,[120,66,156]],[.66,[186,106,113]],[.85,[245,171,115]],[1,[255,239,209]]],
    inferno:[[0,[0,0,5]],[.22,[51,14,86]],[.43,[135,35,105]],[.64,[213,67,67]],[.86,[249,158,20]],[1,[252,255,164]]]
  };

  let kind = "All";
  let currentTarget = null;
  let currentCapture = null;
  let preset = presets[0];
  let renderQueued = false;
  let activeCompare = false;
  let compareNights = false;
  let blinkSide = null;
  let expanded = false;
  let showWatermark = false;
  let detailRequest = 0;
  let usePrecision = false;
  let precisionModel = null;
  let precisionRequest = 0;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let drag = null;

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function renderCards() {
    const query = byId("search").value.trim().toLocaleLowerCase().replace(/\s+/g, "");
    const filtered = targets.filter((target) => {
      const text = (target.name + " " + target.catalog).toLocaleLowerCase().replace(/\s+/g, "");
      return (kind === "All" || target.kind === kind) && (!query || text.includes(query));
    });
    byId("result-count").textContent = filtered.length + (filtered.length === 1 ? " target" : " targets");
    const cards = byId("cards");
    if (!filtered.length) {
      cards.replaceChildren(element("p", "empty", "No targets match this search."));
      return;
    }
    const entries = filtered.map((target) => {
      const cover = coverFor(target);
      const link = element("a", "card");
      link.href = routeTo(target, cover);
      const imageWrap = element("span", "card-image");
      const image = element("img");
      image.src = cover.thumb;
      image.alt = "";
      image.loading = "lazy";
      imageWrap.append(image);
      const body = element("div", "card-body");
      const title = element("div");
      title.append(element("p", "card-meta", target.catalog), element("h3", "", target.name));
      body.append(title, element("span", "card-count", target.captures.length + (target.captures.length === 1 ? " capture" : " captures")));
      link.append(imageWrap, body);
      return link;
    });
    cards.replaceChildren(...entries);
  }

  function buildFilters() {
    for (const name of ["All","Galaxies","Nebulae","Star clusters","Galaxy clusters"]) {
      const button = element("button", "", name);
      button.type = "button";
      button.setAttribute("aria-pressed", String(name === kind));
      button.addEventListener("click", () => {
        kind = name;
        for (const sibling of byId("filters").children) sibling.setAttribute("aria-pressed", String(sibling === button));
        renderCards();
      });
      byId("filters").append(button);
    }
  }

  function renderCaptureNotes(target, capture) {
    byId("capture-description").textContent = capture.description;
    const data = byId("capture-data");
    const rows = [
      [capture.confirmed ? "Captured" : "Image date", dateLabel(capture), !capture.confirmed],
      ["Telescope","Celestron Origin"],
      ["Location","Santa Fe, NM"]
    ];
    if (capture.seconds) {
      const minutes = capture.seconds / 60;
      rows.push(["Integration", minutes + " min · " + capture.seconds + " s"]);
    }
    data.replaceChildren(...rows.flatMap(([label,value,provisional]) => {
      return [element("dt","",label),element("dd",provisional ? "date-note" : "",provisional ? value + " · date to confirm" : value)];
    }));
    const strip = byId("capture-strip");
    strip.hidden = target.captures.length < 2;
    if (strip.hidden) return;
    byId("captures-title").textContent = "More captures of this target";
    const choices = target.captures.map((item) => {
      const entry = element("a", "capture-choice");
      entry.href = routeTo(target, item);
      if (item === capture) entry.setAttribute("aria-current","true");
      const image = element("img");
      image.src = item.thumb;
      image.alt = "";
      image.loading = "lazy";
      entry.append(image,element("span","",dateLabel(item) + (item.confirmed ? "" : " · provisional")));
      return entry;
    });
    byId("capture-choices").replaceChildren(...choices);
  }

  function updateCompare() {
    const splitVisible = activeCompare || compareNights;
    byId("compare").setAttribute("aria-pressed", String(activeCompare));
    byId("compare-nights").setAttribute("aria-pressed", String(compareNights));
    byId("compare-overlay").hidden = !splitVisible;
    byId("compare-range").hidden = !splitVisible;
    byId("before-label").hidden = blinkSide === "right";
    byId("after-label").hidden = blinkSide === "left";
    byId("split-line").hidden = Boolean(blinkSide);
    byId("night-split").hidden = !blinkSide;
    stage.classList.toggle("compare-active",splitVisible);
    stage.classList.toggle("night-active",compareNights);
    const split = blinkSide === "left" ? "100" : blinkSide === "right" ? "0" : byId("split").value;
    stage.style.setProperty("--split", split + "%");
  }

  function setImageSource(image, source, alt) {
    image.alt = alt;
    if (image.getAttribute("src") === source) return;
    imageCache.delete(image);
    histogramCache.delete(image);
    image.src = source;
  }

  function nightLabel(capture) {
    return shortDate.format(new Date(capture.date + "T12:00:00Z")) + (capture.confirmed ? "" : " · provisional");
  }

  function syncNights() {
    const left = photo(currentTarget, byId("night-left").value);
    const right = photo(currentTarget, byId("night-right").value);
    const comparison = currentTarget.comparison;
    for (const option of byId("night-left").options) option.disabled = option.value === right.id;
    for (const option of byId("night-right").options) option.disabled = option.value === left.id;
    setImageSource(baseline, comparison.captures[left.id], currentTarget.name + " · " + dateLabel(left));
    setImageSource(nightImage, comparison.captures[right.id], currentTarget.name + " · " + dateLabel(right));
    byId("adjusted-layer").hidden = true;
    byId("night-layer").hidden = true;
    byId("before-label").textContent = nightLabel(left);
    byId("after-label").textContent = nightLabel(right);
    const notes = [left,right].map((capture) => {
      const panel = element("section");
      const label = nightLabel(capture) + (capture.seconds ? " · " + capture.seconds + " s" : "");
      panel.append(element("h2","",label),element("p","",capture.description));
      return panel;
    });
    byId("night-notes").replaceChildren(...notes);
    blinkSide = null;
    updateNightStatus();
    updateCompare();
    queueRender();
  }

  function updateNightStatus() {
    const selected = blinkSide && photo(currentTarget, byId("night-" + blinkSide).value);
    byId("night-status").textContent = selected ? "Showing " + nightLabel(selected) : "Showing the field shared by both captures.";
  }

  function setNightMode(enabled) {
    detailRequest++;
    byId("detail-status").hidden = true;
    if (enabled && usePrecision) setPrecision(false);
    compareNights = enabled;
    activeCompare = false;
    blinkSide = null;
    byId("split").value = "50";
    byId("night-options").hidden = !enabled;
    byId("night-blink").hidden = !enabled;
    byId("night-status").hidden = !enabled;
    byId("night-notes").hidden = !enabled;
    byId("single-notes").hidden = enabled;
    byId("target-count").hidden = enabled;
    byId("compare").hidden = enabled;
    byId("split-label").textContent = enabled ? "Observing nights divider" : "Before and after divider";
    byId("adjusted-layer").hidden = true;
    byId("night-layer").hidden = true;
    if (enabled) {
      for (const side of ["left", "right"]) {
        const select = byId("night-" + side);
        const captures = currentTarget.captures.filter((capture) => currentTarget.comparison.captures[capture.id]);
        select.replaceChildren(...captures.map((capture) => {
          const duration = capture.seconds ? " · " + capture.seconds + " s" : "";
          return new Option(nightLabel(capture) + duration, capture.id);
        }));
      }
      const defaults = currentTarget.comparison.default;
      const chosen = currentTarget.comparison.captures[currentCapture.id] ? currentCapture.id : defaults[1];
      byId("night-left").value = chosen === defaults[0] ? defaults[1] : defaults[0];
      byId("night-right").value = chosen;
      stage.style.aspectRatio = currentTarget.comparison.width + " / " + currentTarget.comparison.height;
      syncNights();
    } else {
      nightImage.removeAttribute("src");
      imageCache.delete(nightImage);
      stage.style.removeProperty("aspect-ratio");
      byId("before-label").textContent = "Baseline";
      byId("after-label").textContent = "Adjusted";
      setImageSource(baseline, currentCapture.full, currentTarget.name + " · " + dateLabel(currentCapture));
      updateCompare();
      queueRender();
    }
    syncCaptureTools();
    if (expanded) loadDetail();
    setZoom(1);
  }

  function syncCaptureTools() {
    skyAtlas.update(currentCapture?.sky,baseline,compareNights);
    const hasSource = !compareNights && Boolean(currentCapture?.precision);
    byId("precision").hidden = !hasSource;
    byId("precision").setAttribute("aria-pressed",String(usePrecision));
    byId("replay").hidden = compareNights || !currentCapture?.replay;
    const file = byId("detail-file");
    const detail = currentCapture?.detail;
    file.hidden = compareNights || !detail?.url;
    if (detail?.url) file.href = detail.url;
    else file.removeAttribute("href");
    byId("show-details").hidden = compareNights;
    updateWatermark();
  }

  function updateWatermark() {
    const stamp = byId("watermark");
    const button = byId("show-watermark");
    button.hidden = compareNights;
    button.setAttribute("aria-pressed",String(showWatermark));
    stamp.hidden = !showWatermark || !currentCapture || compareNights || !baseline.naturalWidth;
    if (stamp.hidden) return;
    const {naturalWidth, naturalHeight} = baseline;
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    const fit = Math.min(width/naturalWidth,height/naturalHeight) * zoom;
    stamp.style.setProperty("--stamp-left",Math.max(8, 8+panX+(width-naturalWidth*fit)/2)+"px");
    stamp.style.setProperty("--stamp-bottom",Math.max(8, 8-panY+(height-naturalHeight*fit)/2)+"px");
    const {name, catalog} = currentTarget;
    byId("watermark-object").textContent = name === catalog ? name : name + " / " + catalog;
    const date = shortDate.format(new Date(currentCapture.date + "T12:00:00Z"));
    const duration = currentCapture.seconds ? " · " + currentCapture.seconds.toLocaleString("en-US") + " s" : "";
    byId("watermark-session").textContent = "Celestron Origin · " + date + duration;
    const art = byId("watermark-art");
    const url = currentCapture.watermark;
    if (art.getAttribute("src") !== (url ?? null)) {
      art.hidden = true;
      stamp.classList.remove("has-artwork");
      if (url) art.src = url;
      else art.removeAttribute("src");
    }
  }

  function toggleAdjustments(open, focus = false) {
    const button = byId("toggle-adjustments");
    adjustmentPanel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (focus) (open ? byId("adjust-heading") : button).focus({preventScroll:open || !compactFullScreen.matches});
  }

  function showViewerTools(open) {
    const button = byId("toggle-viewer-tools");
    viewerFrame.classList.toggle("tools-open", open);
    button.setAttribute("aria-expanded", String(open));
    button.textContent = expanded ? (open ? "Hide controls" : "Controls") : (open ? "Less" : "More");
  }

  function loadDetail() {
    const capture = currentCapture;
    const detail = capture?.detail;
    if (!expanded || !detail?.url || compareNights) return;
    const request = ++detailRequest;
    const status = byId("detail-status");
    const ready = detail.width + " × " + detail.height + " · Lossless";
    status.hidden = false;
    if (baseline.getAttribute("src") === detail.url) {
      status.textContent = ready;
      return;
    }
    status.textContent = "Loading full-resolution image…";
    const image = new Image();
    image.onload = () => {
      if (request !== detailRequest || !expanded || capture !== currentCapture || compareNights) return;
      setImageSource(baseline,detail.url,baseline.alt);
      status.textContent = ready;
    };
    image.onerror = () => {
      if (request === detailRequest) status.textContent = "Full-resolution file unavailable. Showing the web image.";
    };
    image.src = detail.url;
  }

  function openImageDetails() {
    const capture = currentCapture;
    if (!capture || compareNights) return;
    const detail = capture.detail;
    const width = detail?.width || baseline.naturalWidth;
    const height = detail?.height || baseline.naturalHeight;
    const rows = [];
    if (width && height) {
      const mp = imageNumber.format(width*height/1e6);
      rows.push(["Resolution",mp+" MP · "+imageNumber.format(width)+" × "+imageNumber.format(height)+" px"]);
    }
    if (detail?.source) rows.push(["Source format",detail.source]);
    if (detail?.source_file) rows.push(["Source filename",detail.source_file]);
    if (detail?.source_bytes) rows.push(["Source file size",imageNumber.format(detail.source_bytes/1e6)+" MB"]);
    rows.push(["Capture date",dateLabel(capture)+(capture.confirmed ? "" : " · provisional")]);
    if (capture.seconds) rows.push(["Integration",imageNumber.format(capture.seconds)+" s"]);
    if (detail?.depth) rows.push(["Lossless image",detail.depth+"-bit "+(detail.file.endsWith(".png") ? "PNG" : "WebP")]);
    byId("details-object").textContent = currentTarget.name;
    byId("details-fields").replaceChildren(...rows.flatMap(([name,value])=>[
      element("dt","",name), element("dd","",value)
    ]));
    byId("image-details").showModal();
  }

  function displayExpanded(enabled, fallback=false) {
    const wasExpanded = expanded;
    expanded = enabled;
    viewerFrame.classList.toggle("expanded",enabled);
    viewerFrame.classList.toggle("viewport-fill",enabled && fallback);
    document.body.classList.toggle("viewer-expanded",enabled);
    const button = byId("fullscreen-image");
    byId("expand-capture").hidden = enabled;
    byId("toggle-adjustments").hidden = enabled;
    button.hidden = !enabled;
    if (wasExpanded !== enabled) showViewerTools(false);
    if (enabled) toggleAdjustments(false);
    if (enabled) loadDetail();
    else {
      detailRequest++;
      byId("detail-status").hidden = true;
    }
    requestAnimationFrame(()=>{
      showZoom();
      if (wasExpanded !== enabled && currentCapture && !byId("target-view").hidden) {
        (enabled ? button : byId("expand-capture")).focus({preventScroll:true});
      }
    });
  }

  async function toggleExpanded() {
    if (expanded) {
      if (document.fullscreenElement === viewerFrame) await document.exitFullscreen();
      else displayExpanded(false);
      return;
    }
    try {
      if (typeof viewerFrame.requestFullscreen === "function" && document.fullscreenEnabled) {
        await viewerFrame.requestFullscreen();
        return;
      }
    } catch {
      // Browser chrome stays visible when only viewport expansion is available.
    }
    displayExpanded(true,true);
  }

  function setPrecision(enabled) {
    usePrecision = enabled;
    const request = ++precisionRequest;
    const status = byId("precision-status");
    status.hidden = !enabled;
    status.textContent = enabled ? "Loading the 16-bit source…" : "";
    syncCaptureTools();
    choosePreset(preset);
    if (!enabled) return;

    const source = currentCapture.precision;
    astroProcessing.loadPrecision(source).then((model)=>{
      if (request !== precisionRequest) return;
      precisionModel = model;
      imageCache.delete(baseline);
      status.textContent = "16-bit source active. Use Histogram & stretch to adjust its display.";
      queueRender();
    }).catch(error=>{
      if (request !== precisionRequest) return;
      setPrecision(false);
      status.hidden = false;
      status.textContent = error.message;
    });
  }

  function activeSettings() {
    const settings = Object.fromEntries(numericControls.map((id) => [id, Number(byId(id).value)]));
    settings.scale = byId("scale").value;
    settings.stretch = byId("stretch").value;
    settings.protect = byId("highlights").checked;
    settings.monochrome = preset.id === "mono";
    settings.precision = usePrecision && Boolean(precisionModel);
    settings.effect = preset.effect;
    settings.skyLift = currentTarget?.id === "m31" && preset.andromeda ? null : preset.skyLift;
    settings.shoulder = (settings.precision ? preset.precision?.shoulder : null) ?? preset.shoulder ?? 0;
    return settings;
  }

  function isAdjusted(settings) {
    return settings.precision || settings.monochrome || settings.shoulder > 0 || settings.stretch !== "power" ||
      preset.id === "false" || numericControls.some((id) => settings[id] !== adjustmentDefaults[id]);
  }

  function choosePreset(next) {
    preset = next;
    const source = usePrecision ? currentCapture.precision : null;
    const tuned = currentTarget?.id === "m31" && next.andromeda ? (source ? next.precision : next.andromeda) : null;
    byId("white").min = "1";
    for (const id of presetControls) byId(id).value = tuned?.[id] ?? source?.[id] ?? next[id] ?? adjustmentDefaults[id];
    byId("structure-value").previousSibling.textContent = (next.amountLabel || "Structure strength") + " ";
    const usesPalette = next.id === "false";
    byId("palette-control").hidden = !usesPalette;
    byId("saturation").disabled = usesPalette || next.id === "mono";
    byId("warm").disabled = usesPalette || next.id === "mono";
    const isNebula = currentTarget?.kind === "Nebulae";
    const isGalaxy = currentTarget?.kind === "Galaxies";
    const hint = next.id === "baseline" && isNebula ? "Try Nebula structure to bring out faint clouds."
      : next.id === "baseline" && isGalaxy ? "Try Galaxy detail to bring out arms and dust lanes." : next.hint;
    byId("processing-hint").textContent = hint;
    for (const button of byId("presets").children) {
      button.setAttribute("aria-pressed",String(button.dataset.preset === next.id));
    }
    queueRender();
  }

  function makePalette(name) {
    const stops = paletteStops[name];
    const out = new Uint8ClampedArray(256 * 3);
    let segment = 0;
    for (let i=0;i<256;i++) {
      const level = i / 255;
      while (segment < stops.length - 2 && level > stops[segment + 1][0]) segment++;
      const [low, a] = stops[segment];
      const [high, b] = stops[segment + 1];
      const fraction = (level - low) / (high - low);
      for (let channel=0;channel<3;channel++) out[i*3+channel] = a[channel] + fraction * (b[channel]-a[channel]);
    }
    return out;
  }

  function renderAdjusted(image, output, settings, palette) {
    const context = output.getContext("2d", {willReadFrequently:true});
    if (!context || !image.complete || !image.naturalWidth) return false;
    let cache = imageCache.get(image);
    const precision = settings.precision && image === baseline;
    if (!cache || cache.precision !== precision) {
      const source = currentCapture?.precision;
      const scale = Math.min(1, 1920 / Math.max(image.naturalWidth, image.naturalHeight));
      output.width = precision ? source.width : Math.round(scale * image.naturalWidth);
      output.height = precision ? source.height : Math.round(scale * image.naturalHeight);
      context.drawImage(image,0,0,output.width,output.height);
      cache = {
        model:precision ? precisionModel : astroProcessing.prepare(context.getImageData(0,0,output.width,output.height)),
        work:context.createImageData(output.width,output.height), precision
      };
      imageCache.set(image,cache);
    }
    const toneReference = compareNights && image === nightImage ? imageCache.get(baseline)?.model : undefined;
    astroProcessing.render(cache.model,cache.work.data,settings,palette,toneReference);
    context.putImageData(cache.work,0,0);
    return true;
  }

  function brightnessBins(settings) {
    const count = 128;
    if (settings.precision && precisionModel.histogram) return precisionModel.histogram;
    if (!settings.precision && histogramCache.has(baseline)) return histogramCache.get(baseline);
    const bins = new Uint32Array(count);
    if (settings.precision) {
      const values = precisionModel.luminance;
      for (let i=0;i<values.length;i+=3) bins[Math.min(count-1,Math.floor(values[i] * count / 256))]++;
      precisionModel.histogram = bins;
    } else {
      if (!baseline.complete || !baseline.naturalWidth) return bins;
      const sample = document.createElement("canvas");
      sample.width = 360;
      sample.height = Math.round(360*baseline.naturalHeight/baseline.naturalWidth);
      const context = sample.getContext("2d");
      context.drawImage(baseline,0,0,sample.width,sample.height);
      const rgb = context.getImageData(0,0,sample.width,sample.height).data;
      for (let i=0;i<rgb.length;i+=4) {
        const lum = .2126*rgb[i] + .7152*rgb[i+1] + .0722*rgb[i+2];
        bins[Math.min(count-1,Math.floor(lum * count / 256))]++;
      }
      histogramCache.set(baseline,bins);
    }
    return bins;
  }

  function drawHistogram(settings) {
    if (!byId("tone-controls").open) return;
    const chart = byId("histogram");
    const canvas = chart.getContext("2d");
    const {width,height} = chart;
    const bins = brightnessBins(settings);
    const maximum = Math.log1p(Math.max(1,...bins));
    canvas.clearRect(0,0,width,height);
    const baselineY = height - 11;
    const chartHeight = height - 22;
    canvas.fillStyle = "#59647c";
    bins.forEach((value,index)=>{
      const y = Math.log1p(value)/maximum * chartHeight;
      canvas.fillRect(index * width / bins.length, baselineY-y, width/bins.length, y);
    });
    canvas.beginPath();
    canvas.strokeStyle = "#f9d291";
    canvas.lineWidth = 3;
    const model = settings.precision ? precisionModel : imageCache.get(baseline)?.model;
    const curve = astroProcessing.toneCurve(settings,model);
    for (let x=0;x<width;x++) {
      const y = baselineY - chartHeight * curve[Math.round(255*x/(width-1))]/255;
      if (x === 0) canvas.moveTo(x,y);
      else canvas.lineTo(x,y);
    }
    canvas.stroke();
    for (const [position,color] of [[settings.black,"#aabbf5"],[settings.white,"#e8eaf1"]]) {
      canvas.fillStyle = color;
      canvas.fillRect(Math.min(width - 3, width * position / 100), 4, 2, height - 8);
    }
  }

  function renderImage() {
    renderQueued = false;
    byId("white").min = String(Math.max(1, Number(byId("black").value) + .1));
    const settings = activeSettings();
    byId("midtone-value").value = (settings.midtone > 0 ? "+" : "") + settings.midtone;
    for (const id of numericControls.slice(1)) byId(id + "-value").value = settings[id] + "%";
    const adjusted = isAdjusted(settings) && (!usePrecision || settings.precision);
    const palette = preset.id === "false" ? makePalette(byId("palette").value) : null;
    const visible = adjusted && renderAdjusted(baseline,canvas,settings,palette);
    byId("adjusted-layer").hidden = !visible;
    byId("compare").disabled = !visible;
    if (!isAdjusted(settings) && !usePrecision) activeCompare = false;
    if (compareNights) {
      byId("night-layer").hidden = !nightImage.complete || !nightImage.naturalWidth;
      nightCanvas.hidden = !(adjusted && renderAdjusted(nightImage,nightCanvas,settings,palette));
    }
    drawHistogram(settings);
    updateCompare();
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderImage);
  }

  function showZoom() {
    const limitX = Math.max(0,stage.clientWidth*(zoom-1)/2);
    const limitY = Math.max(0,stage.clientHeight*(zoom-1)/2);
    panX = Math.max(-limitX,Math.min(limitX,panX));
    panY = Math.max(-limitY,Math.min(limitY,panY));
    const transform = "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")";
    for (const layer of [baseline,canvas,nightImage,nightCanvas,skyOverlay]) layer.style.transform = transform;
    stage.classList.toggle("pannable",zoom>1);
    stage.classList.toggle("expandable",!expanded && zoom <= 1 && !activeCompare && !compareNights);
    updateWatermark();
    byId("zoom-out").disabled = zoom <= 1;
    byId("zoom-in").disabled = zoom >= 4;
    byId("zoom-fit").textContent = zoom > 1 ? Math.round(zoom * 100) + "%" : "Fit";
  }

  function setZoom(next) {
    zoom = Math.min(4, Math.max(1,next));
    showZoom();
    byId("stage-status").textContent = "Image zoom " + Math.round(zoom*100) + " percent";
  }

  function openCapture(target, capture) {
    const previousTarget = currentTarget;
    currentTarget = target;
    currentCapture = capture;
    toggleAdjustments(false);
    if (!expanded) showViewerTools(false);
    const detail = capture.detail;
    stage.style.setProperty("--frame-ratio", detail ? detail.width + " / " + detail.height : "1.79");
    usePrecision = false;
    precisionModel = null;
    precisionRequest++;
    byId("precision-status").hidden = true;
    skyAtlas.setLabels(false);
    byId("palette").value = "gold";
    byId("highlights").checked = true;
    choosePreset(presets[0]);
    byId("adjusted-layer").hidden = true;
    byId("target-catalog").textContent = target.catalog + " · " + target.kind;
    byId("target-title").textContent = target.name;
    byId("target-count").textContent = (target.captures.indexOf(capture)+1) + " of " + target.captures.length;
    renderCaptureNotes(target,capture);
    byId("home-view").hidden = true;
    byId("target-view").hidden = false;
    byId("compare-nights").hidden = !target.comparison;
    setNightMode(false);
    if (previousTarget !== target) {
      window.scrollTo(0,0);
      byId("target-title").focus({preventScroll:true});
    }
    document.title = target.name + " | jjkath astrophotography";
  }

  function handleRoute() {
    const [hash, shared] = (location.hash.slice(1) || "home").split("?",2);
    const [, targetId, captureId] = hash.split("/");
    const target = hash.startsWith("target/") && targets.find((item) => item.id === targetId);
    if (target) {
      const capture = photo(target,captureId) || coverFor(target);
      if (capture !== currentCapture) openCapture(target,capture);
      if (shared) restoreView(new URLSearchParams(shared));
      return;
    }
    if (expanded) toggleExpanded();
    currentTarget = null;
    currentCapture = null;
    byId("target-view").hidden = true;
    byId("home-view").hidden = false;
    document.title = "jjkath astrophotography";
    const section = hash === "catalog" || hash === "about" ? byId(hash) : null;
    if (section) {
      section.focus({preventScroll:true});
      section.scrollIntoView();
    } else window.scrollTo(0,0);
  }

  function viewLink() {
    const fallback = "https://jjkath.github.io/jjkath/";
    const url = new URL(location.protocol === "file:" || location.hostname === "127.0.0.1" ? fallback : location.href);
    const options = new URLSearchParams({
      preset:preset.id, palette:byId("palette").value, zoom:zoom.toFixed(3),
      x:(panX / (stage.clientWidth || 1)).toFixed(4), y:(panY / (stage.clientHeight || 1)).toFixed(4)
    });
    for (const id of presetControls) options.set(id,byId(id).value);
    if (!byId("highlights").checked) options.set("stars-color","off");
    if (usePrecision) options.set("precision","true");
    if (skyAtlas.hasLabels()) options.set("labels","true");
    if (compareNights) {
      options.set("left",byId("night-left").value);
      options.set("right",byId("night-right").value);
      if (blinkSide) options.set("blink",blinkSide);
    } else if (activeCompare) options.set("compare","true");
    if (compareNights || activeCompare) options.set("split",byId("split").value);
    url.hash = routeTo(currentTarget,currentCapture) + "?" + options.toString();
    return url.href;
  }

  function restoreView(options) {
    const chosen = presets.find(item=>item.id === options.get("preset")) || presets[0];
    const left = options.get("left");
    const right = options.get("right");
    const available = currentTarget.comparison?.captures;
    const nights = left !== right && Boolean(available && Object.hasOwn(available,left) && Object.hasOwn(available,right));
    setNightMode(nights);
    if (nights) {
      byId("night-left").value = left;
      byId("night-right").value = right;
      syncNights();
      if (["left","right"].includes(options.get("blink"))) blinkSide = options.get("blink");
      updateNightStatus();
    }
    const precision = Boolean(currentCapture.precision) && !nights && options.get("precision") === "true";
    if (precision !== usePrecision) setPrecision(precision);
    choosePreset(chosen);
    if (Object.hasOwn(paletteStops,options.get("palette"))) byId("palette").value = options.get("palette");
    byId("highlights").checked = options.get("stars-color") !== "off";
    for (const id of presetControls) {
      const value = options.get(id);
      if (value === null) continue;
      const control = byId(id);
      if (control.tagName === "SELECT" ? [...control.options].some(o=>o.value === value) : Number.isFinite(Number(value))) {
        control.value = value;
      }
    }
    byId("split").value = options.get("split") || "50";
    activeCompare = !nights && options.get("compare") === "true";
    skyAtlas.setLabels(options.get("labels") === "true" && Boolean(currentCapture.sky));
    syncCaptureTools();
    const boundedOffset = (name) => {
      const n = Number(options.get(name));
      return Number.isFinite(n) ? Math.max(-1.5, Math.min(1.5,n)) : 0;
    };
    panX = boundedOffset("x") * stage.clientWidth;
    panY = boundedOffset("y") * stage.clientHeight;
    const next = Number(options.get("zoom"));
    setZoom(Number.isFinite(next) ? next : 1);
    updateCompare();
    queueRender();
  }

  buildFilters();
  renderCards();
  byId("catalog-count").textContent = targets.length + " targets · " + targets.reduce((sum,target)=>sum+target.captures.length,0) + " captures";
  byId("hero-image").src = coverFor(targets.find((target)=>target.id==="flaming-star")).full;
  byId("search").addEventListener("input",renderCards);

  for (const item of presets) {
    const button = element("button","",item.name);
    button.type = "button";
    button.dataset.preset = item.id;
    button.addEventListener("click",()=>choosePreset(item));
    byId("presets").append(button);
  }
  choosePreset(presets[0]);
  for (const id of [...presetControls,"highlights","palette"]) {
    byId(id).addEventListener("input",queueRender);
    byId(id).addEventListener("change",queueRender);
  }
  baseline.addEventListener("load",()=>{ syncCaptureTools(); queueRender(); });
  byId("expand-capture").addEventListener("click",toggleExpanded);
  byId("toggle-adjustments").addEventListener("click",()=>toggleAdjustments(adjustmentPanel.hidden,true));
  byId("close-adjustments").addEventListener("click",()=>toggleAdjustments(false,true));
  byId("toggle-viewer-tools").addEventListener("click",()=>showViewerTools(!viewerFrame.classList.contains("tools-open")));
  byId("watermark-art").addEventListener("load",()=>{
    byId("watermark-art").hidden = false;
    byId("watermark").classList.add("has-artwork");
  });
  byId("show-details").addEventListener("click",openImageDetails);
  byId("show-watermark").addEventListener("click",()=>{
    showWatermark = !showWatermark;
    updateWatermark();
  });
  byId("fullscreen-image").addEventListener("click",toggleExpanded);
  document.addEventListener("fullscreenchange",()=>{
    if (!viewerFrame.classList.contains("viewport-fill")) displayExpanded(document.fullscreenElement === viewerFrame);
  });
  document.addEventListener("keydown",event=>{
    if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
    if (!adjustmentPanel.hidden) toggleAdjustments(false,true);
    else if (viewerFrame.classList.contains("viewport-fill")) displayExpanded(false);
  });
  nightImage.addEventListener("load",queueRender);
  byId("tone-controls").addEventListener("toggle",queueRender);
  byId("precision").addEventListener("click",()=>setPrecision(!usePrecision));
  byId("objects").addEventListener("click",()=>{
    skyAtlas.setLabels(!skyAtlas.hasLabels());
    syncCaptureTools();
    byId("sky-status").textContent = skyAtlas.hasLabels() ? currentCapture.sky.objects.map(obj=>obj.label).join(", ") : "Object labels hidden.";
  });
  byId("sky-map").addEventListener("click",()=>skyAtlas.openMap(currentTarget.name));
  byId("replay").addEventListener("click",()=>{
    byId("replay-video").src = currentCapture.replay;
    byId("replay-dialog").showModal();
  });
  byId("replay-dialog").addEventListener("close",()=>{
    const video = byId("replay-video");
    video.pause();
    video.removeAttribute("src");
    video.load();
  });
  byId("share-view").addEventListener("click",()=>{
    byId("view-link").value = viewLink();
    byId("share-status").textContent = location.protocol === "file:" || location.hostname === "127.0.0.1"
      ? "This link opens the view after the release is published." : "";
    byId("share-dialog").showModal();
  });
  byId("copy-view").addEventListener("click",async()=>{
    const link = byId("view-link");
    try {
      await navigator.clipboard.writeText(link.value);
      byId("share-status").textContent = "Link copied.";
    } catch {
      link.select();
      byId("share-status").textContent = "Select Copy to save the link.";
    }
  });
  byId("reset").addEventListener("click",()=>{
    byId("palette").value = "gold";
    byId("highlights").checked = true;
    activeCompare = false;
    blinkSide = null;
    byId("split").value = "50";
    choosePreset(presets[0]);
    if (compareNights) updateNightStatus();
    setZoom(1);
  });
  byId("compare").addEventListener("click",()=>{
    activeCompare = !activeCompare;
    updateCompare();
  });
  byId("compare-nights").addEventListener("click",()=>setNightMode(!compareNights));
  for (const side of ["left","right"]) byId("night-" + side).addEventListener("change",syncNights);
  byId("night-blink").addEventListener("click",()=>{
    blinkSide = blinkSide === "left" ? "right" : blinkSide === "right" ? "left" : "right";
    updateNightStatus();
    updateCompare();
  });
  function showSplit() {
    blinkSide = null;
    if (compareNights) updateNightStatus();
    updateCompare();
  }
  byId("night-split").addEventListener("click",showSplit);
  byId("split").addEventListener("input",showSplit);
  byId("zoom-out").addEventListener("click",()=>setZoom(zoom/1.4));
  byId("zoom-fit").addEventListener("click",()=>setZoom(1));
  byId("zoom-in").addEventListener("click",()=>setZoom(zoom*1.4));
  stage.addEventListener("click",()=>{
    if (!adjustmentPanel.hidden) {
      toggleAdjustments(false);
      return;
    }
    if (zoom > 1 || activeCompare || compareNights) return;
    if (!expanded) toggleExpanded();
    else if (compactFullScreen.matches) showViewerTools(!viewerFrame.classList.contains("tools-open"));
  });
  function moveDivider(clientX) {
    const bounds = stage.getBoundingClientRect();
    byId("split").value = Math.round(100 * (clientX - bounds.left) / bounds.width);
    showSplit();
  }
  stage.addEventListener("pointerdown",(event)=>{
    if (!event.isPrimary || (zoom <= 1 && !activeCompare && !compareNights)) return;
    drag = {id:event.pointerId,x:event.clientX-panX,y:event.clientY-panY,divider:zoom <= 1};
    stage.setPointerCapture(event.pointerId);
    if (drag.divider) {
      moveDivider(event.clientX);
      return;
    }
    stage.classList.add("panning");
  });
  stage.addEventListener("pointermove",(event)=>{
    if (drag?.id !== event.pointerId) return;
    if (drag.divider) {
      moveDivider(event.clientX);
      return;
    }
    panX = event.clientX-drag.x;
    panY = event.clientY-drag.y;
    showZoom();
  });
  for (const type of ["pointerup","pointercancel","lostpointercapture"]) stage.addEventListener(type,(event)=>{
    if (drag?.id !== event.pointerId) return;
    drag = null;
    stage.classList.remove("panning");
  });
  window.addEventListener("resize",showZoom);
  window.addEventListener("hashchange",handleRoute);
  handleRoute();
})();
