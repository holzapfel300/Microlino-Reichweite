const BATTERY_KWH = 15;
const WLTP_KM = 228;
const STORAGE_KEY = "microlino_reichweite_trips_v1";
let watchId = null;
let currentTrip = null;

const $ = (id) => document.getElementById(id);

function loadTrips(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveTrips(trips){ localStorage.setItem(STORAGE_KEY, JSON.stringify(trips)); }
function km(m){ return m / 1000; }
function haversine(a,b){
  const R=6371000, toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon);
  const lat1=toRad(a.lat), lat2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function classify(avgSpeed, stops){
  if (avgSpeed >= 75) return "Autobahn";
  if (avgSpeed >= 45) return "Landstraße";
  if (stops >= 4 || avgSpeed < 35) return "Stadt";
  return "Gemischt";
}
function learnedKmPerPercent(trips){
  const valid = trips.filter(t => t.percentUsed > 0 && t.distanceKm > 0.2);
  if (!valid.length) return null;
  const totalKm = valid.reduce((s,t)=>s+t.distanceKm,0);
  const totalPct = valid.reduce((s,t)=>s+t.percentUsed,0);
  return totalKm / totalPct;
}
function render(){
  const trips = loadTrips();
  const learned = learnedKmPerPercent(trips);
  $("learnedRange").textContent = learned ? `${Math.round(learned * 100)} km bei 100 %` : "Noch keine Daten";
  const list = $("tripList");
  if (!trips.length) { list.innerHTML = "<p class='hint'>Noch keine Fahrten gespeichert.</p>"; return; }
  list.innerHTML = trips.slice().reverse().map(t => `
    <div class="trip">
      <strong>${t.distanceKm.toFixed(1)} km · ${t.percentUsed.toFixed(1)} % Akku</strong>
      <small>${new Date(t.startedAt).toLocaleString("de-DE")} · ${t.type} · Ø ${Math.round(t.avgSpeedKmh)} km/h · Restprognose ${Math.round(t.estimatedRemainingKm)} km</small>
    </div>`).join("");
}
function updateLive(){
  if (!currentTrip) return;
  const dKm = km(currentTrip.distanceM);
  const elapsedH = (Date.now() - currentTrip.startedAt) / 3600000;
  const avgSpeed = elapsedH > 0 ? dKm / elapsedH : 0;
  $("liveDistance").textContent = `${dKm.toFixed(2)} km`;
  $("liveSpeed").textContent = `${Math.round(currentTrip.lastSpeedKmh || 0)} km/h`;
  $("liveType").textContent = classify(avgSpeed, currentTrip.stops);
  $("liveElevation").textContent = `${Math.round(currentTrip.elevationDeltaM)} m`;
}
function startTrip(){
  const startBattery = Number($("startBattery").value);
  if (!startBattery || startBattery < 1 || startBattery > 100) { alert("Bitte Start-Akkustand zwischen 1 und 100 eingeben."); return; }
  if (!navigator.geolocation) { alert("GPS wird von diesem Browser nicht unterstützt."); return; }
  currentTrip = { startBattery, startedAt: Date.now(), points: [], distanceM: 0, stops: 0, elevationDeltaM: 0, lastSpeedKmh: 0 };
  $("setupCard").classList.add("hidden");
  $("activeCard").classList.remove("hidden");
  watchId = navigator.geolocation.watchPosition(pos => {
    const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, alt: pos.coords.altitude, t: Date.now() };
    const pts = currentTrip.points;
    if (pts.length) {
      const prev = pts[pts.length-1];
      const step = haversine(prev,p);
      if (step < 250) currentTrip.distanceM += step;
      if (typeof p.alt === "number" && typeof prev.alt === "number") currentTrip.elevationDeltaM += p.alt - prev.alt;
    }
    const speed = pos.coords.speed == null ? 0 : pos.coords.speed * 3.6;
    currentTrip.lastSpeedKmh = speed;
    if (speed < 3) currentTrip.stops += 1;
    pts.push(p);
    updateLive();
  }, err => alert("GPS-Fehler: " + err.message), { enableHighAccuracy:true, maximumAge:1000, timeout:10000 });
}
function stopTrip(){
  const endBattery = Number($("endBattery").value);
  if (endBattery < 0 || endBattery > 100 || endBattery >= currentTrip.startBattery) { alert("Bitte End-Akkustand kleiner als Start-Akkustand eingeben."); return; }
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  const distanceKm = km(currentTrip.distanceM);
  const percentUsed = currentTrip.startBattery - endBattery;
  const kwhUsed = BATTERY_KWH * (percentUsed / 100);
  const kwhPer100 = distanceKm > 0 ? (kwhUsed / distanceKm) * 100 : 0;
  const kmPerPercent = distanceKm / percentUsed;
  const elapsedH = (Date.now() - currentTrip.startedAt) / 3600000;
  const avgSpeedKmh = elapsedH > 0 ? distanceKm / elapsedH : 0;
  const type = classify(avgSpeedKmh, currentTrip.stops);
  const estimatedRemainingKm = endBattery * kmPerPercent;
  const trip = { ...currentTrip, endedAt: Date.now(), endBattery, distanceKm, percentUsed, kwhUsed, kwhPer100, kmPerPercent, avgSpeedKmh, type, estimatedRemainingKm, weather:null, wind:null };
  const trips = loadTrips(); trips.push(trip); saveTrips(trips);
  $("activeCard").classList.add("hidden");
  $("resultCard").classList.remove("hidden");
  $("setupCard").classList.remove("hidden");
  $("startBattery").value = endBattery;
  $("endBattery").value = "";
  $("resultText").innerHTML = `
    <p><strong>${distanceKm.toFixed(1)} km</strong> gefahren, <strong>${percentUsed.toFixed(1)} %</strong> Akku verbraucht.</p>
    <p>Verbrauch: ${kwhPer100.toFixed(1)} kWh/100 km. Fahrtyp: ${type}. Geschätzte Restreichweite bei ${endBattery}%: <strong>${Math.round(estimatedRemainingKm)} km</strong>.</p>`;
  currentTrip = null; render();
}
function exportData(){
  const blob = new Blob([JSON.stringify(loadTrips(), null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "microlino-reichweite-export.json"; a.click(); URL.revokeObjectURL(a.href);
}
$("startBtn").addEventListener("click", startTrip);
$("stopBtn").addEventListener("click", stopTrip);
$("exportBtn").addEventListener("click", exportData);
render();
