const ranks = ['Helipad', 'Paddock', 'Paddock Club', 'Main Gate', 'Fusion Lounge'];
const CACHE_KEY = 'rankflow-state-v2', LEGACY_KEY = 'rankflow-departures-v1', OUTBOX_KEY = 'rankflow-outbox-v1';
const RANK_KEY = 'rankflow-device-rank', MARSHAL_KEY = 'rankflow-active-marshal';
let state = { departures: [], drivers: [] }, passengerCount = 1, online = false;
let selectedRank = localStorage.getItem(RANK_KEY) || '', activeMarshal = sessionStorage.getItem(MARSHAL_KEY) || 'Marshal';
const $ = selector => document.querySelector(selector);
const today = () => new Date().toLocaleDateString('en-CA');
const formatTime = value => new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit' }).format(new Date(value));
const escapeHtml = text => String(text).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[c]));
const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; } };
const cacheState = next => { state = next; localStorage.setItem(CACHE_KEY, JSON.stringify(next)); renderAll(); };

async function request(path, options) {
  const response = await fetch(path, { ...options, headers:{ 'content-type':'application/json', ...(options?.headers || {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Request failed (${response.status})`);
  return response.json();
}
function setConnection(value) { online = value; $('#connection-label').textContent = value ? 'SERVER LIVE' : 'OFFLINE MODE'; $('#connection-chip').classList.toggle('offline', !value); }
async function syncState() {
  try { const serverState = await request('/api/state'); setConnection(true); cacheState(serverState); await flushOutbox(); }
  catch { setConnection(false); cacheState(readJson(CACHE_KEY, { departures:readJson(LEGACY_KEY, []), drivers:[] })); }
}
async function flushOutbox() {
  const outbox = readJson(OUTBOX_KEY, []); if (!outbox.length) return;
  const remaining = [];
  for (const item of outbox) { try { await request(item.path, { method:item.method, body:JSON.stringify(item.body) }); } catch { remaining.push(item); } }
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(remaining));
  if (!remaining.length) { cacheState(await request('/api/state')); toast('Offline changes synced'); }
}
async function sendOrQueue(path, method, body) {
  try { const result = await request(path, { method, body:JSON.stringify(body) }); setConnection(true); return result; }
  catch { setConnection(false); localStorage.setItem(OUTBOX_KEY, JSON.stringify([...readJson(OUTBOX_KEY, []), { path, method, body }])); return body; }
}
function showView(view) {
  const marshalView = view === 'marshal';
  document.body.dataset.view = marshalView ? 'marshal' : 'welcome';
  $('#welcome').hidden = marshalView;
  $('#marshal').hidden = !marshalView;
  if (marshalView) { if (!selectedRank) openRankDialog(); renderMarshal(); }
  window.location.hash = marshalView ? 'marshal' : 'welcome';
}
function openRankDialog() { $('#rank-options').innerHTML = ranks.map(rank => `<button type="button" class="rank-option" data-rank="${rank}">${rank}</button>`).join(''); $('#rank-dialog').showModal(); }
function selectRank(rank) { selectedRank = rank; localStorage.setItem(RANK_KEY, rank); showView('marshal'); }
function renderActiveRank() { $('#active-rank-label').textContent = selectedRank || 'Choose a rank'; }
function renderMarshalProfile() { const profile = $('#marshal-profile'); profile.hidden = false; profile.textContent = activeMarshal ? `On duty: ${activeMarshal}` : 'Marshal details (optional)'; }
function renderMarshal() {
  $('#selected-rank-label').textContent = selectedRank || 'Choose a rank'; renderActiveRank();
  const logs = state.departures.filter(log => log.rank === selectedRank && log.status !== 'cancelled' && log.jobStatus === 'collected').slice().reverse();
  $('#rank-total').textContent = `${logs.length} out`;
  $('#recent-list').innerHTML = logs.length ? logs.map(log => `<article class="recent-item"><div class="taxi-badge">${escapeHtml(log.taxiNumber)}</div><div><strong>${escapeHtml(log.destination)}</strong><small>${log.passengers} passenger${log.passengers === 1 ? '' : 's'} · Left ${formatTime(log.timestamp)}</small></div><div class="recent-actions"><span class="onboard-label">Awaiting drop-off</span><button type="button" class="row-action danger" data-cancel-departure="${escapeHtml(log.id)}">Cancel</button></div></article>`).join('') : '<p class="empty-state">No taxis with passengers currently out from this rank.</p>';
}
function renderAll() {
  renderMarshal();
  renderTaxiStatus();
  const logs = state.departures.filter(log => log.date === today() && log.status !== 'cancelled');
  $('#hero-total').textContent = logs.length;
  $('#hero-passengers').textContent = logs.reduce((sum, log) => sum + log.passengers, 0);
  $('#hero-ranks').textContent = new Set(logs.map(log => log.rank)).size;
}
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 2600); }
const showTaxiKeypad = () => { $('#taxi-keypad').hidden = false; }, hideTaxiKeypad = () => { $('#taxi-keypad').hidden = true; };
function renderTaxiStatus() {
  const number = $('#taxi-number').value.trim(), message = $('#taxi-status');
  if (!number) { message.textContent = 'Enter the next taxi number.'; message.dataset.state = ''; return; }
  if (!/^\d{2}$/.test(number)) { message.textContent = 'Enter both digits of the taxi number.'; message.dataset.state = 'waiting'; return; }
  if (!online) { message.textContent = 'Waiting for the live connection before sending a job.'; message.dataset.state = 'waiting'; return; }
  const driver = state.drivers.find(item => item.taxiNumber === number);
  if (!driver) { message.textContent = `Taxi ${number} has no active driver phone. Add it in Drive Office first.`; message.dataset.state = 'blocked'; return; }
  if (driver.jobId || driver.status === 'busy') { message.textContent = `Taxi ${number} is already on a job. Choose another taxi, or wait for the driver to complete drop-off.`; message.dataset.state = 'blocked'; return; }
  if (driver.status !== 'available') { message.textContent = `Taxi ${number} is off shift. The driver must check in before receiving a job.`; message.dataset.state = 'blocked'; return; }
  message.textContent = `Taxi ${number} is ready to receive this job.`; message.dataset.state = 'ready';
}
function setPassengerCount(value) {
  passengerCount = Math.max(1, Math.min(6, Number(value)));
  document.querySelectorAll('[data-passenger-count]').forEach(button => {
    const selected = Number(button.dataset.passengerCount) === passengerCount;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

$('#quick-rank-options').innerHTML = ranks.map(rank => `<button type="button" class="quick-rank-option" data-quick-rank="${rank}">${rank}</button>`).join('');
$('#quick-rank-options').addEventListener('click', event => { const button = event.target.closest('[data-quick-rank]'); if (button) selectRank(button.dataset.quickRank); });
$('#rank-options').addEventListener('click', event => { const button = event.target.closest('[data-rank]'); if (!button) return; selectedRank = button.dataset.rank; localStorage.setItem(RANK_KEY, selectedRank); $('#rank-dialog').close(); renderMarshal(); });
$('#marshal-login-form').addEventListener('submit', event => { event.preventDefault(); const name = $('#marshal-login-name').value.trim(); if (!name) return; activeMarshal = name; sessionStorage.setItem(MARSHAL_KEY, name); $('#marshal-login').close(); renderMarshalProfile(); toast(`Marshal name updated to ${name}`); });
$('#marshal-profile').addEventListener('click', () => { $('#marshal-login-name').value = activeMarshal; $('#marshal-login').showModal(); });
$('#change-rank').addEventListener('click', openRankDialog);
$('#taxi-number').addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g,'').slice(0,2); renderTaxiStatus(); });
$('#next-taxi').addEventListener('click', () => { $('#taxi-number').value = ''; hideTaxiKeypad(); renderTaxiStatus(); $('#taxi-number').focus(); });
$('#open-taxi-keypad').addEventListener('click', showTaxiKeypad);
$('#keypad-done').addEventListener('click', hideTaxiKeypad);
$('#taxi-keypad').addEventListener('click', event => { const key = event.target.closest('[data-key]')?.dataset.key; if (!key) return; const input = $('#taxi-number'); if (key === 'delete') input.value = input.value.slice(0,-1); else if (key === 'clear') input.value = ''; else if (input.value.length < 2) input.value += key; renderTaxiStatus(); });
document.querySelectorAll('[data-passenger-count]').forEach(button => button.addEventListener('click', () => setPassengerCount(button.dataset.passengerCount)));
$('#departure-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!selectedRank) return openRankDialog();
  const form = new FormData(event.currentTarget), taxiNumber = String(form.get('taxiNumber')).replace(/\D/g,'');
  if (taxiNumber.length !== 2) { showTaxiKeypad(); return toast('Enter the two-digit taxi number before logging.'); }
  const departure = { id:crypto.randomUUID(), date:today(), timestamp:new Date().toISOString(), rank:selectedRank, destination:String(form.get('destination')).trim(), passengers:passengerCount, taxiNumber, marshalName:activeMarshal };
  const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
  try {
    const saved = await request('/api/departures', {method:'POST',body:JSON.stringify(departure)});
    event.currentTarget.reset(); $('#destination').value = ''; $('#taxi-number').value = ''; hideTaxiKeypad(); setPassengerCount(1); renderTaxiStatus();
    await syncState();
    toast(saved.notification?.sent ? `Taxi ${taxiNumber} sent · phone alerted` : `Taxi ${taxiNumber} sent · open the driver app`);
    if (!state.departures.some(item => item.id === saved.id)) cacheState({...state,departures:[...state.departures,saved]});
  } catch (error) { toast(error.message || 'Could not send the job. Keep the details and try again.'); }
  finally { button.disabled = false; }
});
async function updateDeparture(id, action) {
  const departure = state.departures.find(item => item.id === id); if (!departure) return;
  try { await request(`/api/departures/${encodeURIComponent(id)}`, {method:'PATCH',body:JSON.stringify({action})}); await syncState(); toast(action === 'cancel' ? 'Job cancelled and taxi returned to the queue' : action === 'restore' ? 'Job restored to departures' : 'Cancelled job marked as collected'); }
  catch (error) { toast(error.message || 'Could not update the job. Refresh and try again.'); }
}
$('#recent-list').addEventListener('click', event => { const id = event.target.closest('[data-cancel-departure]')?.dataset.cancelDeparture; if (id) updateDeparture(id, 'cancel'); });
window.addEventListener('online', syncState);
window.addEventListener('hashchange', () => {
  if (!['#welcome', '#marshal'].includes(location.hash)) showView(selectedRank ? 'marshal' : 'welcome');
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js');
cacheState(readJson(CACHE_KEY, { departures:readJson(LEGACY_KEY, []), drivers:[] })); renderActiveRank(); renderMarshalProfile();
showView(location.hash === '#marshal' ? 'marshal' : 'welcome');
syncState();
setInterval(syncState, 3000);
window.addEventListener('focus', syncState);
