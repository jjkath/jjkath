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
    const sample = [];
    const residuals = [];
    for (let pixel = 0; pixel < luminance.length; pixel += 97) {
      sample.push(luminance[pixel]);
      residuals.push(Math.abs(luminance[pixel]-fine[pixel]));
    }
    sample.sort((a,b)=>a-b);
    residuals.sort((a,b)=>a-b);
    const sky = sample[Math.floor(sample.length * .35)] || 0;
    const noise = 1.4826 * (residuals[Math.floor(residuals.length/2)] || 0);
    return {data, width, height, luminance, fine, medium, broad, sky, noise};
  }

  function localContrast({width, height, luminance, broad}) {
    const columns = Math.min(width, 8);
    const rows = Math.min(height, Math.max(1, Math.round(columns * height / width)));
    const bins = 64;
    const tables = Array.from({length:columns*rows},()=>new Float32Array(bins));
    for (let y = 0; y < height; y++) {
      const row = Math.floor(y * rows / height) * columns;
      for (let x = 0; x < width; x++) {
        const table = tables[row + Math.floor(x * columns / width)];
        table[luminance[y*width+x] >> 2]++;
      }
    }
    for (const table of tables) {
      const total = table.reduce((sum, count)=>sum+count,0);
      const limit = Math.max(1,Math.floor(total * 2.7 / bins));
      let excess = 0;
      for (let i = 0; i < bins; i++) {
        excess += Math.max(0, table[i] - limit);
        table[i] = Math.min(table[i], limit);
      }
      let cumulative = 0;
      for (let i = 0; i < bins; i++) {
        cumulative += table[i] + excess / bins;
        table[i] = 255 * cumulative / total;
      }
    }
    const lookup = (table, value) => {
      const index = clamp(value / 4 - .5, 0, bins-1);
      const low = Math.floor(index);
      return table[low] + (table[Math.min(low+1,bins-1)] - table[low]) * (index-low);
    };
    const difference = (table, value, surrounding) => lookup(table,value)-lookup(table,surrounding);
    const residual = new Float32Array(luminance.length);
    for (let y = 0; y < height; y++) {
      const v = clamp((y+.5)*rows/height-.5,0,rows-1);
      const top = Math.floor(v);
      const bottom = Math.min(top+1,rows-1);
      for (let x = 0; x < width; x++) {
        const u = clamp((x+.5)*columns/width-.5,0,columns-1);
        const left = Math.floor(u);
        const right = Math.min(left+1,columns-1);
        const pixel = y*width+x;
        const value = luminance[pixel];
        const surrounding = broad[pixel];
        const upper = (1-u+left)*difference(tables[top*columns+left],value,surrounding)
          + (u-left)*difference(tables[top*columns+right],value,surrounding);
        const lower = (1-u+left)*difference(tables[bottom*columns+left],value,surrounding)
          + (u-left)*difference(tables[bottom*columns+right],value,surrounding);
        residual[pixel] = clamp(upper*(1-v+top)+lower*(v-top)-(value-surrounding),-17,21);
      }
    }
    return residual;
  }

  function meaningfulDetail(band, threshold) {
    const magnitude = Math.abs(band);
    return band * magnitude / (magnitude + threshold);
  }

  function tone(value, settings) {
    const black = settings.black * 2.55;
    const white = Math.max(black + .0255, settings.white * 2.55);
    const normalized = unit((value - black) / (white - black));
    let mapped;
    if (settings.stretch === "asinh") {
      const softness = .24 * Math.pow(2, -settings.midtone / 44);
      mapped = 255 * Math.asinh(normalized / softness) / Math.asinh(1 / softness);
    } else {
      mapped = 255 * Math.pow(normalized, Math.pow(2, -settings.midtone / 84));
    }
    return mapped - (settings.shoulder || 0) * Math.pow(Math.max(0,mapped-76)/179,2);
  }

  function toneCurve(settings, image) {
    const adapted = image && Number.isFinite(settings.skyLift);
    const sky = adapted ? tone(image.sky,settings) : 0;
    const ceiling = adapted ? clamp(settings.precision ? 8+settings.skyLift : image.sky+settings.skyLift,7,25) : sky;
    const fade = sky < 250 ? Math.max(0,sky-ceiling) : 0;
    const curve = new Float32Array(257);
    for (let y = 0; y < 256; y++) {
      const value = tone(y,settings);
      // Keep the background near the target level while the rest of the stretch lifts signal above it.
      const weight = fade ? (value <= sky ? value/sky : Math.pow((255-value)/(255-sky),2)) : 0;
      curve[y] = value - fade*weight;
    }
    curve[256] = curve[255];
    return curve;
  }

  function render(image, output, settings, palette, toneReference=image) {
    const {data, luminance, fine, medium, broad, sky, noise} = image;
    const adaptive = Number.isFinite(settings.skyLift);
    const saturation = settings.saturation / 100;
    const strength = settings.structure / 100;
    const smoothing = settings.smoothing / 100;
    const reduceStars = settings.stars / 100;
    const shadowNeutralization = .74 * unit((Math.max(0, settings.midtone) + .5 * settings.structure) / 75);
    const [fineWeight, broadWeight] = scaleWeights[settings.scale];
    const local = settings.effect === "local" && strength ? (image.local ??= localContrast(image)) : null;
    const ordinaryDetail = settings.effect ? 0 : strength;
    const curve = toneCurve(settings,toneReference);
    const shadow = curve[Math.round(sky)];
    const noiseGate = adaptive ? Math.min(3.8, noise * 1.9) : 0;

    for (let pixel = 0, i = 0; i < data.length; pixel++, i += 4) {
      const y = luminance[pixel];
      const narrowPeak = y - medium[pixel];
      const compact = adaptive
        ? unit((narrowPeak - 4 - noiseGate) / 30) * unit((y - sky - 6) / 38)
        : unit((narrowPeak - 7) / 38) * unit((y - 17) / 59);
      const protection = settings.protect && !settings.monochrome && !settings.precision ? compact * .86 : 0;
      // Compare two spatial bands so a stretch can reveal cloud structure without sharpening pixel noise.
      const detail = fineWeight * meaningfulDetail(fine[pixel] - medium[pixel], 1.25 + noiseGate)
        + broadWeight * meaningfulDetail(medium[pixel] - broad[pixel], 1.5 + .55*noiseGate);
      const texture = fine[pixel] - y;
      const flatShadow = unit(1 - y / 49) * unit(1 - Math.abs(texture) / 6);
      const aboveSky = unit((broad[pixel] - sky - .9) / 13);
      const localDetail = local ? strength * .58 * aboveSky * (1 - .9 * compact) * local[pixel] : 0;
      const signal = clamp(y + smoothing * flatShadow * texture
        + ordinaryDetail * (1 - .88 * compact) * clamp(detail, -.38 * y, 5 + .62 * y) + localDetail, 0, 255);
      const lower = Math.floor(signal);
      const mapped = curve[lower] + (signal - lower) * (curve[lower + 1] - curve[lower]);
      const core = settings.effect === "hdr"
        ? 70 * strength * unit((curve[Math.round(broad[pixel])] - 55) / 120)
          * unit((mapped - 62) / 153) * (1 - .82 * compact)
        : 0;
      const stretch = mapped - core;
      const lift = y > 0 ? Math.min(3.2 + .023 * y, stretch / y) : 0;
      const paletteOffset = Math.round(adaptive ? clamp((stretch-shadow)*1.27,0,255) : stretch) * 3;
      const paletteMix = adaptive ? unit((y - sky - noiseGate) / (10 + 2*noiseGate)) : 1;
      const diffuseSignal = unit((medium[pixel] - 4) / 22);
      const tint = settings.warm * diffuseSignal * unit((115 - y) / 60) * (1 - compact) * (adaptive ? aboveSky : 1);
      const cloudColor = settings.effect === "cloud-color"
        ? 1 + 1.35 * strength * aboveSky * (1 - compact) * unit((232 - y) / 100)
        : 1;
      const adjustedSaturation = saturation * (1 - smoothing * flatShadow * .2)
        * (1 - shadowNeutralization * (1 - diffuseSignal) * (1 - compact)) * cloudColor;
      const suppress = reduceStars * compact * .76;
      const floor = curve[Math.round(medium[pixel])];
      const chromaGain = lift * adjustedSaturation;
      const red = (data[i]-y)*chromaGain + tint;
      const green = (data[i+1]-y)*chromaGain - .29*tint;
      const blue = (data[i+2]-y)*chromaGain - .07*tint;
      const low = Math.min(red,green,blue);
      const high = Math.max(red,green,blue);
      const gamut = adaptive ? Math.min(1,low < 0 ? stretch/-low : 1,high > 0 ? (255-stretch)/high : 1) : 1;
      for (let channel = 0; channel < 3; channel++) {
        const sample = data[i + channel];
        const chroma = channel === 0 ? red : channel === 1 ? green : blue;
        const color = stretch + gamut*chroma;
        const changed = palette ? stretch + paletteMix*(palette[paletteOffset + channel]-stretch) : color;
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

  return {prepare, render, toneCurve, loadPrecision};
})();
