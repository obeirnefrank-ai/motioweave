const $ = selector => document.querySelector(selector);
const THEME_KEY = 'motion-weave-operations-theme';
const applyTheme = theme => { const dark = theme !== 'light'; document.body.classList.toggle('dark-mode',dark); const button=$('#theme-toggle'); button.setAttribute('aria-pressed',String(dark)); button.querySelector('b').textContent=dark ? 'Light screen' : 'Dark screen'; document.querySelector('meta[name="theme-color"]').content=dark ? '#071813' : '#eef1ed'; };
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
$('#theme-toggle').addEventListener('click',()=>{const next=document.body.classList.contains('dark-mode')?'light':'dark';localStorage.setItem(THEME_KEY,next);applyTheme(next);});
let drivers = [];
let jobs = [];
let departures = [];
let activeFilter = 'ready';
let selectedArea = '';
const escapeHtml = text => String(text ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#039;', '"':'&quot;' }[c]));
const mockMode = location.protocol === 'file:';
const previewFleet = Array.from({ length:100 }, (_, index) => { const number = String((index + 1) % 100).padStart(2,'0'), available = index < 15, busy = index >= 15 && index < 35, unavailable = index >= 35 && index < 45; return { id:`fleet-${number}`, taxiNumber:number, name:['James','Amir','Daniel','Mark','David','Michael','Paul','Chris'][index % 8] + ` ${String.fromCharCode(65 + index % 20)}.`, status:available || busy ? 'available' : unavailable ? (index % 2 ? 'break' : 'offline') : 'inactive', jobStatus:busy ? (index % 2 ? 'assigned' : 'booked') : '', allocatedArea:index >= 45 && index < 53 ? 'Heliport' : '', availableSince:new Date(Date.now() - (available ? (120 - index * 5) : 0) * 60000).toISOString() }; });
const activeStatuses = ['assigned','accepted','collected','cancel_requested','booked','predetermined'];
const isAreaAllocated = driver => Boolean(driver.allocatedArea);
const isEligible = driver => driver.status === 'available' && !driver.connectionLost && !isAreaAllocated(driver) && !activeStatuses.includes(driver.jobStatus) && !driver.jobId;
const isWorking = driver => activeStatuses.includes(driver.jobStatus) || Boolean(driver.jobId);
const waitingFrom = driver => new Date(driver.availableSince || driver.lastJobCompletedAt || driver.updatedAt || Date.now()).getTime();
const waitingLabel = driver => { const minutes = Math.max(0,Math.floor((Date.now() - waitingFrom(driver))/60000)); return minutes >= 60 ? `${Math.floor(minutes/60)}h ${minutes%60}m` : `${minutes} min`; };
const driverActivity = driver => { if (driver.jobStatus === 'cancel_requested') return {label:'Cancelled',className:'on-job job-cancelled',detail:`${driver.pickup || 'Pickup'} → ${driver.destination || 'Destination'}`}; if (driver.connectionLost) return { label:'Connection lost', className:'offline', detail:driver.lastSeenAt ? `Phone last seen ${waitingLabel({availableSince:driver.lastSeenAt})} ago` : 'Phone heartbeat missing' }; if (isEligible(driver)) return { label:'Ready for work', className:'ready', detail:'Available to receive a job' }; if (isWorking(driver)) return { label:{assigned:'Awaiting acknowledgement',accepted:'Travelling to pickup',collected:'Passenger onboard'}[driver.jobStatus] || 'On a job', className:'on-job ' + ({assigned:'job-awaiting',accepted:'job-pickup',collected:'job-onboard'}[driver.jobStatus] || ''), detail:driver.pickup || driver.destination ? `${driver.pickup || 'Pickup'} → ${driver.destination || 'Destination'}` : 'Job in progress' }; if (driver.status === 'break') return { label:'On break', className:'break', detail:'Temporarily unavailable' }; if (driver.status === 'offline') return { label:'Offline', className:'offline', detail:'Driver is off shift' }; return { label:'Not scheduled', className:'inactive', detail:'Not active at this event' }; };
const shiftStatus = driver => driver.status === 'break' ? {label:'On break',className:'break',detail:'Temporarily unavailable'} : ['offline','inactive'].includes(driver.status) || driver.connectionLost ? {label:'Off shift',className:'off-shift',detail:'Not currently working'} : {label:'On shift',className:'on-shift',detail:isWorking(driver) ? 'Currently on a job' : isAreaAllocated(driver) ? 'Working in this area' : 'Ready to receive work'};
function render() {
  const onboard = departures.filter(item => item.status !== 'cancelled' && item.jobStatus === 'collected').sort((a,b) => new Date(b.timestamp)-new Date(a.timestamp));
  $('#marshal-live-count').textContent = onboard.length;
  $('#marshal-live-list').innerHTML = onboard.length ? onboard.map(item => `<article class="marshal-live-item"><div><strong>Taxi ${escapeHtml(item.taxiNumber)}</strong><time>${new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date(item.timestamp))}</time></div><span>${escapeHtml(item.rank)} → ${escapeHtml(item.destination)}</span><small>${Number(item.passengers)} passenger${Number(item.passengers) === 1 ? '' : 's'} · ${escapeHtml(item.marshalName)}</small></article>`).join('') : '<p class="marshal-live-empty">No taxis currently out.</p>';
  const fleet = mockMode ? previewFleet : drivers, query = $('#fleet-search').value.trim().toLowerCase();
  const available = fleet.filter(isEligible).sort((a,b) => waitingFrom(a)-waitingFrom(b));
  const jobRows = fleet.filter(isWorking);
  const busy = jobRows.length;
  const unavailable = fleet.filter(driver => ['break','offline'].includes(driver.status) || driver.connectionLost), allocated = fleet.filter(isAreaAllocated);
  const filtered = activeFilter === 'ready' ? available : activeFilter === 'busy' ? jobRows : activeFilter === 'unavailable' ? unavailable : activeFilter === 'allocated' ? allocated : fleet;
  const shown = (query ? filtered.filter(driver => `${driver.taxiNumber} ${driver.name}`.toLowerCase().includes(query)) : filtered).slice().sort((a,b) => activeFilter === 'ready' && !query ? waitingFrom(a)-waitingFrom(b) : a.taxiNumber.localeCompare(b.taxiNumber));
  $('#available-count').textContent = available.length; $('#busy-count').textContent = busy; $('#offline-count').textContent = unavailable.length; $('#allocated-count').textContent = new Set([...document.querySelectorAll('[name="allocatedArea"] option')].map(option => option.value).filter(Boolean)).size;
  const marshalView = activeFilter === 'marshal';
  $('#marshal-departures-card').hidden = !marshalView;
  $('.queue-card').hidden = marshalView;
  if (marshalView) return;
  const filterText = { ready:['NEXT TAXI FIRST','Longest waiting','Only Drive Office taxis ready to accept jobs are shown.','available'], busy:['ACTIVE WORK','On jobs and booked','Active jobs and cancellations awaiting confirmation.','jobs'], unavailable:['UNAVAILABLE','Break and offline','Taxis temporarily unavailable or disconnected.','unavailable'], allocated:['FIXED AREA DRIVERS','Area allocations','These drivers are excluded from the booking queue.','area-allocated'], all:['EVENT FLEET','All registered phones','Every taxi phone registered at this event.','registered'] }[activeFilter];
  $('#queue-kicker').textContent = query ? 'FLEET SEARCH' : filterText[0]; $('#queue-list-title').textContent = query ? 'Search results' : filterText[1]; $('#queue-list-copy').textContent = query ? 'Searching taxis in the selected category.' : filterText[2];
  $('#result-count').textContent = query ? `${shown.length} event taxi${shown.length === 1 ? '' : 's'} found` : activeFilter === 'busy' ? `Showing ${shown.length} job${shown.length === 1 ? '' : 's'}` : `Showing ${shown.length} ${filterText[3]} taxi${shown.length === 1 ? '' : 's'}`;
  const areaView = activeFilter === 'allocated';
  $('.column-head').hidden = areaView;
  $('.queue-card footer span:last-child').textContent = areaView ? 'Area taxis are excluded from ready for work' : activeFilter === 'ready' ? 'Automatically ordered by waiting time' : 'Ordered by taxi number';
  $('.queue-titlebar label span').textContent = areaView ? 'Search for a taxi' : 'Search this category';
  $('#fleet-search').placeholder = areaView ? 'Enter taxi number' : 'Taxi number or driver name';
  $('#fleet-search').inputMode = areaView ? 'numeric' : 'search';
  if (areaView) {
    const areas = new Map([...document.querySelectorAll('[name="allocatedArea"] option')].map(option => option.value).filter(Boolean).map(name => [name, 0]));
    allocated.forEach(driver => areas.set(driver.allocatedArea, (areas.get(driver.allocatedArea) || 0) + 1));
    if (selectedArea && !areas.has(selectedArea)) selectedArea = '';
    $('#queue-kicker').textContent = 'AREA ALLOCATIONS';
    $('#queue-list-title').textContent = 'Areas';
    $('#taxi-queue').classList.remove('search-results');
    if (query) {
      const taxiQuery = query.replace(/\D/g,'');
      const matches = taxiQuery ? fleet.filter(driver => String(driver.taxiNumber).includes(taxiQuery)).sort((a,b) => a.taxiNumber.localeCompare(b.taxiNumber)) : [];
      $('#queue-list-copy').textContent = 'Matching taxis and their current allocated area.';
      $('#result-count').textContent = `${matches.length} taxi${matches.length === 1 ? '' : 's'} found`;
      $('#taxi-queue').innerHTML = matches.length ? `<div class="area-taxi-results"><div class="area-driver-head area-search-head"><span>Taxi and driver</span><span>Allocated area</span><span>Shift status</span></div>${matches.map(driver => { const shift = shiftStatus(driver), area = driver.allocatedArea || (isEligible(driver) ? 'Ready for work' : 'No allocated area'); return `<article class="area-driver-row area-search-row"><div class="driver"><button class="taxi-number driver-actions-trigger" type="button" data-driver-actions="${escapeHtml(driver.id)}" aria-label="Open actions for Taxi ${escapeHtml(driver.taxiNumber)}">${escapeHtml(driver.taxiNumber)}</button><div><strong>Taxi ${escapeHtml(driver.taxiNumber)}</strong><small>${escapeHtml(driver.name || 'Driver not named')}</small></div></div><div class="area-match-location"><span>${driver.allocatedArea ? 'Allocated area' : isEligible(driver) ? 'Queue status' : 'Allocated area'}</span><strong>${escapeHtml(area)}</strong></div><div class="shift-state"><span class="shift-pill ${shift.className}">${shift.label}</span><small>${escapeHtml(shift.detail)}</small></div></article>`; }).join('')}</div>` : `<p class="empty">${taxiQuery ? `No taxi number matches “${escapeHtml(taxiQuery)}”.` : 'Enter a taxi number to search.'}</p>`;
      return;
    }
    const shownAreas = [...areas];
    $('#queue-list-copy').textContent = 'Click an area bar to expand its taxis, or use Add to place a driver there.';
    $('#result-count').textContent = `Showing ${shownAreas.length} areas · ${allocated.length} allocated taxis in total`;
    $('#taxi-queue').innerHTML = shownAreas.length ? `<div class="area-accordion-list">${shownAreas.map(([name, count]) => {
      const expanded = selectedArea === name;
      const areaDrivers = allocated.filter(driver => driver.allocatedArea === name).sort((a,b) => a.taxiNumber.localeCompare(b.taxiNumber));
      const rows = areaDrivers.length ? `<div class="area-driver-head"><span>Taxi and driver</span><span>Shift status</span><span>Action</span></div>${areaDrivers.map(driver => { const shift = shiftStatus(driver); return `<article class="area-driver-row"><div class="driver"><button class="taxi-number driver-actions-trigger" type="button" data-driver-actions="${escapeHtml(driver.id)}" aria-label="Open actions for Taxi ${escapeHtml(driver.taxiNumber)}">${escapeHtml(driver.taxiNumber)}</button><div><strong>${escapeHtml(driver.name || 'Driver not named')}</strong><small>Taxi ${escapeHtml(driver.taxiNumber)}</small></div></div><div class="shift-state"><span class="shift-pill ${shift.className}">${shift.label}</span><small>${escapeHtml(shift.detail)}</small></div><button class="allocate-driver" type="button" data-allocate-driver="${escapeHtml(driver.id)}">Edit</button></article>`; }).join('')}` : `<p class="empty">No taxis are allocated to ${escapeHtml(name)} yet. Use Add to place one here.</p>`;
      return `<section class="area-accordion${expanded ? ' expanded' : ''}"><div class="area-bar"><button type="button" class="area-bar-toggle" data-toggle-area="${escapeHtml(name)}" aria-expanded="${expanded}"><span><strong>${escapeHtml(name)}</strong><small>Click to ${expanded ? 'hide' : 'view'} taxis in this area</small></span><span class="area-bar-count"><b>${count}</b> ${count === 1 ? 'taxi' : 'taxis'} <em>${expanded ? '▲' : '▼'}</em></span></button><button type="button" class="area-bar-add" data-add-area-driver="${escapeHtml(name)}">Add</button></div>${expanded ? `<div class="area-dropdown">${rows}</div>` : ''}</section>`;
    }).join('')}</div>` : '<p class="empty">No areas match your search.</p>';
    return;
  }
  $('#taxi-queue').classList.toggle('search-results',Boolean(query));
  $('#taxi-queue').innerHTML = shown.length ? shown.map((driver,index) => { const activity = driverActivity(driver), ready = isEligible(driver), working = isWorking(driver), area = driver.allocatedArea || ''; return `<article class="queue-row${!query && activeFilter === 'ready' && index === 0 ? ' first' : ''}"><strong class="position">${index+1}</strong><div class="driver"><button class="taxi-number driver-actions-trigger" type="button" data-driver-actions="${escapeHtml(driver.id)}" aria-label="Open actions for Taxi ${escapeHtml(driver.taxiNumber)}">${escapeHtml(driver.taxiNumber)}</button><div><strong>Taxi ${escapeHtml(driver.taxiNumber)}</strong><small>${escapeHtml(driver.name || 'Driver not named')} · ${escapeHtml(area ? `Allocated to ${area}` : activity.detail)} · ${driver.hasJobAlerts ? 'Phone alerts on' : 'Phone alerts off'}</small></div></div><time>${ready ? new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date(waitingFrom(driver))) : '—'}</time><strong class="waiting">${ready ? waitingLabel(driver) : '—'}</strong>${area ? `<div class="area-row-actions"><span class="area-pill">${escapeHtml(area)}</span><button class="allocate-driver" type="button" data-allocate-driver="${escapeHtml(driver.id)}">Change</button></div>` : ready ? `<div class="area-row-actions"><button class="allocate-driver" type="button" data-allocate-driver="${escapeHtml(driver.id)}">Area</button><button class="assign-job" type="button" data-assign-driver="${escapeHtml(driver.id)}">Assign job</button></div>` : working ? `<div class="job-row-actions">${driver.jobStatus === 'cancel_requested' ? `<button type="button" class="activity-pill on-job job-cancelled" data-cancel-driver="${escapeHtml(driver.id)}" aria-label="Confirm cancellation for Taxi ${escapeHtml(driver.taxiNumber)}">Cancelled</button>` : `<span class="activity-pill ${activity.className}">${escapeHtml(activity.label)}</span><button class="cancel-driver-job" type="button" data-cancel-driver="${escapeHtml(driver.id)}">Cancel job</button>`}</div>` : `<div class="area-row-actions"><span class="activity-pill ${activity.className}">${escapeHtml(activity.label)}</span></div>`}</article>`; }).join('') : `<p class="empty">${query ? `No event taxi matches “${escapeHtml(query)}”.` : 'No taxis are currently in this category.'}</p>`;
}
async function sync() { try { const response = await fetch('/api/state'); if (!response.ok) throw new Error(); const state = await response.json(); drivers = state.drivers || []; jobs = state.jobs || []; departures = state.departures || []; $('.signal').classList.add('online'); $('#connection-text').textContent = 'Server live'; } catch { $('.signal').classList.remove('online'); $('#connection-text').textContent = location.protocol === 'file:' ? 'Preview mode' : 'Offline'; } render(); }
$('#operations-date').textContent = `${new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long'}).format(new Date())} · Oldest waiting taxi is always first`;
$('#fleet-search').addEventListener('input',render);
document.querySelectorAll('[data-fleet-filter]').forEach(button => button.addEventListener('click',() => { activeFilter = button.dataset.fleetFilter; $('#fleet-search').value = ''; document.querySelectorAll('[data-fleet-filter]').forEach(item => item.classList.toggle('active',item === button)); render(); }));
sync();
const toast = message => { $('#ops-toast').textContent = message; $('#ops-toast').classList.add('visible'); setTimeout(() => $('#ops-toast').classList.remove('visible'),2600); };
const areaDialog = $('#area-dialog');
const areaForm = $('#area-form');
const openTaxiForm = (area = '', driver = null) => {
  areaForm.reset();
  $('#area-form-error').textContent = '';
  areaForm.elements.driverId.value = driver?.id || '';
  areaForm.elements.driverName.value = driver?.name || '';
  areaForm.elements.taxiNumber.value = driver?.taxiNumber || '';
  areaForm.elements.allocatedArea.value = area || driver?.allocatedArea || '';
  areaForm.elements.taxiNumber.readOnly = Boolean(driver);
  $('#area-dialog-title').textContent = driver ? `Edit Taxi ${driver.taxiNumber}` : area ? `Add driver to ${area}` : 'Add driver';
  areaDialog.showModal();
  setTimeout(() => areaForm.elements.driverName.focus(), 0);
};
const driverActionsDialog = $('#driver-actions-dialog');
const driverActionsForm = $('#driver-actions-form');
let activeDriverForActions = null;
const currentFleet = () => mockMode ? previewFleet : drivers;
const destinationFor = driver => driver.allocatedArea ? `area:${driver.allocatedArea}` : driver.status === 'break' ? 'break' : driver.status === 'offline' ? 'offline' : 'ready';
const openDriverActions = driver => {
  activeDriverForActions = driver;
  const activity = driverActivity(driver), working = isWorking(driver);
  driverActionsForm.reset();
  driverActionsForm.elements.driverId.value = driver.id;
  driverActionsForm.elements.destination.value = destinationFor(driver);
  $('#driver-actions-taxi').textContent = driver.taxiNumber;
  $('#driver-actions-name').textContent = driver.name || 'Driver not named';
  $('#driver-actions-status').textContent = activity.label;
  $('#driver-actions-location').textContent = driver.allocatedArea || (working ? `${driver.pickup || 'Pickup'} → ${driver.destination || 'Destination'}` : 'Drive Office');
  $('#driver-actions-note').textContent = working ? 'This driver has an active job. Complete or cancel it before moving, editing, or removing the driver.' : 'Choose a new status or area, then apply the change.';
  $('#driver-actions-error').textContent = '';
  driverActionsForm.elements.destination.disabled = working;
  $('#apply-driver-action').disabled = working;
  $('#driver-action-edit').disabled = working;
  $('#driver-action-remove').disabled = working;
  $('#driver-action-assign').hidden = !isEligible(driver);
  driverActionsDialog.showModal();
};
const closeDriverActions = () => { if (driverActionsDialog.open) driverActionsDialog.close(); activeDriverForActions = null; };
$('#close-driver-actions').addEventListener('click',closeDriverActions);
$('#cancel-driver-actions').addEventListener('click',closeDriverActions);
driverActionsForm.addEventListener('submit',async event => {
  event.preventDefault();
  const driver = activeDriverForActions;
  if (!driver || isWorking(driver)) return;
  const destination = driverActionsForm.elements.destination.value;
  const allocatedArea = destination.startsWith('area:') ? destination.slice(5) : destination === 'ready' ? '' : driver.allocatedArea || '';
  const status = destination === 'break' ? 'break' : destination === 'offline' ? 'offline' : 'available';
  const instruction = allocatedArea ? `Allocated to ${allocatedArea}` : status === 'available' ? 'Ready for work at Drive Office' : status === 'break' ? 'On break' : 'Off shift';
  const submit = $('#apply-driver-action'); submit.disabled = true; $('#driver-actions-error').textContent = '';
  try {
    if (mockMode) Object.assign(driver,{status,allocatedArea,instruction,availableSince:status === 'available' ? driver.availableSince || new Date().toISOString() : null});
    else {
      const response = await fetch(`/api/drivers/${encodeURIComponent(driver.id)}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({name:driver.name,taxiNumber:driver.taxiNumber,status,allocatedArea,instruction})});
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Could not update this driver.');
      await sync();
    }
    const label = allocatedArea || (status === 'available' ? 'Ready for work' : status === 'break' ? 'On break' : 'Off shift');
    closeDriverActions(); render(); toast(`Taxi ${driver.taxiNumber} moved to ${label}`);
  } catch (reason) { $('#driver-actions-error').textContent = reason.message || 'Could not update this driver.'; submit.disabled = false; }
});
$('#driver-action-edit').addEventListener('click',() => { const driver = activeDriverForActions; if (!driver) return; closeDriverActions(); openTaxiForm(driver.allocatedArea || '',driver); });
$('#driver-action-export').addEventListener('click',() => {
  const driver = activeDriverForActions; if (!driver) return;
  const exportData = {exportedAt:new Date().toISOString(),driver,jobs:jobs.filter(job => job.driverId === driver.id)};
  const url = URL.createObjectURL(new Blob([JSON.stringify(exportData,null,2)],{type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = `motion-weave-taxi-${driver.taxiNumber}-driver-data.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  toast(`Taxi ${driver.taxiNumber} data exported`);
});
$('#driver-action-remove').addEventListener('click',async () => {
  const driver = activeDriverForActions;
  if (!driver || isWorking(driver) || !confirm(`Remove Taxi ${driver.taxiNumber} (${driver.name}) from the dashboard?\n\nPast job records will be kept. This driver's phone alerts will be disconnected.`)) return;
  const button = $('#driver-action-remove'); button.disabled = true; $('#driver-actions-error').textContent = '';
  try {
    if (mockMode) { const index = previewFleet.findIndex(item => item.id === driver.id); if (index >= 0) previewFleet.splice(index,1); }
    else { const response = await fetch(`/api/admin/drivers/${encodeURIComponent(driver.id)}`,{method:'DELETE',headers:{origin:location.origin}}), payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Could not remove this driver.'); await sync(); }
    closeDriverActions(); render(); toast(`Taxi ${driver.taxiNumber} removed from the dashboard`);
  } catch (reason) { $('#driver-actions-error').textContent = reason.message || 'Could not remove this driver.'; button.disabled = false; }
});
const closeAreaDialog = () => areaDialog.close();
$('#close-area-dialog').addEventListener('click', closeAreaDialog);
$('#cancel-area').addEventListener('click', closeAreaDialog);
const inviteDriverDialog = $('#invite-driver-dialog');
const inviteDriverForm = $('#invite-driver-form');
const inviteMessageReady = $('#invite-message-ready');
const inviteActions = $('#invite-driver-dialog .job-modal-actions');
const phoneInput = inviteDriverForm.elements.phoneNumber;
const phoneKeypad = $('#phone-keypad');
let preparedInviteUrl = '';
const resetInviteDriver = () => { inviteDriverForm.reset(); $('#invite-driver-error').textContent = ''; inviteMessageReady.hidden = true; inviteActions.hidden = false; phoneKeypad.hidden = true; preparedInviteUrl = ''; for (const name of ['driverName','taxiNumber','phoneNumber']) inviteDriverForm.elements[name].disabled = false; };
const closeInviteDriver = () => { inviteDriverDialog.close(); resetInviteDriver(); };
$('#invite-driver-button').addEventListener('click',() => { resetInviteDriver(); inviteDriverDialog.showModal(); setTimeout(() => inviteDriverForm.elements.driverName.focus(),0); });
$('#close-invite-driver').addEventListener('click',closeInviteDriver);
$('#cancel-invite-driver').addEventListener('click',closeInviteDriver);
phoneInput.addEventListener('focus',()=>{if(!phoneInput.disabled)phoneKeypad.hidden=false;});
phoneInput.addEventListener('click',()=>{if(!phoneInput.disabled)phoneKeypad.hidden=false;});
phoneKeypad.addEventListener('click',event=>{
  const key=event.target.closest('[data-phone-key]')?.dataset.phoneKey;if(!key)return;
  if(key==='done'){phoneKeypad.hidden=true;phoneInput.blur();return;}
  if(key==='clear')phoneInput.value='';
  else if(key==='backspace')phoneInput.value=phoneInput.value.slice(0,-1);
  else if(key==='+'&&phoneInput.value) return;
  else if(phoneInput.value.length<22)phoneInput.value+=key;
  phoneInput.dispatchEvent(new Event('input',{bubbles:true}));phoneInput.focus();
});
$('#copy-invite-link').addEventListener('click',async () => { if (!preparedInviteUrl) return; try { await navigator.clipboard.writeText(preparedInviteUrl); toast('Invite link copied'); } catch { toast('Could not copy automatically — use Open text message'); } });
inviteDriverForm.addEventListener('submit',async event => {
  event.preventDefault();
  const name = inviteDriverForm.elements.driverName.value.trim(), taxiNumber = inviteDriverForm.elements.taxiNumber.value.replace(/\D/g,'').padStart(2,'0'), phoneNumber = inviteDriverForm.elements.phoneNumber.value.trim(), error = $('#invite-driver-error'), submit = inviteDriverForm.querySelector('[type="submit"]');
  error.textContent = '';
  if (!name || !/^\d{2}$/.test(taxiNumber) || !/^\+?[\d\s()-]{7,22}$/.test(phoneNumber)) { error.textContent = 'Enter the driver’s name, taxi number, and a valid mobile number.'; return; }
  submit.disabled = true;
  try {
    if (mockMode) { previewFleet.push({id:crypto.randomUUID(),name,taxiNumber,status:'offline',jobStatus:'',allocatedArea:'',availableSince:null}); closeInviteDriver(); render(); return toast(`Taxi ${taxiNumber} added offline · invitation ready`); }
    const response = await fetch('/api/admin/driver-invites',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,taxiNumber,phoneNumber})}), payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Could not create this invitation.');
    await sync();
    const message = `You have been invited to the Motion Weave Driver App as Taxi ${taxiNumber}. Your details are already filled in. Open this private link in Safari or Chrome, then follow Add to Home Screen. The same link can be reopened for seven days: ${payload.inviteUrl}`;
    const separator = /iPad|iPhone|iPod/.test(navigator.userAgent) ? '&body=' : '?body=';
    const recipient = String(payload.phoneNumber).replace(/(?!^)\+|[^\d+]/g,'');
    const smsUrl = `sms:${recipient}${separator}${encodeURIComponent(message)}`;
    preparedInviteUrl = payload.inviteUrl;
    const openMessage = $('#open-invite-message'); openMessage.href = smsUrl;
    inviteMessageReady.hidden = false; inviteActions.hidden = true; phoneKeypad.hidden = true;
    for (const field of [inviteDriverForm.elements.driverName,inviteDriverForm.elements.taxiNumber,inviteDriverForm.elements.phoneNumber]) field.disabled = true;
    openMessage.click();
    toast(`Taxi ${taxiNumber} ${payload.reinvited ? 're-invited' : 'added offline'} · message ready to send`);
  } catch (reason) { error.textContent = reason.message || 'Could not create this invitation.'; }
  finally { submit.disabled = false; }
});
$('#taxi-queue').addEventListener('click', event => {
  const actionId = event.target.closest('[data-driver-actions]')?.dataset.driverActions;
  if (actionId) { const driver = currentFleet().find(item => item.id === actionId); if (driver) openDriverActions(driver); return; }
  const addAreaButton = event.target.closest('[data-add-area-driver]');
  if (addAreaButton) { openTaxiForm(addAreaButton.dataset.addAreaDriver); return; }
  const areaButton = event.target.closest('[data-toggle-area]');
  if (areaButton) { selectedArea = selectedArea === areaButton.dataset.toggleArea ? '' : areaButton.dataset.toggleArea; render(); return; }
  const id = event.target.closest('[data-allocate-driver]')?.dataset.allocateDriver;
  if (!id) return;
  const driver = (mockMode ? previewFleet : drivers).find(item => item.id === id);
  if (driver) openTaxiForm(driver.allocatedArea || '', driver);
});
areaForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = areaForm.elements.driverName.value.trim();
  const taxiNumber = areaForm.elements.taxiNumber.value.replace(/\D/g, '').padStart(2, '0');
  const allocatedArea = areaForm.elements.allocatedArea.value;
  const existing = (mockMode ? previewFleet : drivers).find(driver => driver.taxiNumber === taxiNumber);
  const id = areaForm.elements.driverId.value || existing?.id || crypto.randomUUID();
  const error = $('#area-form-error');
  error.textContent = '';
  if (!name || !/^\d{2}$/.test(taxiNumber)) { error.textContent = 'Enter the driver’s full name and a taxi number from 00 to 99.'; return; }
  const duplicate = (mockMode ? previewFleet : drivers).find(driver => driver.taxiNumber === taxiNumber && driver.id !== id);
  if (duplicate) { error.textContent = `Taxi ${taxiNumber} is already assigned to ${duplicate.name}.`; return; }
  const submit = areaForm.querySelector('[type="submit"]'); submit.disabled = true;
  try {
    if (mockMode) {
      if (existing) Object.assign(existing,{name,status:'available',allocatedArea,availableSince:existing.availableSince || new Date().toISOString()});
      else previewFleet.push({id,name,taxiNumber,status:'available',jobStatus:'',allocatedArea,availableSince:new Date().toISOString()});
    } else {
      const response = await fetch(`/api/drivers/${encodeURIComponent(id)}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({name,taxiNumber,status:'available',allocatedArea,instruction:allocatedArea ? `Allocated to ${allocatedArea}` : 'Ready for work at Drive Office'})});
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save this taxi.');
      await sync();
    }
    closeAreaDialog(); render(); toast(allocatedArea ? `Taxi ${taxiNumber} added to ${allocatedArea}` : `Taxi ${taxiNumber} added to Ready for work`);
  } catch (reason) { error.textContent = reason.message || 'Could not save this taxi.'; }
  finally { submit.disabled = false; }
});
async function showPasswordControl(){const button=$('#event-password-button');button.hidden=false;try{const response=await fetch('/api/event/driver-password');if(response.ok&&((await response.json()).configured))button.textContent='Change driver event password';}catch{}}
window.addEventListener('rankflow-auth',event=>{if(event.detail.role==='admin')showPasswordControl();});
if(window.rankflowUser?.role==='admin')$('#event-password-button').hidden=false;
const closePasswordDialog=()=>{$('#event-password-dialog').close();$('#event-password-form').reset();$('#event-password-error').textContent='';};
$('#event-password-button').addEventListener('click',()=>$('#event-password-dialog').showModal());
$('#close-event-password-dialog').addEventListener('click',closePasswordDialog);
$('#cancel-event-password').addEventListener('click',closePasswordDialog);
$('#event-password-form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget),password=String(form.get('password')),confirmPassword=String(form.get('confirmPassword')),error=$('#event-password-error');error.textContent='';if(password!==confirmPassword){error.textContent='The passwords do not match.';return;}const button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;try{const response=await fetch('/api/event/driver-password',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({password,confirmPassword})}),payload=await response.json();if(!response.ok)throw new Error(payload.error||'Could not save the password');closePasswordDialog();$('#event-password-button').textContent='Change driver event password';toast('Driver event password saved');}catch(reason){error.textContent=reason.message;}finally{button.disabled=false;}});
const closeJobDialog = () => $('#job-dialog').close();
const populatePickupTimes = () => { const select = $('#job-pickup-time'); for (let minutes=0; minutes<24*60; minutes+=5) { const hours=String(Math.floor(minutes/60)).padStart(2,'0'), mins=String(minutes%60).padStart(2,'0'), value=`${hours}:${mins}`, option=document.createElement('option'); option.value=value; option.textContent=value; select.append(option); } };
populatePickupTimes();
const openJobForm = driver => { $('#job-form').reset(); $('#job-driver-id').value = driver.id; $('#job-taxi-number').textContent = driver.taxiNumber; $('#job-driver-name').textContent = driver.name || 'Driver not named'; $('#job-alert-status').textContent = driver.hasJobAlerts ? '✓ Phone is registered for job alerts' : '⚠ Phone is not registered for alerts — the job will appear in the app, but no notification can be sent'; $('#job-alert-status').className = driver.hasJobAlerts ? 'alerts-ready' : 'alerts-missing'; $('#job-dialog').showModal(); };
$('#close-job-dialog').addEventListener('click',closeJobDialog); $('#cancel-job').addEventListener('click',closeJobDialog);
$('#driver-action-assign').addEventListener('click',() => { const driver = activeDriverForActions; if (!driver || !isEligible(driver)) return; closeDriverActions(); openJobForm(driver); });
$('#taxi-queue').addEventListener('click',event => { const id = event.target.closest('[data-assign-driver]')?.dataset.assignDriver; if (!id) return; const driver = currentFleet().find(item => item.id === id); if (driver) openJobForm(driver); });
$('#taxi-queue').addEventListener('click',async event => { const id = event.target.closest('[data-cancel-driver]')?.dataset.cancelDriver; if (!id) return; const fleet = mockMode ? previewFleet : drivers, driver = fleet.find(item => item.id === id); if (!driver?.jobId || !confirm(`Cancel the current job for Taxi ${driver.taxiNumber}?\n\nThis cannot be undone and will be recorded in the audit history.`)) return; try { const response = await fetch(`/api/jobs/${encodeURIComponent(driver.jobId)}/transition`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'cancel',confirmation:'CANCEL',reason:'Cancelled from Operations queue',expectedJobVersion:driver.jobVersion,requestId:crypto.randomUUID()})}); const result=await response.json(); if(!response.ok)throw new Error(result.error); await sync(); toast(`Job cancelled · Taxi ${driver.taxiNumber} returned to the queue`); } catch(error) { toast(error.message || 'Could not cancel the job. Refresh and try again.'); } });
$('#job-form').addEventListener('submit',async event => { event.preventDefault(); const form = new FormData(event.currentTarget), id = String(form.get('driverId')), fleet = mockMode ? previewFleet : drivers, driver = fleet.find(item => item.id === id); if (!driver) return; const pickup = String(form.get('pickup')), pickupTime = String(form.get('pickupTime')), selectedDestination = String(form.get('destination')), otherDestination = String(form.get('otherDestination')).trim(), destination = otherDestination || (selectedDestination === 'Other' ? '' : selectedDestination), contactName = String(form.get('contactName')), jobMessage = String(form.get('jobMessage')).trim(), passengerCount = Number(form.get('passengerCount')); if (!destination) return toast('Choose a destination or enter Other drop-off.'); if (mockMode) { Object.assign(driver,{pickup,pickupTime,destination,contactName,passengerCount,jobMessage,jobStatus:'assigned',status:'busy',jobId:crypto.randomUUID()}); closeJobDialog(); render(); return toast(`Job sent to Taxi ${driver.taxiNumber}${jobMessage ? ' with message' : ''}`); } try { const response = await fetch('/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({driverId:id,pickup,pickupTime,destination,contactName,passengerCount,jobMessage,expectedDriverVersion:driver.driverVersion,requestId:crypto.randomUUID()})}); const result=await response.json(); if(!response.ok)throw new Error(result.error); closeJobDialog(); await sync(); toast(`Job sent to Taxi ${driver.taxiNumber}${jobMessage ? ' with message' : ''} · ${result.notification?.sent ? 'PHONE ALERT SENT' : result.notification?.status === 'failed' ? 'PHONE ALERT FAILED — contact driver' : 'NO PHONE ALERT — register the driver phone'}`); } catch { await sync(); toast('Taxi is no longer available. Choose the next taxi.'); } });
$('#job-form').addEventListener('submit',event => {
  if (location.protocol !== 'file:') return;
  const form = new FormData(event.currentTarget), id = String(form.get('driverId')), driver = previewFleet.find(item => item.id === id), pickup = String(form.get('pickup')), pickupTime = String(form.get('pickupTime')), selectedDestination = String(form.get('destination')), otherDestination = String(form.get('otherDestination')).trim(), destination = otherDestination || (selectedDestination === 'Other' ? '' : selectedDestination);
  if (!driver || !pickup || !destination) return;
  const assignedAt = new Date().toISOString(), cached = JSON.parse(localStorage.getItem('rankflow-state-v2') || '{}'), officeEvent = { id:crypto.randomUUID(), type:'driver_updated', source:'desktop_dashboard', assignmentSource:'desktop_dashboard', timestamp:assignedAt, assignedAt, driverId:id, taxiNumber:driver.taxiNumber, driverName:driver.name, status:'available', jobStatus:'assigned', pickup, pickupTime, destination, passengerCount:Number(form.get('passengerCount')) || 1, jobMessage:String(form.get('jobMessage')).trim() };
  cached.activity = [...(cached.activity || []),officeEvent]; cached.drivers = cached.drivers || []; cached.departures = cached.departures || []; localStorage.setItem('rankflow-state-v2',JSON.stringify(cached));
});
try { const events = new EventSource('/api/events'); events.addEventListener('state',sync); } catch {}

setInterval(sync, 3000);
