console.clear();
console.log("🟦 app.js carregat (AquaCheck v2)", new Date().toISOString());

const DATA_SECTORS = "./data/sectors.geojson";
const DATA_RESULTS = "./data/resultats.csv";

const WARN_RATIO = 0.8;

const CENTER = [41.045, 0.93];
const START_ZOOM = 12;

const INDICADORS = [
  { key: "Microbiologia" },
  { key: "Organolèptic" },
  { key: "pH" },
  { key: "Conductivitat" },
  { key: "Terbolesa" },
  { key: "Clor lliure" },
  { key: "Duresa" },
  { key: "Clorurs" },
  { key: "Nitrats" }
];

function normalizeText(s) {
  return String(s || "")
    .replace(/^\uFEFF/, "")
    .replace(/"/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

const MICRO_KEY = normalizeText("Microbiologia");
const COND_KEY = normalizeText("Conductivitat");
const ORG_KEY = normalizeText("Organolèptic");
const NITRATS_KEY = normalizeText("Nitrats");
const TERB_KEY = normalizeText("Terbolesa");
const CLORURS_KEY = normalizeText("Clorurs");

const ALWAYS_OK = new Set([
  normalizeText("pH"),
  normalizeText("Conductivitat"),
  normalizeText("Clor lliure"),
  normalizeText("Duresa"),
  normalizeText("Clorurs")
]);

function sectorFromProps(props) {
  return props && props.sector ? String(props.sector) : "";
}

async function fetchJSON(url) {
  const resp = await fetch(url, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} cargando ${url}`);
  return await resp.json();
}

async function fetchText(url) {
  const resp = await fetch(url, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} cargando ${url}`);
  return await resp.text();
}

function detectDelimiter(line) {
  const semicolons = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

function parseCSVLine(line, delimiter) {
  const cols = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      cols.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  cols.push(current.trim());
  return cols.map((s) => s.replace(/^\uFEFF/, "").trim());
}

function parseCSV(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "").trim();
  const lines = clean.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]);
  const header = parseCSVLine(lines[0], delimiter).map((s) => s.trim());

  return lines.slice(1).map((line) => {
    const cols = parseCSVLine(line, delimiter);
    const o = {};
    header.forEach((h, i) => {
      o[h] = cols[i] ?? "";
    });
    return o;
  });
}

function toNumber(x) {
  const s = String(x ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseDateFlexible(value) {
  const s = String(value || "").trim();
  if (!s) return null;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const [, dd, mm, yyyy, hh = "00", min = "00", sec = "00"] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(sec));
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatData(value) {
  if (!value) return "—";

  const d = parseDateFlexible(value);
  if (!d) return String(value);

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();

  return `${day}/${month}/${year}`;
}

function getField(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== "") {
      return String(row[name]).trim();
    }
  }
  return "";
}

function hasUsableValue(row) {
  const p = normalizeText(row.parametre || "");
  const valorTxt = String(row.valor || "").trim();
  const valorNorm = normalizeText(valorTxt);

  if (!valorTxt) return false;

  if (p === MICRO_KEY || p === ORG_KEY) {
    return valorNorm === "CORRECTE" || valorNorm === "INCORRECTE";
  }

  return toNumber(valorTxt) !== null;
}

// Semàfor
function estatDeFila(row) {
  const p = normalizeText(row.parametre || "");
  const valorTxt = normalizeText(row.valor || "");

  if (ALWAYS_OK.has(p)) return "ok";

  if (p === MICRO_KEY || p === ORG_KEY) {
    if (valorTxt === "INCORRECTE") return "bad";
    if (valorTxt === "CORRECTE") return "ok";
    return "na";
  }

  const v = toNumber(row.valor);

  const hasMin = row.limit_min !== "" && row.limit_min != null;
  const hasMax = row.limit_max !== "" && row.limit_max != null;
  const min = hasMin ? toNumber(row.limit_min) : null;
  const max = hasMax ? toNumber(row.limit_max) : null;

  if (v === null) return "na";

  if (min !== null) {
    if (v < min || (max !== null && v > max)) {
      if (p === NITRATS_KEY) return "bad";
      if (p === TERB_KEY) return "warn";
      return "warn";
    }
    return "ok";
  }

  if (max === null) return "ok";

  if (max === 0) {
    if (v > 0) {
      if (p === NITRATS_KEY) return "bad";
      if (p === TERB_KEY) return "warn";
      return "warn";
    }
    return "ok";
  }

  if (v > max) {
    if (p === NITRATS_KEY) return "bad";
    if (p === TERB_KEY) return "warn";
    return "warn";
  }

  return "ok";
}

