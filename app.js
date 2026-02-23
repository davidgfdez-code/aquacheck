// =====================
// Visor qualitat de l’aigua
// =====================

// ====== Config ======
const DATA_POINTS = "./data/punts.geojson";
const DATA_RESULTS = "./data/resultats.csv";
const DATA_SECTORS = "./data/sectors.geojson";

// Per marcar "proper al límit": quan el valor és >= 80% del límit màxim (si existeix)
const WARN_RATIO = 0.8;

// ====== Utilitats ======
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((s) => s.trim());
  return lines.slice(1).map((line) => {
    // CSV simple (sense cometes). Si tens camps amb comes, fes servir PapaParse.
    const cols = line.split(",").map((s) => s.trim());
    const obj = {};
    header.forEach((h, i) => (obj[h] = cols[i] ?? ""));
    return obj;
  });
}

function toNumber(x) {
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function estatDeResultat(r) {
  const v = toNumber(r.valor);
  const min = r.limit_min !== "" ? toNumber(r.limit_min) : null;
  const max = r.limit_max !== "" ? toNumber(r.limit_max) : null;

  if (v === null) return "na";
  if (min !== null && v < min) return "bad";
  if (max !== null && v > max) return "bad";
  if (max !== null && v >= max * WARN_RATIO) return "warn";
  return "ok";
}

function formatDataHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ca-ES", { dateStyle: "medium", timeStyle: "short" });
}

// Intenta trobar un camp “raonable” per al nom del sector
function obtenirNomSector(props) {
  if (!props) return "Sector";

  const candidates = [
    "NOM",
    "Nom",
    "nom",
    "SECTOR",
    "Sector",
    "sector",
    "NOM_SECTOR",
    "NOMSECTOR",
    "ZONA",
    "Zona",
    "zona",
    "NAME",
    "Name",
    "name",
    "ID",
    "Id",
    "id"
  ];

  for (const c of candidates) {
    if (props[c] !== undefined && props[c] !== null && String(props[c]).trim() !== "") {
      return String(props[c]).trim();
    }
  }
  return "Sector";
}

// ====== Estat ======
let geoPunts = null;
let geoSectors = null;
let resultats = [];
let capaMarkers = null;
let capaSectors = null;

// Filtres
const filtres = {
  puntId: "",
  parametre: "",
  diesPeriode: 30
};

// ====== Referències UI ======
const pointSelect = document.getElementById("pointSelect");
const paramSelect = document.getElementById("paramSelect");
const periodSelect = document.getElementById("periodSelect");
const updatedAt = document.getElementById("updatedAt");

// ====== Mapa ======
// Vista inicial de Mont-roig+Miami (després ajust amb fitBounds)
const map = L.map("map").setView([41.04890, 0.94929], 13);

// Base map (OpenStreetMap)
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// Marcador amb divIcon (colors per estat)
const styleTag = document.createElement("style");
styleTag.textContent = `
  .pin-dot { width: 16px; height: 16px; border-radius: 999px; border: 2px solid white; box-shadow: 0 6px 14px rgba(0,0,0,.25); }
  .pin-ok .pin-dot { background: var(--ok, #3FAE6A); }
  .pin-warn .pin-dot { background: var(--warn, #F4A623); }
  .pin-bad .pin-dot { background: var(--bad, #D64545); }
  .pin-na .pin-dot { background: var(--na, #7A8691); }
`;
document.head.appendChild(styleTag);

function crearMarker(latlng, estat) {
  return L.marker(latlng, {
    icon: L.divIcon({
      className: `pin pin-${estat}`,
      html: `<div class="pin-dot"></div>`,
      iconSize: [18, 18]
    })
  });
}

// ====== Dades i render ======
function obtenirResultatsFiltratsPerPunt(puntId) {
  const ara = new Date();
  const desDe = new Date(ara.getTime() - filtres.diesPeriode * 24 * 60 * 60 * 1000);

  return resultats
    .filter((r) => r.id_punt === puntId)
    .filter((r) => new Date(r.data_mostra) >= desDe)
    .filter((r) => (filtres.parametre ? r.parametre === filtres.parametre : true))
    .sort((a, b) => new Date(b.data_mostra) - new Date(a.data_mostra));
}

function obtenirUltimsPerParametre(puntId) {
  const llista = obtenirResultatsFiltratsPerPunt(puntId);
  const ultimPerParam = new Map();

  for (const r of llista) {
    if (!ultimPerParam.has(r.parametre)) {
      ultimPerParam.set(r.parametre, r);
    }
  }
  return Array.from(ultimPerParam.values());
}

function resumEstatPunt(puntId) {
  const ultims = obtenirUltimsPerParametre(puntId);
  if (ultims.length === 0) return "na";

  // mana el pitjor estat: bad > warn > ok
  const ordre = { bad: 3, warn: 2, ok: 1, na: 0 };
  return ultims
    .map(estatDeResultat)
    .sort((a, b) => ordre[b] - ordre[a])[0];
}

function htmlPopup(puntProps, ultims) {
  const darreraData = ultims[0]?.data_mostra ?? "";

  const rows = ultims.slice(0, 6).map((r) => {
    const st = estatDeResultat(r);
    const icona = st === "ok" ? "✅" : st === "warn" ? "⚠️" : st === "bad" ? "❌" : "—";
    const unitat = r.unitat ? ` ${r.unitat}` : "";
    return `<li>${icona} <strong>${r.parametre}</strong>: ${r.valor}${unitat}</li>`;
  }).join("");

  return `
    <div style="min-width:260px">
      <div style="font-weight:800; font-size:16px; margin-bottom:6px">${puntProps.nom}</div>
      <div style="color:#555; margin-bottom:8px">Última mostra: ${formatDataHora(darreraData)}</div>
      <ul style="padding-left:18px; margin:0">${rows || "<li>Sense dades recents</li>"}</ul>
      <div style="margin-top:10px; color:#555; font-size:12px">
        *Dades de control. Consulta els detalls a l’Ajuntament.
      </div>
    </div>
  `;
}

