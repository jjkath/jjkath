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
  const viewerRail = byId("viewer-rail");
  const viewerOptions = byId("viewer-options");
  const scrollTools = byId("scroll-viewer-tools");
  const compactFullScreen = matchMedia("(max-width: 680px), (max-width: 950px) and (max-height: 500px)");
  const touchScreen = matchMedia("(any-pointer: coarse)");
  const narrowWebb = matchMedia("(max-width: 680px)");
  const webbDialog = byId("webb-dialog");
  const webbReference = byId("webb-reference");
  const webbImagePage = byId("webb-image-page");
  const webbImage = byId("webb-image-full");
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
    {id:"webb-cool", name:"Webb Cool", stretch:"asinh", midtone:15, black:.45, white:96, saturation:90,
      structure:40, smoothing:27, shoulder:22, skyLift:5, paletteBlend:64,
      hint:"Map faint structure to blue and brighter detail to gold. A Webb-inspired palette for visible-light data."},
    {id:"webb-dust", name:"Webb Dust", stretch:"asinh", midtone:21, black:.35, white:95, saturation:98,
      structure:48, scale:"broad", smoothing:31, stars:9, shoulder:24, skyLift:5, paletteBlend:72,
      hint:"Use rose and copper to pick out wisps and dust lanes. A Webb-inspired palette for visible-light data."},
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
  const lookPrefix = "jjkath.saved-look.v1.";

  const paletteStops = {
    gold:[[0,[3,5,13]],[.22,[20,31,75]],[.43,[54,93,157]],[.65,[178,132,68]],[.86,[255,211,125]],[1,[255,246,220]]],
    teal:[[0,[3,8,13]],[.22,[15,50,67]],[.43,[36,113,126]],[.66,[163,64,88]],[.85,[238,122,123]],[1,[255,238,219]]],
    violet:[[0,[7,5,17]],[.22,[55,25,87]],[.43,[120,66,156]],[.66,[186,106,113]],[.85,[245,171,115]],[1,[255,239,209]]],
    inferno:[[0,[0,0,5]],[.22,[51,14,86]],[.43,[135,35,105]],[.64,[213,67,67]],[.86,[249,158,20]],[1,[252,255,164]]],
    "webb-cool":[[0,[8,16,42]],[.16,[45,95,201]],[.34,[61,147,191]],[.53,[172,147,114]],[.75,[241,175,93]],[1,[255,242,207]]],
    "webb-dust":[[0,[25,13,41]],[.16,[92,48,108]],[.35,[176,69,105]],[.55,[227,118,63]],[.76,[246,181,105]],[1,[255,235,205]]]
  };

  let kind = "All";
  let currentTarget = null;
  let currentCapture = null;
  let preset = presets[0];
  let renderQueued = false;
  let activeCompare = false;
  let previewOriginal = false;
  let compareNights = false;
  let blinkSide = null;
  let expanded = false;
  let showWatermark = false;
  let watermarkFrame = 0;
  let detailRequest = 0;
  let usePrecision = false;
  let precisionModel = null;
  let precisionRequest = 0;
  let exportRequest = 0;
  let zoom = 1;
  let pixelView = false;
  let panX = 0;
  let panY = 0;
  let drag = null;
  const touches = new Map();
  let pinch = null;
  let multiTouch = false;
  let lastTouchEnd = -Infinity;
  let pendingTap = null;
  let moved = false;

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
    const splitVisible = compareNights || (activeCompare && !previewOriginal && !pixelView);
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
    queueWatermarkLayout();
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
    byId("open-webb").hidden = compareNights || !currentCapture?.webb;
    syncCaptureNavigation();
    updateWatermark();
  }

  function updateWatermark() {
    const stamp = byId("watermark");
    const button = byId("show-watermark");
    button.hidden = compareNights;
    button.setAttribute("aria-pressed",String(showWatermark));
    stamp.hidden = !showWatermark || !currentCapture || compareNights || !baseline.naturalWidth;
    if (stamp.hidden) return;
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
    queueWatermarkLayout();
  }

  function queueWatermarkLayout() {
    if (!watermarkFrame && !byId("watermark").hidden) {
      watermarkFrame = requestAnimationFrame(positionWatermark);
    }
  }

  function positionWatermark() {
    watermarkFrame = 0;
    const stamp = byId("watermark");
    if (stamp.hidden || !baseline.naturalWidth) return;
    const stageBox = stage.getBoundingClientRect();
    const {clientWidth:width, clientHeight:height} = stage;
    const {naturalWidth, naturalHeight} = baseline;
    const fitScale = Math.min(width/naturalWidth,height/naturalHeight);
    const fittedWidth = naturalWidth * fitScale;
    const scale = fitScale * zoom;
    const imageWidth = fittedWidth * zoom;
    const imageHeight = naturalHeight * scale;
    const x = (width-imageWidth)/2 + panX;
    const y = (height-imageHeight)/2 + panY;
    const inset = 9;
    const left = Math.max(0,x) + inset;
    const top = Math.max(0,y) + inset;
    const right = Math.min(width,x+imageWidth) - inset;
    const bottom = Math.min(height,y+imageHeight) - inset;
    stamp.style.setProperty("--stamp-limit", Math.max(0,Math.min(right-left,fittedWidth-2*inset)) + "px");
    stamp.style.setProperty("--stamp-size", Math.min(22,Math.max(11,fittedWidth*.016)) + "px");
    const box = stamp.getBoundingClientRect();
    const farX = Math.max(left,right-box.width);
    const farY = Math.max(top,bottom-box.height);
    const middle = (left+farX)/2;
    const locations = [[left,farY],[farX,farY],[left,top],[farX,top],[middle,farY],[middle,top]];
    const obstacles = [
      ...(!byId("sky-layer").hidden ? skyOverlay.children : []),
      ...(activeCompare && !previewOriginal && !pixelView ? [byId("before-label"),byId("after-label")] : []),
      ...(expanded ? [byId("fullscreen-image"),byId("toggle-clean-view")] : []),
    ].map(element=>element.getBoundingClientRect()).filter(rect=>rect.width>0 || rect.height>0);
    const score = ([localX,localY]) => {
      const a = stageBox.left + localX;
      const b = stageBox.top + localY;
      return obstacles.reduce((sum, rect)=>sum
        + Math.max(0,Math.min(a+box.width+4,rect.right)-Math.max(a-4,rect.left))
          * Math.max(0,Math.min(b+box.height+4,rect.bottom)-Math.max(b-4,rect.top)),0);
    };
    const ranked = locations.map(position=>({position, overlap:score(position)}));
    const [stampX, stampY] = ranked.reduce((best, choice)=>choice.overlap<best.overlap ? choice : best).position;
    stamp.style.setProperty("--stamp-left", stampX + "px");
    stamp.style.setProperty("--stamp-top", stampY + "px");
  }

  function toggleAdjustments(open, focus = false) {
    const button = byId("toggle-adjustments");
    if (open && pixelView) setZoom(1);
    if (open && expanded) {
      setCleanView(false);
      if (!viewerFrame.classList.contains("tools-open")) showViewerTools(true);
    }
    adjustmentPanel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (focus) (open ? byId("adjust-heading") : button).focus({preventScroll:open || !compactFullScreen.matches});
  }

  function showViewerTools(open) {
    const button = byId("toggle-viewer-tools");
    viewerFrame.classList.toggle("tools-open", open);
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-controls", expanded ? "viewer-rail" : "viewer-tools");
    button.textContent = expanded ? (open ? "Hide controls" : "Controls") : (open ? "Less" : "More");
    if (expanded && !open) toggleAdjustments(false);
    if (expanded && open) viewerOptions.scrollLeft = 0;
    requestAnimationFrame(()=>{
      syncToolScroll();
      showZoom();
    });
  }

  function toolsAtEnd() {
    return viewerOptions.scrollLeft + viewerOptions.clientWidth >= viewerOptions.scrollWidth - 2;
  }

  function syncToolScroll() {
    const overflowing = expanded && viewerRail.clientWidth > 0 && viewerOptions.scrollWidth > viewerRail.clientWidth + 1;
    scrollTools.hidden = !overflowing;
    if (!overflowing) return;
    const atEnd = toolsAtEnd();
    const label = atEnd ? "Back to first tools" : "Scroll to more tools";
    scrollTools.textContent = atEnd ? "↶" : "›";
    scrollTools.setAttribute("aria-label",label);
    scrollTools.title = label;
  }

  function setCleanView(enabled) {
    if (enabled) toggleAdjustments(false);
    viewerFrame.classList.toggle("clean-view",enabled);
    const button = byId("toggle-clean-view");
    button.setAttribute("aria-pressed",String(enabled));
    requestAnimationFrame(showZoom);
  }

  function setOriginalPreview(enabled) {
    previewOriginal = enabled;
    byId("preview-original").setAttribute("aria-pressed",String(enabled));
    viewerFrame.classList.toggle("original-preview",enabled);
    byId("compare").disabled = enabled || byId("adjusted-layer").hidden;
    updateCompare();
  }

  function syncCaptureNavigation() {
    const captures = currentTarget?.captures ?? [];
    const navigation = byId("capture-navigation");
    navigation.hidden = !expanded || compareNights || captures.length < 2;
    if (navigation.hidden) return;
    const index = captures.indexOf(currentCapture);
    byId("previous-capture").disabled = index <= 0;
    byId("next-capture").disabled = index >= captures.length-1;
    byId("capture-position").textContent = `${index+1} of ${captures.length}`;
    byId("capture-date").textContent = ` · ${shortDate.format(new Date(currentCapture.date + "T12:00:00Z"))}`;
  }

  function stepCapture(offset) {
    const captures = currentTarget.captures;
    const next = captures[captures.indexOf(currentCapture) + offset];
    if (next) location.hash = routeTo(currentTarget,next);
  }

  function loadWebbReference() {
    if (!webbDialog.open || (narrowWebb.matches && byId("webb-images").dataset.view !== "reference")) return;
    if (webbReference.hasAttribute("src")) return;
    byId("webb-load-status").textContent = "Loading the infrared image…";
    webbReference.src = currentCapture.webb.url;
  }

  function selectWebbView(view) {
    byId("webb-images").dataset.view = view;
    byId("webb-show-capture").setAttribute("aria-pressed",String(view === "capture"));
    byId("webb-show-reference").setAttribute("aria-pressed",String(view === "reference"));
    loadWebbReference();
  }

  function openWebbComparison() {
    const reference = currentCapture?.webb;
    if (!reference) return;
    const footprint = reference.footprint;
    const capture = byId("webb-capture");
    const edit = byId("webb-edit-image");
    const {width,height} = currentCapture.detail || {width:baseline.naturalWidth,height:baseline.naturalHeight};
    if (width && height) capture.parentElement.style.setProperty("--photo-ratio",width/height);
    webbReference.removeAttribute("src");
    webbReference.hidden = true;
    byId("webb-load-status").textContent = "";
    capture.alt = currentTarget.name + " photographed with Celestron Origin";
    capture.src = currentCapture.full;
    webbReference.alt = reference.alt;
    byId("webb-title").textContent = "Compare with Webb · " + currentTarget.name;
    const canShowEdit = !byId("adjusted-layer").hidden;
    byId("webb-show-edit").hidden = !canShowEdit;
    if (canShowEdit) {
      edit.width = canvas.width;
      edit.height = canvas.height;
      edit.getContext("2d").drawImage(canvas,0,0);
      edit.setAttribute("aria-label",currentTarget.name + " with my image adjustments");
    }
    showWebbEdit(canShowEdit && !previewOriginal && !pixelView);
    const referenceType = reference.archive ? "Webb archive" : "Webb infrared";
    byId("webb-reference-label").textContent = `${referenceType} · ${reference.name} · ${reference.band}`;
    byId("webb-feature").textContent = reference.note;
    byId("webb-credit").textContent = "Webb image credit: " + reference.credit;
    const source = byId("webb-source");
    source.href = reference.source;
    source.textContent = reference.archive ? "Webb observing program ↗" : "Official release and downloads ↗";
    byId("webb-open-image").href = reference.archive ? "#webb/" + currentTarget.id + "/" + currentCapture.id : reference.url;
    const look = webbLook(reference);
    byId("webb-try-look").textContent = "Try " + look.name + " on my capture";
    byId("webb-license").hidden = !reference.license;
    if (reference.license) byId("webb-license").href = reference.license;
    byId("webb-footprint").toggleAttribute("hidden",!footprint);
    byId("webb-footprint-note").hidden = !footprint;
    if (footprint) {
      const points = footprint.map(point=>point.map(value=>1000*value).join(",")).join(" ");
      byId("webb-footprint").firstElementChild.setAttribute("points",points);
    }
    webbDialog.showModal();
    selectWebbView("capture");
  }

  function webbLook(reference) {
    const id = /miri/i.test(reference.band) || currentTarget.kind === "Nebulae" ? "webb-dust" : "webb-cool";
    return presets.find(item=>item.id === id);
  }

  function showWebbEdit(enabled) {
    const button = byId("webb-show-edit");
    button.textContent = enabled ? "Show original" : "Show my edit";
    byId("webb-capture").hidden = enabled;
    byId("webb-edit-image").hidden = !enabled;
    byId("webb-capture-label").textContent = (enabled ? "My edited capture" : "My capture") + " · " + dateLabel(currentCapture);
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
    button.hidden = !enabled;
    byId("toggle-clean-view").hidden = !enabled;
    syncCaptureNavigation();
    if (wasExpanded !== enabled) {
      cancelTap();
      setCleanView(false);
      toggleAdjustments(false);
      const nightOptions = byId("night-options");
      if (enabled) {
        byId("toggle-adjustments").after(nightOptions);
        viewerFrame.append(adjustmentPanel);
      } else {
        stage.before(nightOptions);
        viewerFrame.after(adjustmentPanel);
      }
      showViewerTools(enabled && !compactFullScreen.matches && !touchScreen.matches);
    }
    if (enabled) loadDetail();
    else {
      if (pixelView) setZoom(1);
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
    // Keep the browser's native exit overlay off the mobile viewer controls.
    if (compactFullScreen.matches || touchScreen.matches) {
      displayExpanded(true,true);
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
      status.textContent = "16-bit source active. Use Advanced adjustments to fine-tune its display.";
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
    settings.paletteBlend = preset.paletteBlend === undefined ? undefined : Number(byId("palette-blend").value);
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
    if (previewOriginal) setOriginalPreview(false);
    const source = usePrecision ? currentCapture.precision : null;
    const tuned = currentTarget?.id === "m31" && next.andromeda ? (source ? next.precision : next.andromeda) : null;
    byId("white").min = "1";
    for (const id of presetControls) byId(id).value = tuned?.[id] ?? source?.[id] ?? next[id] ?? adjustmentDefaults[id];
    byId("structure-value").previousSibling.textContent = (next.amountLabel || "Detail") + " ";
    const falseColor = next.id === "false";
    const blendsPalette = next.paletteBlend !== undefined;
    const showColor = !falseColor && !blendsPalette && next.id !== "mono";
    byId("palette-control").hidden = !falseColor;
    byId("saturation-label").hidden = byId("saturation").hidden = !showColor;
    byId("palette-blend-label").hidden = byId("palette-blend").hidden = !blendsPalette;
    byId("palette-blend").value = next.paletteBlend ?? 0;
    byId("warm").disabled = falseColor || next.id === "mono";
    const isNebula = currentTarget?.kind === "Nebulae";
    const isGalaxy = currentTarget?.kind === "Galaxies";
    byId("processing-hint").textContent = next.hint;
    byId("detail-preset").dataset.preset = isNebula ? "nebula" : isGalaxy ? "galaxy" : "faint";
    for (const button of byId("presets").children) {
      button.setAttribute("aria-pressed",String(button.dataset.preset === next.id));
      button.textContent = presets.find(item=>item.id === button.dataset.preset).name;
    }
    byId("all-presets").value = next.id;
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
    byId("palette-blend-value").value = (settings.paletteBlend ?? 0) + "%";
    const adjusted = isAdjusted(settings) && (!usePrecision || settings.precision);
    const paletteName = preset.id === "false" ? byId("palette").value : settings.paletteBlend ? preset.id : null;
    const palette = paletteName ? makePalette(paletteName) : null;
    const visible = adjusted && renderAdjusted(baseline,canvas,settings,palette);
    byId("adjusted-layer").hidden = !visible;
    if (!isAdjusted(settings) && !usePrecision) activeCompare = false;
    if (compareNights) {
      byId("night-layer").hidden = !nightImage.complete || !nightImage.naturalWidth;
      nightCanvas.hidden = !(adjusted && renderAdjusted(nightImage,nightCanvas,settings,palette));
    }
    const canPreview = visible || (compareNights && !nightCanvas.hidden);
    const previewButton = byId("preview-original");
    if (!canPreview && previewOriginal && document.activeElement === previewButton) byId("adjust-heading").focus();
    previewButton.disabled = !canPreview;
    if (!canPreview && previewOriginal) setOriginalPreview(false);
    byId("compare").disabled = !visible || previewOriginal;
    byId("export-edit").disabled = !visible || compareNights;
    drawHistogram(settings);
    updateCompare();
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(renderImage);
  }

  function showZoom() {
    const pixelButton = byId("pixel-view");
    const detail = currentCapture?.detail;
    const sourceReady = Boolean(detail?.url && baseline.getAttribute("src") === detail.url && baseline.complete && baseline.naturalWidth);
    const dpr = window.devicePixelRatio || 1;
    pixelButton.hidden = !expanded || compareNights || !detail?.url;
    pixelButton.disabled = !sourceReady;
    if (pixelView && sourceReady && stage.clientWidth && stage.clientHeight) {
      zoom = Math.max(baseline.naturalWidth/stage.clientWidth,baseline.naturalHeight/stage.clientHeight) / dpr;
    }
    const limitX = Math.max(0, (pixelView ? baseline.naturalWidth/dpr-stage.clientWidth : stage.clientWidth*(zoom-1))/2);
    const limitY = Math.max(0, (pixelView ? baseline.naturalHeight/dpr-stage.clientHeight : stage.clientHeight*(zoom-1))/2);
    panX = Math.max(-limitX,Math.min(limitX,panX));
    panY = Math.max(-limitY,Math.min(limitY,panY));
    const transform = "translate(" + panX + "px," + panY + "px) scale(" + zoom + ")";
    for (const layer of [baseline,canvas,nightImage,nightCanvas,skyOverlay]) layer.style.transform = transform;
    skyOverlay.style.setProperty("--overlay-zoom",zoom);
    stage.classList.toggle("pannable",zoom>1);
    stage.classList.toggle("expandable",!expanded && zoom <= 1 && !activeCompare && !compareNights);
    updateWatermark();
    byId("zoom-out").disabled = zoom <= 1;
    byId("zoom-in").disabled = zoom >= 4;
    byId("zoom-fit").textContent = pixelView ? "Fit" : zoom > 1 ? Math.round(zoom * 100) + "%" : "Fit";
  }

  function setPixelView(enabled) {
    pixelView = enabled;
    viewerFrame.classList.toggle("pixel-view",enabled);
    byId("pixel-view").setAttribute("aria-pressed",String(enabled));
    updateCompare();
  }

  function setZoom(next, {anchor,destination=anchor,fromZoom=zoom,fromX=panX,fromY=panY}={}) {
    if (pixelView) setPixelView(false);
    const newZoom = Math.min(Math.max(4,zoom), Math.max(1,next));
    if (anchor) {
      const ratio = newZoom / fromZoom;
      panX = destination.x - (anchor.x-fromX)*ratio;
      panY = destination.y - (anchor.y-fromY)*ratio;
    }
    zoom = newZoom;
    showZoom();
    byId("stage-status").textContent = "Image zoom " + Math.round(zoom*100) + " percent";
  }

  function openCapture(target, capture) {
    const previousTarget = currentTarget;
    currentTarget = target;
    currentCapture = capture;
    clearExport();
    refreshSavedLook();
    if (webbDialog.open) webbDialog.close();
    cancelTap();
    setOriginalPreview(false);
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
    byId("home-masthead").hidden = true;
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
    const [sectionName, targetId, captureId] = hash.split("/");
    const target = targets.find(item=>item.id === targetId);
    const capture = target && (photo(target,captureId) || coverFor(target));
    const archive = sectionName === "webb" && capture?.webb?.archive;
    webbImagePage.hidden = !archive;
    if (!archive) webbImage.removeAttribute("src");
    if (sectionName === "target" && capture) {
      if (capture !== currentCapture) openCapture(target,capture);
      if (shared) restoreView(new URLSearchParams(shared));
      return;
    }
    if (webbDialog.open) webbDialog.close();
    if (expanded) toggleExpanded();
    clearExport();
    currentTarget = null;
    currentCapture = null;
    byId("target-view").hidden = true;
    byId("home-view").hidden = Boolean(archive);
    byId("home-masthead").hidden = Boolean(archive);
    if (archive) {
      const reference = capture.webb;
      byId("webb-image-title").textContent = reference.name;
      byId("webb-image-band").textContent = reference.band;
      byId("webb-image-credit").textContent = reference.credit;
      byId("webb-image-back").href = routeTo(target,capture);
      byId("webb-image-download").href = reference.url;
      byId("webb-image-program").href = reference.source;
      if (webbImage.getAttribute("src") !== reference.url) {
        webbImage.hidden = true;
        webbImage.alt = reference.alt;
        byId("webb-image-status").textContent = "Loading the archive image…";
        webbImage.src = reference.url;
      }
      document.title = reference.name + " | Webb archive";
      window.scrollTo(0,0);
      return;
    }
    document.title = "jjkath astrophotography";
    const section = hash === "catalog" || hash === "about" ? byId(hash) : null;
    if (section) {
      section.focus({preventScroll:true});
      section.scrollIntoView();
    } else window.scrollTo(0,0);
  }

  function lookOptions() {
    const options = new URLSearchParams({preset:preset.id, palette:byId("palette").value});
    for (const id of presetControls) options.set(id,byId(id).value);
    if (preset.paletteBlend !== undefined) options.set("palette-blend",byId("palette-blend").value);
    if (!byId("highlights").checked) options.set("stars-color","off");
    if (usePrecision) options.set("precision","true");
    return options;
  }

  function applyLook(options) {
    const chosen = presets.find(item=>item.id === options.get("preset")) || presets[0];
    const wantsPrecision = options.get("precision") === "true";
    const precision = Boolean(currentCapture.precision) && !compareNights && wantsPrecision;
    if (precision !== usePrecision) setPrecision(precision);
    choosePreset(chosen);
    const palette = byId("palette");
    if ([...palette.options].some(option=>option.value === options.get("palette"))) palette.value = options.get("palette");
    byId("highlights").checked = options.get("stars-color") !== "off";
    const controls = chosen.paletteBlend === undefined ? presetControls : [...presetControls,"palette-blend"];
    for (const id of controls) {
      if (wantsPrecision && !precision && ["black","white","midtone","stretch"].includes(id)) continue;
      const value = options.get(id);
      if (value === null) continue;
      const control = byId(id);
      if (control.tagName === "SELECT" ? [...control.options].some(o=>o.value === value) : Number.isFinite(Number(value))) {
        control.value = value;
      }
    }
    return !wantsPrecision || precision;
  }

  function refreshSavedLook() {
    const status = byId("look-status");
    status.textContent = "Save one look per target on this device.";
    byId("save-look").disabled = false;
    byId("load-look").disabled = true;
    try {
      byId("load-look").disabled = !localStorage.getItem(lookPrefix + currentTarget.id);
    } catch {
      byId("save-look").disabled = true;
      status.textContent = "This browser session has local storage disabled.";
    }
  }

  function clearExport() {
    const link = byId("download-edit");
    if (link.hasAttribute("href")) URL.revokeObjectURL(link.href);
    link.removeAttribute("href");
    link.hidden = true;
    return ++exportRequest;
  }

  async function exportEditedImage() {
    if (compareNights || byId("adjusted-layer").hidden) return;
    const request = clearExport();
    const {width,height} = canvas;
    const filename = currentTarget.id + "-" + currentCapture.id + "-" + preset.id + ".png";
    const status = byId("look-status");
    status.textContent = "Preparing your PNG…";
    let png;
    try {
      png = await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    } catch {
      png = null;
    }
    if (request !== exportRequest) return;
    if (!png) {
      status.textContent = "The PNG could not be created in this browser.";
      return;
    }
    const link = byId("download-edit");
    link.href = URL.createObjectURL(png);
    link.download = filename;
    link.hidden = false;
    status.textContent = "PNG ready · " + width + " × " + height + " px";
    link.click();
  }

  function viewLink() {
    const fallback = "https://jjkath.github.io/jjkath/";
    const url = new URL(location.protocol === "file:" || location.hostname === "127.0.0.1" ? fallback : location.href);
    const options = lookOptions();
    options.set("zoom",zoom.toFixed(3));
    options.set("x",(panX / (stage.clientWidth || 1)).toFixed(4));
    options.set("y",(panY / (stage.clientHeight || 1)).toFixed(4));
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
    applyLook(options);
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

  byId("all-presets").replaceChildren(...presets.map(item=>new Option(item.name,item.id)));
  byId("all-presets").addEventListener("change",event=>choosePreset(presets.find(item=>item.id === event.target.value)));
  for (const id of ["baseline","faint","webb-cool","webb-dust"]) {
    const button = element("button");
    button.type = "button";
    button.dataset.preset = id;
    if (id === "faint") button.id = "detail-preset";
    button.addEventListener("click",()=>choosePreset(presets.find(item=>item.id === button.dataset.preset)));
    byId("presets").append(button);
  }
  choosePreset(presets[0]);
  for (const id of [...presetControls,"highlights","palette","palette-blend"]) {
    byId(id).addEventListener("input",queueRender);
    byId(id).addEventListener("change",queueRender);
  }
  baseline.addEventListener("load",()=>{ syncCaptureTools(); showZoom(); queueRender(); });
  byId("expand-capture").addEventListener("click",toggleExpanded);
  byId("toggle-adjustments").addEventListener("click",()=>toggleAdjustments(adjustmentPanel.hidden,true));
  byId("preview-original").addEventListener("click",()=>setOriginalPreview(!previewOriginal));
  byId("close-adjustments").addEventListener("click",()=>toggleAdjustments(false,true));
  byId("toggle-viewer-tools").addEventListener("click",()=>showViewerTools(!viewerFrame.classList.contains("tools-open")));
  scrollTools.addEventListener("click",()=>{
    const left = toolsAtEnd() ? 0 : viewerOptions.scrollLeft + Math.max(44,viewerOptions.clientWidth-44);
    viewerOptions.scrollTo({left,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
  });
  viewerOptions.addEventListener("scroll",syncToolScroll,{passive:true});
  const toolLayout = new ResizeObserver(syncToolScroll);
  toolLayout.observe(viewerRail);
  for (const control of viewerOptions.querySelectorAll("button, a, .compare-range")) toolLayout.observe(control);
  byId("watermark-art").addEventListener("load",()=>{
    byId("watermark-art").hidden = false;
    byId("watermark").classList.add("has-artwork");
    queueWatermarkLayout();
  });
  byId("show-details").addEventListener("click",openImageDetails);
  byId("show-watermark").addEventListener("click",()=>{
    showWatermark = !showWatermark;
    updateWatermark();
  });
  byId("fullscreen-image").addEventListener("click",toggleExpanded);
  byId("toggle-clean-view").addEventListener("click",()=>setCleanView(!viewerFrame.classList.contains("clean-view")));
  byId("previous-capture").addEventListener("click",()=>stepCapture(-1));
  byId("next-capture").addEventListener("click",()=>stepCapture(1));
  byId("open-webb").addEventListener("click",openWebbComparison);
  byId("webb-show-capture").addEventListener("click",()=>selectWebbView("capture"));
  byId("webb-show-reference").addEventListener("click",()=>selectWebbView("reference"));
  byId("webb-show-edit").addEventListener("click",()=>showWebbEdit(byId("webb-edit-image").hidden));
  byId("webb-try-look").addEventListener("click",()=>{
    const look = webbLook(currentCapture.webb);
    webbDialog.close();
    choosePreset(look);
    toggleAdjustments(true,true);
  });
  narrowWebb.addEventListener("change",loadWebbReference);
  for (const image of [byId("webb-capture"),webbReference]) {
    image.addEventListener("load",()=>{
      if (!webbDialog.open || !image.naturalWidth) return;
      image.parentElement.style.setProperty("--photo-ratio",image.naturalWidth/image.naturalHeight);
      if (image === webbReference) {
        image.hidden = false;
        byId("webb-load-status").textContent = "";
      }
    });
  }
  webbReference.addEventListener("error",()=>{
    if (webbDialog.open && webbReference.hasAttribute("src")) {
      byId("webb-load-status").textContent = "The image could not load here. Open the Webb source below.";
    }
  });
  webbImage.addEventListener("load",()=>{
    webbImage.hidden = false;
    byId("webb-image-status").textContent = "";
  });
  webbImage.addEventListener("error",()=>{
    byId("webb-image-status").textContent = "The archive image could not load. Try the download link below.";
  });
  webbDialog.addEventListener("close",()=>{
    if (webbDialog.open) return;
    webbReference.removeAttribute("src");
    webbReference.hidden = true;
    byId("webb-load-status").textContent = "";
    const edit = byId("webb-edit-image");
    edit.width = edit.height = 0;
  });
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
  byId("save-look").addEventListener("click",()=>{
    const status = byId("look-status");
    try {
      localStorage.setItem(lookPrefix + currentTarget.id,lookOptions().toString());
      byId("load-look").disabled = false;
      status.textContent = "Look saved for " + currentTarget.name + ".";
    } catch {
      status.textContent = "This browser could not save the look.";
    }
  });
  byId("load-look").addEventListener("click",()=>{
    const status = byId("look-status");
    try {
      const saved = localStorage.getItem(lookPrefix + currentTarget.id);
      if (!saved) {
        refreshSavedLook();
        return;
      }
      const restored = applyLook(new URLSearchParams(saved));
      status.textContent = restored ? "Saved look loaded." : "Saved look loaded with brightness levels for this capture.";
    } catch {
      status.textContent = "This browser could not load the saved look.";
    }
  });
  byId("export-edit").addEventListener("click",exportEditedImage);
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
  byId("pixel-view").addEventListener("click",()=>{
    if (pixelView) {
      setZoom(1);
      return;
    }
    panX = panY = 0;
    setPixelView(true);
    showZoom();
    byId("stage-status").textContent = "One source pixel per screen pixel. Showing the lossless image.";
  });
  function activateStage() {
    if (!adjustmentPanel.hidden) {
      toggleAdjustments(false);
      return;
    }
    if (expanded) setCleanView(!viewerFrame.classList.contains("clean-view"));
    else if (zoom <= 1 && !stage.classList.contains("compare-active")) toggleExpanded();
  }
  stage.addEventListener("click",event=>{
    if (event.pointerType === "touch" || performance.now()-lastTouchEnd < 500 || moved) return;
    activateStage();
  });
  function cancelTap() {
    if (pendingTap) clearTimeout(pendingTap.timer);
    pendingTap = null;
  }
  function stagePoint(x,y) {
    const bounds = stage.getBoundingClientRect();
    return {x:x-bounds.left-bounds.width/2,y:y-bounds.top-bounds.height/2};
  }
  function touchPair() {
    const [a,b] = touches.values();
    return {
      center:stagePoint((a.x+b.x)/2,(a.y+b.y)/2),
      distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))
    };
  }
  function startPinch() {
    const {center,distance} = touchPair();
    pinch = {anchor:center,distance,fromZoom:zoom,fromX:panX,fromY:panY};
  }
  function touchTap(x,y) {
    if (pendingTap && Math.hypot(x-pendingTap.x,y-pendingTap.y) <= 32) {
      cancelTap();
      setZoom(zoom > 1 ? 1 : 2,{anchor:stagePoint(x,y)});
      return;
    }
    cancelTap();
    pendingTap = {x,y,timer:setTimeout(()=>{
      pendingTap = null;
      activateStage();
    },280)};
  }
  function moveDivider(clientX) {
    const bounds = stage.getBoundingClientRect();
    byId("split").value = Math.round(100 * (clientX - bounds.left) / bounds.width);
    showSplit();
  }
  stage.addEventListener("pointerdown",(event)=>{
    const {pointerId,clientX,clientY} = event;
    if (event.pointerType === "touch") {
      touches.set(pointerId,{x:clientX,y:clientY,startX:clientX,startY:clientY});
      if (touches.size >= 2) {
        multiTouch = true;
        cancelTap();
        drag = null;
        stage.classList.remove("panning");
        if (touches.size === 2) startPinch();
        return;
      }
    }
    const divider = zoom <= 1 && stage.classList.contains("compare-active");
    moved = false;
    if (!event.isPrimary || (zoom <= 1 && !divider)) return;
    drag = {id:pointerId,x:clientX,y:clientY,panX,panY,divider};
    stage.setPointerCapture(event.pointerId);
    if (drag.divider) {
      moveDivider(event.clientX);
      return;
    }
    stage.classList.add("panning");
  });
  stage.addEventListener("pointermove",(event)=>{
    const touch = touches.get(event.pointerId);
    if (touch) {
      touch.x = event.clientX;
      touch.y = event.clientY;
      if (pinch) {
        const {center,distance} = touchPair();
        setZoom(pinch.fromZoom*distance/pinch.distance,{...pinch,destination:center});
        return;
      }
    }
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX-drag.x;
    const dy = event.clientY-drag.y;
    if (Math.hypot(dx,dy)>7) moved = true;
    if (drag.divider) {
      moveDivider(event.clientX);
      return;
    }
    panX = drag.panX+dx;
    panY = drag.panY+dy;
    showZoom();
  });
  for (const type of ["pointerup","pointercancel","lostpointercapture"]) stage.addEventListener(type,(event)=>{
    const touch = touches.get(event.pointerId);
    if (touch) {
      lastTouchEnd = performance.now();
      if (!multiTouch && type === "pointerup" && !moved && Math.hypot(event.clientX-touch.startX,event.clientY-touch.startY)<=7) {
        touchTap(event.clientX,event.clientY);
      } else cancelTap();
      touches.delete(event.pointerId);
      if (touches.size >= 2) startPinch();
      else pinch = null;
      if (!touches.size) multiTouch = false;
    }
    if (drag?.id === event.pointerId) {
      drag = null;
      stage.classList.remove("panning");
    }
  });
  window.addEventListener("resize",showZoom);
  window.addEventListener("hashchange",handleRoute);
  handleRoute();
})();