function colorSemafor(estat) {
  if (estat === "bad") return "#B7791F";
  if (estat === "ok") return "#3A9B6A";
  if (estat === "warn") return "#3A9B6A";
  return "#7A8691";
}

function labelSemafor(estat) {
  if (estat === "ok") return "APTA PER AL CONSUM";
  if (estat === "warn") return "APTA PER AL CONSUM (amb incidències lleus)";
  if (estat === "bad") return "NO APTA PER AL CONSUM";
  return "SENSE DADES";
}

function pointInRing(point, ring) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lngLat, geometry) {
  if (!geometry) return false;

  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates;
    if (!rings?.length) return false;
    if (!pointInRing(lngLat, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) {
      if (pointInRing(lngLat, rings[k])) return false;
    }
    return true;
  }

  if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates) {
      const rings = poly;
      if (!rings?.length) continue;
      if (!pointInRing(lngLat, rings[0])) continue;

      let inHole = false;
      for (let k = 1; k < rings.length; k++) {
        if (pointInRing(lngLat, rings[k])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  }

  return false;
}

function boundsArea(bounds) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return Math.abs((ne.lat - sw.lat) * (ne.lng - sw.lng));
}

function showUserError(message) {
  const el = document.createElement("div");
  el.setAttribute("role", "alert");
  el.style.position = "fixed";
  el.style.left = "16px";
  el.style.right = "16px";
  el.style.bottom = "16px";
  el.style.zIndex = "9999";
  el.style.padding = "12px 14px";
  el.style.borderRadius = "12px";
  el.style.background = "rgba(20, 30, 40, 0.92)";
  el.style.color = "white";
  el.style.fontSize = "13px";
  el.style.lineHeight = "1.35";
  el.style.boxShadow = "0 10px 30px rgba(0,0,0,.25)";
  el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="font-weight:800">Avís</div>
      <div style="flex:1">${message}</div>
      <button id="closeErr" style="border:0;background:transparent;color:white;font-size:18px;line-height:1;cursor:pointer">×</button>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector("#closeErr")?.addEventListener("click", () => el.remove());
}

if (typeof L === "undefined") {
  showUserError("No s’ha pogut carregar el mapa. Recarrega la pàgina o contacta amb Nostraigua.");
  throw new Error("Leaflet no carregat (L undefined)");
}

const mapEl = document.getElementById("map");
if (!mapEl) {
  showUserError("No s’ha pogut iniciar el mapa. Falta el contenidor <div id='map'>.");
  throw new Error("div#map no existeix");
}
if (mapEl.clientHeight < 50) {
  console.warn?.("⚠️ El #map té una alçada molt petita. Revisa l'altura al CSS.");
}

const map = L.map("map", {
  zoomControl: false,
  tap: false,
  wheelPxPerZoomLevel: 150,
}).setView(CENTER, START_ZOOM);

map.attributionControl.setPrefix(false);
L.control.zoom({ position: "topleft" }).addTo(map);

const ResetViewControl = L.Control.extend({
  options: { position: "topleft" },
  onAdd: function () {
    const container = L.DomUtil.create("div", "leaflet-bar aquacheck-reset");
    const a = L.DomUtil.create("a", "", container);
    a.href = "#";
    a.title = "Restablecer vista";
    a.setAttribute("aria-label", "Restablecer vista");
    a.innerHTML = "↺";

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(a, "click", (e) => {
      L.DomEvent.preventDefault(e);
      clearSelection();
      map.setView(CENTER, START_ZOOM, { animate: true });
    });

    return container;
  },
});
map.addControl(new ResetViewControl());