function renderitzarMarkers() {
  if (capaMarkers) capaMarkers.remove();
  capaMarkers = L.layerGroup();

  for (const f of geoPunts.features) {
    const { id_punt, nom } = f.properties;
    const [lon, lat] = f.geometry.coordinates;

    // filtre per punt
    if (filtres.puntId && filtres.puntId !== id_punt) continue;

    const estat = resumEstatPunt(id_punt);
    const marker = crearMarker([lat, lon], estat);

    const ultims = obtenirUltimsPerParametre(id_punt);
    marker.bindPopup(htmlPopup({ id_punt, nom }, ultims));

    capaMarkers.addLayer(marker);
  }

  capaMarkers.addTo(map);
}

function renderitzarSectors() {
  if (!geoSectors) return;

  if (capaSectors) capaSectors.remove();

  capaSectors = L.geoJSON(geoSectors, {
    style: () => ({
      weight: 2,
      opacity: 0.9,
      fillOpacity: 0.08
      // sense definir colors concrets; Leaflet aplicarà un default.
      // si vols, podem fer un color corporatiu aquí.
    }),
    onEachFeature: (feature, layer) => {
      const nomSector = obtenirNomSector(feature.properties);
      layer.bindTooltip(nomSector, { sticky: true });
    }
  }).addTo(map);

  // Enviem els sectors al “fons” (per sota dels punts)
  if (capaSectors.bringToBack) capaSectors.bringToBack();
}

function omplirSelectors() {
  // Punts
  geoPunts.features.forEach((f) => {
    const opt = document.createElement("option");
    opt.value = f.properties.id_punt;
    opt.textContent = f.properties.nom;
    pointSelect.appendChild(opt);
  });

  // Paràmetres
  const params = Array.from(new Set(resultats.map((r) => r.parametre))).sort();
  params.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    paramSelect.appendChild(opt);
  });
}

function actualitzarUltimaActualitzacio() {
  if (!resultats.length) return;
  const maxDate = resultats
    .map((r) => new Date(r.data_mostra))
    .reduce((a, b) => (a > b ? a : b));

  updatedAt.textContent = `Última actualització: ${maxDate.toLocaleDateString("ca-ES")}`;
}

function ajustarVista() {
  // Ajusta la vista per incloure sectors i punts
  let bounds = null;

  try {
    if (geoPunts && geoPunts.features?.length) {
      bounds = L.geoJSON(geoPunts).getBounds();
    }
    if (geoSectors && geoSectors.features?.length) {
      const bS = L.geoJSON(geoSectors).getBounds();
      bounds = bounds ? bounds.extend(bS) : bS;
    }
  } catch {
    // ignore
  }

  if (bounds && bounds.isValid()) {
    map.fitBounds(bounds, {
      paddingTopLeft: [20, 20],
      paddingBottomRight: [20, 60],
      maxZoom: 13
    });
  } else {
    map.setView([41.045, 0.93], 12);
  }
}

// ====== Events ======
pointSelect.addEventListener("change", () => {
  filtres.puntId = pointSelect.value;
  renderitzarMarkers();
});

paramSelect.addEventListener("change", () => {
  filtres.parametre = paramSelect.value;
  renderitzarMarkers();
});

periodSelect.addEventListener("change", () => {
  filtres.diesPeriode = Number(periodSelect.value);
  renderitzarMarkers();
});

// ====== Càrrega inicial ======
async function init() {
  const [respPunts, respResultats, respSectors] = await Promise.all([
    fetch(DATA_POINTS),
    fetch(DATA_RESULTS),
    fetch(DATA_SECTORS)
  ]);

  if (!respPunts.ok) throw new Error(`No s'ha pogut carregar ${DATA_POINTS} (HTTP ${respPunts.status})`);
  if (!respResultats.ok) throw new Error(`No s'ha pogut carregar ${DATA_RESULTS} (HTTP ${respResultats.status})`);

  // Sectors: opcional (si no existeix, no trenquem)
  if (respSectors.ok) {
    geoSectors = await respSectors.json();
  } else {
    console.warn(`No s'ha pogut carregar ${DATA_SECTORS} (HTTP ${respSectors.status}). Continuem sense sectors.`);
    geoSectors = null;
  }

  geoPunts = await respPunts.json();

  const csvText = await respResultats.text();
  const raw = parseCSV(csvText);

  // CSV esperat: id_punt,data_mostra,parametre,valor,unitat,limit_min,limit_max
  resultats = raw.map((r) => ({
    id_punt: r.id_punt ?? r.id_punto ?? r.point_id ?? "",
    data_mostra: r.data_mostra ?? r.fecha_muestra ?? r.datetime ?? "",
    parametre: r.parametre ?? r.parametro ?? "",
    valor: r.valor ?? r.value ?? "",
    unitat: r.unitat ?? r.unidad ?? "",
    limit_min: r.limit_min ?? r.limite_min ?? "",
    limit_max: r.limit_max ?? r.limite_max ?? ""
  })).filter((r) => r.id_punt && r.data_mostra && r.parametre);

  omplirSelectors();
  actualitzarUltimaActualitzacio();

  // Primer dibuixem sectors (fons), després punts (a sobre)
  renderitzarSectors();
  renderitzarMarkers();

  // Ajust final de vista
  ajustarVista();
}

init().catch((err) => {
  console.error(err);
  alert("Error carregant dades. Revisa la consola i les rutes dels fitxers.");
});