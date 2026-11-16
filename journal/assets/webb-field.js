const webbField = (() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const images = byId("webb-images");
  const footprint = byId("webb-footprint");
  const captureLayer = byId("webb-capture-layer");
  const referenceLayer = byId("webb-reference-layer");
  const fieldButton = byId("webb-focus-field");
  const zoomControls = byId("webb-field-zoom");
  const note = byId("webb-footprint-note");
  const identity = [1, 0, 0, 1, 0, 0];
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));

  let leftRatio = 1;
  let rightRatio = 1;
  let field;
  let aligned;
  let focused = false;
  let zoom = 1;
  let offsetX = 0;
  let offsetY = 0;
  let drag;
  let onFocus;

  function fieldBounds(points) {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    const pad = .06 * Math.max(right - left, bottom - top);
    return [Math.max(0, left - pad), Math.max(0, top - pad), Math.min(1, right + pad), Math.min(1, bottom + pad)];
  }

  // Map an Origin pixel into the Webb image using the ordered sky corners.
  function invertCorners([topLeft, topRight, , bottomLeft]) {
    const [x, y] = topLeft;
    const [ux, uy] = [topRight[0] - x, topRight[1] - y];
    const [vx, vy] = [bottomLeft[0] - x, bottomLeft[1] - y];
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-8) return null;
    return [vy / det, -uy / det, -vx / det, ux / det, (vx * y - vy * x) / det, (uy * x - ux * y) / det];
  }

  function place(layer, [a, b, c, d, x, y]) {
    const {clientWidth: width, clientHeight: height} = layer;
    if (!width || !height) return;
    const centered = (1 - zoom) / 2;
    const matrix = [
      zoom * a, zoom * b * height / width, zoom * c * width / height, zoom * d,
      width * (zoom * x + centered + offsetX), height * (zoom * y + centered + offsetY),
    ];
    layer.style.transform = "matrix(" + matrix.join(",") + ")";
  }

  function refresh() {
    referenceLayer.parentElement.style.setProperty("--photo-ratio", rightRatio);
    if (!focused || !field) {
      captureLayer.style.transform = referenceLayer.style.transform = "";
      captureLayer.parentElement.style.setProperty("--photo-ratio", leftRatio);
      return;
    }
    if (aligned) {
      captureLayer.parentElement.style.setProperty("--photo-ratio", rightRatio);
      place(captureLayer, aligned);
      place(referenceLayer, identity);
      return;
    }
    const [left, top, right, bottom] = field;
    const width = right - left;
    const height = bottom - top;
    captureLayer.parentElement.style.setProperty("--photo-ratio", leftRatio * width / height);
    place(captureLayer, [1 / width, 0, 0, 1 / height, -left / width, -top / height]);
  }

  function setZoom(value) {
    zoom = Math.max(1, Math.min(4, value));
    const limit = (zoom - 1) / 2;
    offsetX = clamp(offsetX, limit);
    offsetY = clamp(offsetY, limit);
    byId("webb-zoom-out").disabled = zoom <= 1;
    byId("webb-zoom-in").disabled = zoom >= 4;
    byId("webb-zoom-reset").textContent = Math.round(zoom * 100) + "%";
    images.classList.toggle("field-pannable", zoom > 1);
    for (const layer of [captureLayer, referenceLayer]) layer.parentElement.tabIndex = zoom > 1 ? 0 : -1;
    refresh();
  }

  function showField(enabled) {
    focused = Boolean(enabled && field);
    drag = null;
    images.dataset.field = !focused ? "wide" : aligned ? "aligned" : "area";
    footprint.toggleAttribute("hidden", !field || focused);
    fieldButton.textContent = focused ? "Back to wide view" : "Zoom to Webb field";
    zoomControls.hidden = !(focused && aligned);
    note.textContent = !focused
      ? "Tap the blue outline for a closer look at the area Webb observed."
      : aligned
        ? "The images share an approximate sky scale and orientation. Zoom both or drag after zooming."
        : "My image is zoomed to Webb’s field. Each image keeps its own scale and orientation.";
    offsetX = offsetY = 0;
    setZoom(1);
    if (focused) onFocus();
  }

  function open(reference, ratio, focusImage) {
    leftRatio = ratio || 1;
    rightRatio = reference.field_size ? reference.field_size[0] / reference.field_size[1] : 1;
    onFocus = focusImage;
    field = reference.footprint ? fieldBounds(reference.footprint) : null;
    aligned = reference.alignment ? invertCorners(reference.alignment) : null;
    byId("webb-field-controls").hidden = note.hidden = !field;
    if (field) footprint.firstElementChild.setAttribute("points", reference.footprint.map(
      ([x, y]) => (x * 1000) + "," + (y * 1000)
    ).join(" "));
    showField(false);
  }

  function setImageRatio(role, ratio) {
    if (role === "capture") leftRatio = ratio;
    else rightRatio = ratio;
    refresh();
  }

  fieldButton.addEventListener("click", () => showField(!focused));
  footprint.firstElementChild.addEventListener("click", () => showField(true));
  byId("webb-zoom-in").addEventListener("click", () => setZoom(zoom * 1.4));
  byId("webb-zoom-out").addEventListener("click", () => setZoom(zoom / 1.4));
  byId("webb-zoom-reset").addEventListener("click", () => setZoom(1));

  const resize = new ResizeObserver(refresh);
  for (const layer of [captureLayer, referenceLayer]) {
    const picture = layer.parentElement;
    resize.observe(picture);
    picture.addEventListener("pointerdown", event => {
      if (zoom <= 1 || event.button !== 0 || drag) return;
      drag = {id: event.pointerId, x: event.clientX, y: event.clientY, offsetX, offsetY};
      picture.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    picture.addEventListener("pointermove", event => {
      if (drag?.id !== event.pointerId) return;
      const limit = (zoom - 1) / 2;
      offsetX = clamp(drag.offsetX + (event.clientX - drag.x) / picture.clientWidth, limit);
      offsetY = clamp(drag.offsetY + (event.clientY - drag.y) / picture.clientHeight, limit);
      refresh();
    });
    picture.addEventListener("lostpointercapture", event => {
      if (drag?.id === event.pointerId) drag = null;
    });
    picture.addEventListener("keydown", event => {
      const delta = {ArrowLeft: [-.07, 0], ArrowRight: [.07, 0], ArrowUp: [0, -.07], ArrowDown: [0, .07]}[event.key];
      if (!delta || zoom <= 1) return;
      const limit = (zoom - 1) / 2;
      offsetX = clamp(offsetX + delta[0], limit);
      offsetY = clamp(offsetY + delta[1], limit);
      event.preventDefault();
      refresh();
    });
  }

  return {open, refresh, setImageRatio};
})();