const DROP_ICON_URL = "./assets/gota.png";

const waterDivIcon = L.divIcon({
  className: "drop-wrap",
  html: `<img class="drop-img" src="${DROP_ICON_URL}" alt="">`,
  iconSize: [24, 30],
  iconAnchor: [10, 26]
});

let clickMarker = null;
let clickDropTimer = null;
let geoSectors = null;
let capaSectors = null;
let sectorsIndex = [];
let resultsBySector = new Map();
let selected = null;
let popupActiu = null;
let popupOpenTimer = null;

function clearClickDrop() {
  if (clickDropTimer) {
    clearTimeout(clickDropTimer);
    clickDropTimer = null;
  }

  if (clickMarker) {
    map.removeLayer(clickMarker);
    clickMarker = null;
  }
}

function showClickDrop(latlng) {
  clearClickDrop();

  clickMarker = L.marker(latlng, {
    icon: waterDivIcon,
    interactive: false,
    keyboard: false
  }).addTo(map);

  requestAnimationFrame(() => {
    const el = clickMarker && clickMarker.getElement();
    if (el) {
      el.classList.remove("drop-anim");
      void el.offsetWidth; // reinicia la animación CSS
      el.classList.add("drop-anim");
    }
  });

  clickDropTimer = setTimeout(() => {
    clearClickDrop();
  }, 1500);
}

const attributionText = "NOSTRAIGUA · © OpenStreetMap contributors";

const osmStandard = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  noWrap: true,
  attribution: attributionText,
  detectRetina: true
});

const osmFrance = L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
  maxZoom: 19,
  noWrap: true,
  attribution: attributionText,
  detectRetina: true
});

let activeBase = osmStandard.addTo(map);
let switched = false;
osmStandard.on("tileerror", () => {
  if (switched) return;
  switched = true;
  map.removeLayer(activeBase);
  activeBase = osmFrance.addTo(map);
});

function styleHidden() {
  return {
    color: "#000",
    weight: 2.5,
    opacity: 0,
    fillOpacity: 0,
    lineJoin: "round",
    lineCap: "round",
  };
}

function styleActive(estat) {
  const c = colorSemafor(estat);
  return {
    color: c,
    weight: 2.6,
    opacity: 0.85,
    fillColor: c,
    fillOpacity: 0.14,
    lineJoin: "round",
    lineCap: "round",
  };
}

function clearSelection() {
  if (popupOpenTimer) {
    clearTimeout(popupOpenTimer);
    popupOpenTimer = null;
  }

  if (selected) {
    selected.entry.layer.setStyle(styleHidden());
    selected = null;
  }
  if (popupActiu) {
    map.closePopup(popupActiu);
    popupActiu = null;
  }
}

function buildSectorsLayer() {
  if (!geoSectors || !geoSectors.features) {
    throw new Error("GeoJSON de sectors invàlid o buit");
  }

  if (capaSectors) {
    map.removeLayer(capaSectors);
    capaSectors = null;
  }

  sectorsIndex = [];

  capaSectors = L.geoJSON(geoSectors, {
    style: () => styleHidden(),
    onEachFeature: (feature, layer) => {
      const props = feature?.properties || {};
      const sectorRaw = sectorFromProps(props) || props.name || props.NOM || "";
      const sectorKey = normalizeText(sectorRaw);
      const bounds = layer.getBounds();
      const area = boundsArea(bounds);

      sectorsIndex.push({
        sectorRaw,
        sectorKey,
        feature,
        layer,
        bounds,
        area
      });
    }
  }).addTo(map);
}

function getLatestIndicador(files, indicador) {
  const keyNorm = normalizeText(indicador.key);
  const candidates = (files || []).filter((r) => normalizeText(r.parametre) === keyNorm);
  if (!candidates.length) return null;

  const withValue = candidates.filter(hasUsableValue);
  return withValue[0] || candidates[0] || null;
}

