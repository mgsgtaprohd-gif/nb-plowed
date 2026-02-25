const $ = (id) => document.getElementById(id);

const tabMap = $("tabMap");
const tabList = $("tabList");
const mapWrap = $("mapWrap");
const listWrap = $("listWrap");
const search = $("search");
const listEl = $("list");

let streetsGeo = null;
let statusById = {};
let streetLayers = new Map();

function setTab(which) {
  const isMap = which === "map";
  tabMap.classList.toggle("active", isMap);
  tabList.classList.toggle("active", !isMap);
  tabMap.setAttribute("aria-selected", String(isMap));
  tabList.setAttribute("aria-selected", String(!isMap));
  mapWrap.classList.toggle("hidden", !isMap);
  listWrap.classList.toggle("hidden", isMap);
}

tabMap.addEventListener("click", () => setTab("map"));
tabList.addEventListener("click", () => setTab("list"));

function badgeFor(status) {
  if (!status) return { text: "Unknown", cls: "gray" };
  if (status.state === "plowed") return { text: "Plowed", cls: "green" };
  if (status.state === "not_plowed") return { text: "Not plowed", cls: "red" };
  if (status.state === "mixed") return { text: "Mixed", cls: "amber" };
  return { text: "Unknown", cls: "gray" };
}

function colorFor(status) {
  if (!status) return "#7f8c8d";
  if (status.state === "plowed") return "#2ecc71";
  if (status.state === "not_plowed") return "#ff4d4d";
  if (status.state === "mixed") return "#f1c40f";
  return "#7f8c8d";
}

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data;
}

async function loadData() {
  streetsGeo = await fetchJSON("/streets.geojson");
  const status = await fetchJSON("/api/status");
  statusById = status?.byStreetId || {};
}

function getStreetId(feature) {
  // REQUIRED: your GeoJSON must include a stable id in properties.street_id
  return feature?.properties?.street_id;
}

function getStreetName(feature) {
  return feature?.properties?.name || feature?.properties?.street || "Unnamed";
}

async function vote(streetId, value) {
  // Client-side cooldown so it “feels” responsive, server enforces real limits too
  const key = `cooldown:${streetId}`;
  const last = Number(localStorage.getItem(key) || 0);
  const now = Date.now();
  if (now - last < 60_000) throw new Error("Slow down — try again in a minute.");

  await fetchJSON("/api/vote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ streetId, vote: value ? "plowed" : "not_plowed" })
  });

  localStorage.setItem(key, String(now));

  // refresh status
  const status = await fetchJSON("/api/status");
  statusById = status?.byStreetId || {};
  renderList();
  repaintMap();
}

function renderList() {
  const q = search.value.trim().toLowerCase();
  const feats = streetsGeo.features
    .filter(f => getStreetId(f))
    .map(f => ({
      id: getStreetId(f),
      name: getStreetName(f),
      status: statusById[getStreetId(f)]
    }))
    .filter(x => !q || x.name.toLowerCase().includes(q))
    .sort((a,b) => a.name.localeCompare(b.name));

  listEl.innerHTML = "";

  for (const item of feats) {
    const b = badgeFor(item.status);

    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role","listitem");

    const left = document.createElement("div");
    const h = document.createElement("h3");
    h.textContent = item.name;

    const meta = document.createElement("div");
    meta.className = "meta";
    const votes = item.status?.totalVotesLast24h ?? 0;
    meta.textContent = votes ? `${votes} vote(s) in last 24h` : "No recent votes";

    left.appendChild(h);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.style.display = "grid";
    right.style.gap = "8px";
    right.style.justifyItems = "end";

    const badge = document.createElement("div");
    badge.className = `badge ${b.cls}`;
    badge.textContent = b.text;

    const actions = document.createElement("div");
    actions.className = "actions";

    const btnYes = document.createElement("button");
    btnYes.className = "btn";
    btnYes.textContent = "Plowed";
    btnYes.addEventListener("click", async () => {
      btnYes.disabled = true; btnNo.disabled = true;
      try { await vote(item.id, true); }
      catch (e) { alert(e.message || String(e)); }
      finally { btnYes.disabled = false; btnNo.disabled = false; }
    });

    const btnNo = document.createElement("button");
    btnNo.className = "btn";
    btnNo.textContent = "Not plowed";
    btnNo.addEventListener("click", async () => {
      btnYes.disabled = true; btnNo.disabled = true;
      try { await vote(item.id, false); }
      catch (e) { alert(e.message || String(e)); }
      finally { btnYes.disabled = false; btnNo.disabled = false; }
    });

    actions.appendChild(btnYes);
    actions.appendChild(btnNo);

    right.appendChild(badge);
    right.appendChild(actions);

    card.appendChild(left);
    card.appendChild(right);
    listEl.appendChild(card);
  }
}

let map, geoLayer;

function repaintMap() {
  if (!geoLayer) return;
  geoLayer.eachLayer(layer => {
    const f = layer.feature;
    const id = getStreetId(f);
    const st = statusById[id];
    layer.setStyle({
      color: colorFor(st),
      weight: 4,
      opacity: 0.9
    });
  });
}

function initMap() {
  // New Bedford-ish center
  map = L.map("map", { preferCanvas: true }).setView([41.6362, -70.9342], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  geoLayer = L.geoJSON(streetsGeo, {
    style: (feature) => {
      const id = getStreetId(feature);
      const st = statusById[id];
      return { color: colorFor(st), weight: 4, opacity: 0.9 };
    },
    onEachFeature: (feature, layer) => {
      const id = getStreetId(feature);
      const name = getStreetName(feature);
      streetLayers.set(id, layer);

      layer.bindPopup(() => {
        const st = statusById[id];
        const b = badgeFor(st);
        const votes = st?.totalVotesLast24h ?? 0;

        const wrap = document.createElement("div");
        wrap.style.display = "grid";
        wrap.style.gap = "8px";

        const title = document.createElement("strong");
        title.textContent = name;

        const status = document.createElement("div");
        status.textContent = `${b.text} (${votes} vote(s) / 24h)`;

        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "8px";

        const yes = document.createElement("button");
        yes.className = "btn";
        yes.textContent = "Plowed";
        yes.onclick = async () => {
          yes.disabled = true; no.disabled = true;
          try { await vote(id, true); layer.openPopup(); }
          catch (e) { alert(e.message || String(e)); }
          finally { yes.disabled = false; no.disabled = false; }
        };

        const no = document.createElement("button");
        no.className = "btn";
        no.textContent = "Not plowed";
        no.onclick = async () => {
          yes.disabled = true; no.disabled = true;
          try { await vote(id, false); layer.openPopup(); }
          catch (e) { alert(e.message || String(e)); }
          finally { yes.disabled = false; no.disabled = false; }
        };

        row.appendChild(yes);
        row.appendChild(no);

        wrap.appendChild(title);
        wrap.appendChild(status);
        wrap.appendChild(row);
        return wrap;
      });
    }
  }).addTo(map);
}

search.addEventListener("input", () => renderList());

(async function main() {
  try {
    await loadData();
    renderList();
    initMap();
  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
  }
})();
