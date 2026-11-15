const astroProcessing = (() => {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const unit = (value) => clamp(value, 0, 1);
  const scaleWeights = {
    fine: [2.6, .5],
    balanced: [1.9, 1.4],
    broad: [1.15, 2.3],
  };

  function boxBlur(source, width, height, radius, horizontal) {
    const result = new Float32Array(source.length);
    const diameter = 2 * radius + 1;

    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += source[row + clamp(x, 0, width - 1)];
      for (let x = 0; x < width; x++) {
        horizontal[row + x] = sum / diameter;
        sum += source[row + Math.min(width - 1, x + radius + 1)] - source[row + Math.max(0, x - radius)];
      }
    }

    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += horizontal[clamp(y, 0, height - 1) * width + x];
      for (let y = 0; y < height; y++) {
        result[y * width + x] = sum / diameter;
        sum += horizontal[Math.min(height - 1, y + radius + 1) * width + x]
          - horizontal[Math.max(0, y - radius) * width + x];
      }
    }
    return result;
  }

  function prepare({data, width, height}) {
    const luminance = new Float32Array(width * height);
    for (let pixel = 0, i = 0; i < data.length; pixel++, i += 4) {
      luminance[pixel] = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
    }
    const shortSide = Math.min(width, height);
    const scratch = new Float32Array(luminance.length);
    const fine = boxBlur(luminance, width, height, Math.max(1, Math.round(shortSide / 400)), scratch);
    const medium = boxBlur(fine, width, height, Math.max(2, Math.round(shortSide / 110)), scratch);
    const broad = boxBlur(medium, width, height, Math.max(4, Math.round(shortSide / 24)), scratch);
    return {data, luminance, fine, medium, broad};
  }

  function meaningfulDetail(band, threshold) {
    const magnitude = Math.abs(band);
    return band * magnitude / (magnitude + threshold);
  }

  function tone(value, settings) {
    const black = settings.black * 2.55;
    const white = Math.max(black + .0255, settings.white * 2.55);
    const normalized = unit((value - black) / (white - black));
    if (settings.stretch === "asinh") {
      const softness = .24 * Math.pow(2, -settings.midtone / 44);
      return 255 * Math.asinh(normalized / softness) / Math.asinh(1 / softness);
    }
    return 255 * Math.pow(normalized, Math.pow(2, -settings.midtone / 84));
  }

  function render(image, output, settings, palette) {
    const {data, luminance, fine, medium, broad} = image;
    const saturation = settings.saturation / 100;
    const strength = settings.structure / 100;
    const smoothing = settings.smoothing / 100;
    const reduceStars = settings.stars / 100;
    const shadowNeutralization = .74 * unit((Math.max(0, settings.midtone) + .5 * settings.structure) / 75);
    const [fineWeight, broadWeight] = scaleWeights[settings.scale];
    const curve = new Float32Array(257);
    for (let y = 0; y < 256; y++) curve[y] = tone(y, settings);
    curve[256] = curve[255];

    for (let pixel = 0, i = 0; i < data.length; pixel++, i += 4) {
      const y = luminance[pixel];
      const narrowPeak = y - medium[pixel];
      const compact = unit((narrowPeak - 7) / 38) * unit((y - 17) / 59);
      const protection = settings.protect && !settings.monochrome && !settings.precision ? compact * .86 : 0;
      // Compare two spatial bands so a stretch can reveal cloud structure without sharpening pixel noise.
      const detail = fineWeight * meaningfulDetail(fine[pixel] - medium[pixel], 1.25)
        + broadWeight * meaningfulDetail(medium[pixel] - broad[pixel], 1.5);
      const texture = fine[pixel] - y;
      const flatShadow = unit(1 - y / 49) * unit(1 - Math.abs(texture) / 6);
      const signal = clamp(y + smoothing * flatShadow * texture
        + strength * (1 - .88 * compact) * clamp(detail, -.38 * y, 5 + .62 * y), 0, 255);
      const lower = Math.floor(signal);
      const stretch = curve[lower] + (signal - lower) * (curve[lower + 1] - curve[lower]);
      const lift = y > 0 ? Math.min(3.2 + .023 * y, stretch / y) : 0;
      const paletteOffset = Math.round(stretch) * 3;
      const diffuseSignal = unit((medium[pixel] - 4) / 22);
      const tint = settings.warm * diffuseSignal * unit((115 - y) / 60) * (1 - compact);
      const adjustedSaturation = saturation * (1 - smoothing * flatShadow * .2)
        * (1 - shadowNeutralization * (1 - diffuseSignal) * (1 - compact));
      const suppress = reduceStars * compact * .76;
      const floor = curve[Math.round(medium[pixel])];
      for (let channel = 0; channel < 3; channel++) {
        const sample = data[i + channel];
        const warmth = channel === 0 ? 1 : channel === 1 ? -.29 : -.07;
        const color = stretch + (sample - y) * lift * adjustedSaturation + warmth * tint;
        const changed = palette ? palette[paletteOffset + channel] : color;
        const protectedColor = changed + protection * (sample - changed);
        output[i + channel] = protectedColor - suppress * Math.max(0, protectedColor - floor);
      }
      output[i + 3] = data[i + 3];
    }
  }

  async function loadPrecision(source) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot decode the 16-bit preview.");
    const response = await fetch(source.url);
    if (!response.ok || !response.body) throw new Error("The 16-bit preview could not be loaded.");
    const decoded = response.body.pipeThrough(new DecompressionStream("gzip"));
    const samples = new DataView(await new Response(decoded).arrayBuffer());
    const count = source.width * source.height;
    if (samples.byteLength !== count * 6) throw new Error("The 16-bit preview is incomplete.");
    const data = new Float32Array(count * 4);
    for (let pixel = 0; pixel < count; pixel++) {
      for (let channel = 0; channel < 3; channel++) {
        data[pixel * 4 + channel] = clamp(samples.getUint16((pixel * 3 + channel) * 2, true) / 257
          - source.offsets[channel] * 2.55, 0, 255);
      }
      data[pixel * 4 + 3] = 255;
    }
    return prepare({data, width:source.width, height:source.height});
  }

  return {prepare, render, tone, loadPrecision};
})();