function getLatestIndicadorsMap(files) {
  const mapIndicadors = new Map();
  for (const ind of INDICADORS) {
    const row = getLatestIndicador(files, ind);
    if (row) mapIndicadors.set(normalizeText(ind.key), row);
  }
  return mapIndicadors;
}

function calcularSemaforSector(files) {
  if (!files || files.length === 0) return "na";

  const rowsByIndicador = Array.from(getLatestIndicadorsMap(files).values());
  if (!rowsByIndicador.length) return "na";

  if (rowsByIndicador.some((r) => estatDeFila(r) === "bad")) return "bad";
  if (rowsByIndicador.some((r) => estatDeFila(r) === "warn")) return "warn";
  if (rowsByIndicador.some((r) => estatDeFila(r) === "ok")) return "ok";

  return "na";
}

function buildPopupHTML(sectorNom, estat, files) {
  const c = colorSemafor(estat);
  const label = labelSemafor(estat);
  const latestMap = getLatestIndicadorsMap(files);

  const rows = INDICADORS.map((ind) => {
    const r = latestMap.get(normalizeText(ind.key));

    if (!r) {
      return `
        <div class="row">
          <span class="label">${ind.key}</span>
          <span class="value muted">—</span>
          <span class="date muted">—</span>
        </div>`;
    }

    const unit = r.unitat ? ` ${r.unitat}` : "";
    const dataParam = r.data_mostra ? formatData(r.data_mostra) : "—";

    const p = normalizeText(r.parametre || "");
    const estatFila = (p === CLORURS_KEY || p === COND_KEY) ? "ok" : estatDeFila(r);

    return `
      <div class="row popup-row ${estatFila}">
        <span class="label">${ind.key}</span>
        <span class="value">${r.valor}${unit}</span>
        <span class="date">${dataParam}</span>
      </div>`;
  }).join("");

  return `
  <div class="popup">
    <div class="popup-header">
      <div class="dot" style="background:${c}"></div>
      <div class="sector">${sectorNom || "Sector"}</div>
    </div>

    <div class="popup-status" style="border-left:4px solid ${c}">
      <div class="status-label" style="color:${c}">${label}</div>
    </div>

    <div class="popup-body">
      ${rows}
    </div>

    <div class="popup-footer">
      Dades informatives. Per a obtenir més informació, consulta la plataforma SINAC.
    </div>
  </div>`;
}

function selectEntry(entry, clickLatLng) {
  clearSelection();

  const files = resultsBySector.get(entry.sectorKey) || [];
  const estat = calcularSemaforSector(files);

  const popupLatLng = clickLatLng || (entry.bounds ? entry.bounds.getCenter() : null);
  if (!popupLatLng) return;

  const headerH = document.querySelector(".header")?.offsetHeight || 0;

  popupOpenTimer = setTimeout(() => {
    popupActiu = L.popup({
      closeButton: true,
      autoPan: true,
      keepInView: false,
      maxWidth: 360,
      autoPanPaddingTopLeft: [110, headerH + 24],
      autoPanPaddingBottomRight: [24, 24],
      autoPanPadding: [24, 24]
    })
    .setLatLng(popupLatLng)
    .setContent(buildPopupHTML(entry.sectorRaw, estat, files))
    .openOn(map);

    popupOpenTimer = null;
  }, 1600);
}

map.on("click", (e) => {
  const mapContainer = map.getContainer();
  mapContainer.classList.add("map-clicking");

  showClickDrop(e.latlng);

  const startX = e.originalEvent?.clientX ?? 0;
  const startY = e.originalEvent?.clientY ?? 0;
  const MOVE_THRESHOLD = 8;

  const restoreCursor = (ev) => {
    const x = ev.originalEvent?.clientX ?? 0;
    const y = ev.originalEvent?.clientY ?? 0;

    const dx = x - startX;
    const dy = y - startY;
    const dist = Math.hypot(dx, dy);

    if (dist < MOVE_THRESHOLD) return;

    mapContainer.classList.remove("map-clicking");
    map.off("mousemove", restoreCursor);
  };

  map.on("mousemove", restoreCursor);

  const lngLat = [e.latlng.lng, e.latlng.lat];
  const candidates = sectorsIndex.filter((s) => s.bounds.contains(e.latlng));
  const hits = candidates.filter((s) => pointInGeometry(lngLat, s.feature.geometry));

  if (!hits.length) {
    clearSelection();
    return;
  }

  hits.sort((a, b) => a.area - b.area);
  selectEntry(hits[0], e.latlng);
});

