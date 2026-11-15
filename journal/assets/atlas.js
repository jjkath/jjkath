const skyAtlas = (() => {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const ns = "http://www.w3.org/2000/svg";
  const panel = byId("sky-layer");
  const overlay = byId("object-overlay");
  const dialog = byId("sky-dialog");
  const chart = byId("finder-chart");
  const survey = byId("aladin-view");
  let field = null;
  let labels = false;
  let surveyLoader = null;
  let map = null;
  let mapRequest = 0;

  function node(tag, attributes, content) {
    const element = document.createElementNS(ns, tag);
    for (const [key,value] of Object.entries(attributes)) element.setAttribute(key, value);
    if (content) element.textContent = content;
    return element;
  }

  function objectLayer(current, width, height) {
    const w = 1000;
    const h = w * height / width;
    overlay.setAttribute("viewBox", "0 0 " + w + " " + h);
    const items = [];
    for (const object of current.objects) {
      const x = object.x * w;
      const y = object.y * h;
      const right = object.x < .74;
      items.push(node("circle",{cx:x,cy:y,r:8}));
      items.push(node("text",{x:x + (right ? 13 : -13),y:y - 10,"font-size":16,"text-anchor":right ? "start" : "end"},object.label));
    }
    const x = 82;
    const y = h - 54;
    for (const [label,angle] of [["N",current.north],["E",current.east]]) {
      const radians = angle * Math.PI / 180;
      const dx = Math.cos(radians);
      const dy = Math.sin(radians);
      items.push(node("line",{x1:x,y1:y,x2:x+29*dx,y2:y+29*dy}));
      items.push(node("text",{x:x+43*dx,y:y+43*dy+4,"font-size":13,"text-anchor":"middle"},label));
    }
    const arcmin = current.width * 60 > 39 ? 10 : 5;
    const bar = w * arcmin / (60 * current.width);
    const start = w - 35 - bar;
    items.push(node("line",{x1:start,y1:h-26,x2:start+bar,y2:h-26}));
    items.push(node("text",{x:start+bar/2,y:h-34,"font-size":13,"text-anchor":"middle"},arcmin + "′"));
    overlay.replaceChildren(...items);
  }

  function update(current, image, comparing) {
    field = comparing ? null : current;
    byId("objects").hidden = !field;
    byId("sky-map").hidden = !field;
    byId("objects").setAttribute("aria-pressed",String(Boolean(field && labels)));
    panel.hidden = !field || !labels || !image.complete || !image.naturalWidth;
    if (!panel.hidden) objectLayer(field, image.naturalWidth, image.naturalHeight);
  }

  function setLabels(enabled) { labels = enabled; }
  function hasLabels() { return labels; }

  function finder(name) {
    const [ra0,dec0] = field.center;
    const step = 185 / field.width;
    const cos = Math.cos(dec0 * Math.PI / 180);
    const project = ([ra,dec]) => [270 - ((ra-ra0+540)%360-180)*cos*step, 175 - (dec-dec0)*step];
    const layers = [];
    for (let x=20;x<540;x+=50) layers.push(node("line",{x1:x,x2:x,y1:0,y2:350,stroke:"#202c3b"}));
    for (let y=25;y<350;y+=50) layers.push(node("line",{x1:0,x2:540,y1:y,y2:y,stroke:"#202c3b"}));
    layers.push(node("polygon",{points:field.footprint.map(project).map(p=>p.join(",")).join(" "),
      stroke:"#efbd78","stroke-width":2,fill:"#edc48617"}));
    for (const obj of field.objects) {
      const [x,y] = project([obj.ra,obj.dec]);
      layers.push(node("circle",{cx:x,cy:y,r:4,fill:"#fddeb6"}));
      layers.push(node("text",{x:x+8,y:y-7,"font-size":12,class:"finder-text"},obj.label));
    }
    layers.push(node("text",{x:17,y:24,"font-size":12,class:"finder-text"},"N ↑   E ←"));
    layers.push(node("text",{x:17,y:330,"font-size":12,class:"finder-text"},
      "RA " + ra0.toFixed(3) + "°   Dec " + dec0.toFixed(3) + "°   ·   " + (60*field.width).toFixed(1) + "′ wide"));
    chart.replaceChildren(...layers);
    byId("map-title").textContent = name + " · Sky map";
    byId("map-status").textContent = "Gold outline shows the field of this capture.";
  }

  function openMap(name) {
    if (!field) return;
    chart.hidden = false;
    survey.hidden = true;
    byId("load-survey").hidden = false;
    byId("load-survey").disabled = false;
    finder(name);
    dialog.showModal();
  }

  function loadLibrary() {
    if (!surveyLoader) {
      surveyLoader = import("https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.min.js").then(async({default:A})=>{
        await A.init;
        return A;
      }).catch(error=>{ surveyLoader = null; throw error; });
    }
    return surveyLoader;
  }

  byId("load-survey").addEventListener("click",async()=>{
    const token = ++mapRequest;
    const frame = field;
    const button = byId("load-survey");
    button.disabled = true;
    byId("map-status").textContent = "Loading the Aladin Lite survey…";
    try {
      const timeout = new Promise((_,reject)=>setTimeout(()=>reject(new Error("Survey timed out")),6500));
      const A = await Promise.race([loadLibrary(),timeout]);
      if (!dialog.open || token !== mapRequest) return;
      chart.hidden = true;
      survey.hidden = false;
      const [ra,dec] = frame.center;
      const fov = Math.max(1, frame.width * 1.8);
      if (!map) map = A.aladin("#aladin-view",{target:ra + " " + dec,survey:"P/DSS2/color",fov});
      map.removeOverlays();
      map.gotoRaDec(ra,dec);
      map.setFoV(fov);
      const outline = A.graphicOverlay({name:"Capture footprint",color:"#f7c57e",lineWidth:2});
      outline.add(A.polygon(frame.footprint,{color:"#f7c57e"}));
      map.addOverlay(outline);
      button.hidden = true;
      byId("map-status").textContent = "DSS2 color survey via Aladin Lite. Gold outline shows your capture.";
    } catch (error) {
      if (!dialog.open || token !== mapRequest) return;
      console.warn("Online sky survey unavailable",error);
      chart.hidden = false;
      survey.hidden = true;
      button.disabled = false;
      byId("map-status").textContent = "The online survey could not load. The local finder chart is available.";
    }
  });
  dialog.addEventListener("close",()=>mapRequest++);

  return {update, setLabels, hasLabels, openMap};
})();