function buildResultsIndex(rows) {
  resultsBySector = new Map();

  for (const r of rows) {
    let sector = getField(r, [
      "sector", "Sector", "SECTOR",
      "zona", "Zona", "ZONA"
    ]);

    sector = sector.replace(/^\uFEFF/, "").replace(/"/g, "").trim();

    const key = normalizeText(sector);
    if (!key) continue;

    const row = {
      sector,
      data_mostra: getField(r, [
        "data_mostra", "Data Mostra", "DATA_MOSTRA",
        "data", "Data", "DATA",
        "fecha", "Fecha", "FECHA"
      ]),
      parametre: getField(r, [
        "parametre", "Parametre", "PARAMETRE",
        "paràmetre", "Paràmetre", "PARÀMETRE",
        "parametro", "Parametro", "Parámetro", "PARÁMETRO"
      ]),
      valor: getField(r, [
        "valor", "Valor", "VALOR",
        "resultat", "Resultat", "RESULTAT",
        "resultado", "Resultado", "RESULTADO"
      ]),
      unitat: getField(r, [
        "unitat", "Unitat", "UNITAT",
        "unidad", "Unidad", "UNIDAD"
      ]),
      limit_min: getField(r, [
        "limit_min", "Limit Min",
        "limit mínim", "Limit mínim",
        "Minim", "Mínim", "Minimo", "Mínimo"
      ]),
      limit_max: getField(r, [
        "limit_max", "Limit Max",
        "limit maxim", "Limit màxim",
        "Maxim", "Màxim", "Maximo", "Máximo",
        "Limit", "LIMIT"
      ]),
    };

    if (!row.parametre) continue;

    if (!resultsBySector.has(key)) resultsBySector.set(key, []);
    resultsBySector.get(key).push(row);
  }

  for (const arr of resultsBySector.values()) {
    arr.sort((a, b) => {
      const db = parseDateFlexible(b.data_mostra);
      const da = parseDateFlexible(a.data_mostra);
      const tb = db ? db.getTime() : 0;
      const ta = da ? da.getTime() : 0;
      return tb - ta;
    });
  }

  console.log("📊 resultats.csv parsejat:", rows.length, "files");
  console.log("📍 sectors amb resultats:", resultsBySector.size);
}

(async function init() {
  try {
    geoSectors = await fetchJSON(DATA_SECTORS);

    try {
      const csv = await fetchText(DATA_RESULTS);
      const rows = parseCSV(csv);
      buildResultsIndex(rows);

      const updatedAt = document.getElementById("updatedAt");
      if (updatedAt && rows.length) {
        const dates = rows
          .map((r) => parseDateFlexible(
            getField(r, [
              "data_mostra", "Data Mostra",
              "data", "Data",
              "fecha", "Fecha"
            ])
          ))
          .filter((d) => d && !isNaN(d.getTime()))
          .map((d) => d.getTime());

        if (dates.length) {
          const maxDate = new Date(Math.max(...dates));
          updatedAt.textContent = "Última actualització: " + maxDate.toLocaleDateString("ca-ES");
        }
      }
    } catch (err) {
      console.warn("No se han podido cargar los resultados.", err);
      resultsBySector = new Map();

    setTimeout(() => {
      map.invalidateSize();
    }, 300);
    }

    buildSectorsLayer();
  } catch (err) {
    console.error("INIT: no se han podido cargar los datos del mapa.", err);
    showUserError(
      "No se han podido cargar los datos del mapa. (" +
      (err?.message || String(err)) +
      ")"
    );
  }
})();