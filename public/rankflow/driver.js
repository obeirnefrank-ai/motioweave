const $ = selector => document.querySelector(selector);
const PROFILE_KEY = 'event-london-taxis-driver-profile';
let profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
const previewJob = new URLSearchParams(location.search).get('sampleJob') === '1';
let sampleMode = previewJob;
let changingStatus = false;
const samplePickupTime = () => new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date(Date.now()+15*60000));
let mockPickupTime = samplePickupTime();
if (previewJob && !profile) profile = { id:'preview-driver', name:'Frank', taxiNumber:'75' };
if (profile && !profile.id) { profile.id = crypto.randomUUID(); localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }
let status = previewJob ? 'busy' : 'offline';
let activeJob = previewJob;
let jobContact = previewJob ? 'Jeremy' : null;
let jobStatus = previewJob ? 'assigned' : '';
let serverDriver = null;
const pageParams = new URLSearchParams(location.search);
const inviteToken = pageParams.get('invite');
const installToken = pageParams.get('install');
const installedApp = globalThis.matchMedia?.('(display-mode: standalone)')?.matches || globalThis.navigator?.standalone === true;
let installPrompt;
window.addEventListener('beforeinstallprompt',event => { event.preventDefault(); installPrompt = event; if (!installedApp) $('#install-app-button').hidden = false; });
window.addEventListener('rankflow-auth',event=>{const user=event.detail;if(user.role==='driver'){profile={id:user.driverId,name:user.displayName,taxiNumber:user.taxiNumber};localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));sync();}});

async function request(path, options) { const response = await fetch(path, { ...options, headers:{ 'content-type':'application/json' } }); const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || 'Request failed'); return result; }
async function saveDriver(patch = {}) { if (!profile) return; serverDriver = { ...serverDriver, ...profile, status, ...patch }; if (!serverDriver.instruction) serverDriver.instruction = 'Waiting for your next job'; await request(`/api/drivers/${encodeURIComponent(profile.id)}`, { method:'PUT', body:JSON.stringify(serverDriver) }); }
async function sync() { if (sampleMode || changingStatus) return; try { const state = await request('/api/state'); serverDriver = state.drivers.find(driver => driver.id === profile?.id) || null; if (serverDriver) { status = serverDriver.status; jobStatus = serverDriver.jobStatus; activeJob = ['assigned','accepted','collected','cancel_requested'].includes(jobStatus) && Boolean(serverDriver.jobId); jobContact = serverDriver.contactName || null; } else { status = 'offline'; activeJob = false; jobStatus = ''; jobContact = null; } render(); } catch (error) { $('#status-text').textContent = 'Not connected'; } }
const toast = message => { $('#driver-toast').textContent = message; $('#driver-toast').classList.add('visible'); setTimeout(() => $('#driver-toast').classList.remove('visible'), 2800); };

function render() {
  const statusText = status === 'busy' ? 'On a job' : status === 'available' ? 'Available' : status === 'break' ? 'On break' : 'Off shift';
  $('#status-text').textContent = statusText;
  $('#status-icon').className = `status-icon ${status}`;
  $('#job-waiting').hidden = activeJob;
  $('#job-details').hidden = !activeJob;
  $('#contact-name').textContent = jobContact || 'N/A';
  const pickupTime = sampleMode ? mockPickupTime : serverDriver?.pickupTime;
  $('#pickup-time-card').hidden = !activeJob || !pickupTime; $('#pickup-time').textContent = activeJob ? pickupTime || '' : ''; 
  $('#pickup-point').textContent = activeJob ? (sampleMode ? 'Paddock Club' : serverDriver?.pickup || '') : '';
  $('#destination-point').textContent = activeJob ? (sampleMode ? 'Helipad' : serverDriver?.destination || '') : '';
  $('#passenger-count').value = String(activeJob && !sampleMode ? serverDriver?.passengerCount || 1 : 1);
  const jobMessage = activeJob && !sampleMode ? serverDriver?.jobMessage || '' : '';
  $('#job-message-button').hidden = !jobMessage;
  $('#job-message-text').textContent = jobMessage;
  if (!activeJob) { $('#contact-name').textContent = ''; $('#job-progress').textContent = ''; }
  $('#job-waiting').textContent = status === 'break' ? 'On break — return to the queue when ready.' : 'No job assigned yet.';
  const action = { assigned:['Accept job','acknowledge','Accept this job before travelling to the pickup.'], accepted:['Passenger picked up','pickup','Job accepted. Tap when the passenger is in the taxi.'], collected:['Complete drop-off','dropoff','Tap after the passenger has been dropped off.'] }[jobStatus];
  if (action) { $('#dropoff-button').innerHTML = `${action[0]} <span>→</span>`; $('#dropoff-button').dataset.action = action[1]; $('#job-progress').textContent = action[2]; }
  if (jobStatus === 'cancel_requested') $('#job-progress').textContent = 'Cancelled — awaiting Drive Office confirmation. You will return to the queue once confirmed.';
  $('#dropoff-button').hidden = !activeJob || jobStatus === 'cancel_requested';
  $('#job-cancelled-button').hidden = !activeJob || !['assigned','accepted'].includes(jobStatus);
  $('#dropoff-button').classList.toggle('dropoff-action', jobStatus === 'collected');
  $('#dropoff-button').classList.toggle('accepted-action', jobStatus === 'accepted');
  $('#availability-button').hidden = activeJob || status === 'busy' || Boolean(inviteToken && !installedApp);
  $('#availability-button').disabled = activeJob || changingStatus;
  $('#profile-button').hidden = Boolean(inviteToken && !installedApp);
  $('#profile-button').disabled = activeJob;
  $('#availability-button').textContent = status === 'offline' ? (profile ? 'Check in and go available' : 'Add driver details') : status === 'break' ? 'Return to queue' : 'Take a break';
  $('#sample-job-button').hidden = status !== 'available' || activeJob;
  $('#profile-button').textContent = profile ? `${profile.name} · Taxi ${profile.taxiNumber}` : 'Driver details';
}
function openDetails() { $('#driver-name').value = profile?.name || ''; $('#taxi-number').value = profile?.taxiNumber || ''; $('#driver-name').readOnly = false; $('#taxi-number').readOnly = false; $('#details-title').textContent = 'Set up this phone'; $('#invite-details-note').hidden = true; $('#save-driver-details').textContent = 'Save details'; $('#cancel-button').hidden = false; $('#details-dialog').showModal(); }
async function loadInvite() {
  if (!inviteToken) return;
  try {
    if (installedApp) return connectInvite(false);
    const invitation = await request(`/api/driver-invites/${encodeURIComponent(inviteToken)}`);
    $('#invite-driver-name').textContent = invitation.name;
    $('#invite-taxi-number').textContent = invitation.taxiNumber;
    $('#invite-card').hidden = false;
  }
  catch (error) { $('#invite-card').hidden = false; $('#connect-invite-button').hidden = true; $('#invite-error').textContent = error.message || 'This invitation is invalid or has expired.'; }
}
async function connectInvite(createInstallInvite) {
  const button = $('#connect-invite-button');
  button.disabled = true; $('#invite-error').textContent = '';
  try {
    const accepted = await request(`/api/driver-invites/${encodeURIComponent(inviteToken)}`,{method:'POST',body:JSON.stringify({createInstallInvite})});
    profile = accepted.driver; status = accepted.status || 'offline';
    localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));
    window.dispatchEvent(new CustomEvent('rankflow-driver-connected'));
    if (accepted.installInviteToken) {
      const installUrl = new URL(location.href); installUrl.searchParams.delete('invite'); installUrl.searchParams.set('install',accepted.installInviteToken); location.replace(installUrl);
      return;
    }
    history.replaceState({},'',location.pathname); $('#invite-card').hidden = true; await sync(); toast('Phone connected to the dashboard');
  }
  catch (error) { $('#invite-error').textContent = error.message || 'This invitation is invalid or has expired.'; button.disabled = false; }
}
$('#connect-invite-button').addEventListener('click',() => connectInvite(true));
$('#install-app-button').addEventListener('click',async () => { if (!installPrompt) return; await installPrompt.prompt(); installPrompt = null; $('#install-app-button').hidden = true; });
$('#profile-button').addEventListener('click', openDetails);
$('#availability-button').addEventListener('click', async () => {
  if (activeJob || changingStatus) return;
  if (!profile) return openDetails();
  const previous = status;
  status = status === 'offline' || status === 'break' ? 'available' : 'break';
  changingStatus = true; render();
  try {
    if (!sampleMode) await saveDriver();
    activeJob = false; jobStatus = ''; jobContact = null; serverDriver = null;
  } catch (error) { status = previous; toast(error.message || 'Could not change status. Please try again.'); }
  finally { changingStatus = false; if (!sampleMode) await sync(); render(); }
});
$('#sample-job-button').addEventListener('click', () => {
  if (activeJob) return;
  sampleMode = true; activeJob = true; status = 'busy'; jobStatus = 'assigned'; jobContact = 'Jeremy'; mockPickupTime = samplePickupTime(); render();
});
$('#dropoff-button').addEventListener('click', async () => {
  if (sampleMode) { jobStatus = jobStatus === 'assigned' ? 'accepted' : jobStatus === 'accepted' ? 'collected' : 'completed'; activeJob = jobStatus !== 'completed'; if (!activeJob) { status = 'available'; jobContact = null; } return render(); }
  const action = $('#dropoff-button').dataset.action;
  if (!serverDriver?.jobId || !action) return;
  $('#dropoff-button').disabled = true;
  try { await request(`/api/jobs/${encodeURIComponent(serverDriver.jobId)}/transition`, { method:'POST', body:JSON.stringify({ action, expectedJobVersion:serverDriver.jobVersion, requestId:crypto.randomUUID() }) }); await sync(); toast(action === 'dropoff' ? 'Drop-off complete — you are back at the end of the queue' : action === 'pickup' ? 'Pickup saved' : 'Job acknowledged'); }
  catch (error) { await sync(); toast(error.message); }
  finally { $('#dropoff-button').disabled = false; }
});
$('#job-cancelled-button').addEventListener('click', async () => {
  if (!activeJob) return;
  if (sampleMode) { activeJob=true; jobStatus='cancel_requested'; status='busy'; return render(); }
  if (!serverDriver?.jobId || !['assigned','accepted'].includes(jobStatus)) return;
  $('#job-cancelled-button').disabled=true;
  try { await request(`/api/jobs/${encodeURIComponent(serverDriver.jobId)}/transition`,{method:'POST',body:JSON.stringify({action:'request_cancel',expectedJobVersion:serverDriver.jobVersion,requestId:crypto.randomUUID()})}); await sync(); toast('Cancelled — waiting for Drive Office confirmation'); }
  catch(error) { await sync(); toast(error.message); }
  finally { $('#job-cancelled-button').disabled=false; }
});
$('#cancel-button').addEventListener('click', () => $('#details-dialog').close());
$('#job-message-button').addEventListener('click',() => $('#job-message-dialog').showModal());
$('#close-job-message').addEventListener('click',() => $('#job-message-dialog').close());
$('#details-form').addEventListener('submit', async event => {
  event.preventDefault(); if (activeJob || changingStatus) return;
  const form = new FormData(event.currentTarget), taxiNumber = String(form.get('taxiNumber')).replace(/\D/g,'');
  if (taxiNumber.length !== 2) return;
  const previousProfile = profile, previousStatus = status;
  changingStatus = true;
  const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true;
  try {
    const isNew = !profile;
    profile = { id:profile?.id || crypto.randomUUID(), name:String(form.get('name')).trim(), taxiNumber };
    if (isNew) status = 'offline';
    if (!sampleMode) await saveDriver(); localStorage.setItem(PROFILE_KEY,JSON.stringify(profile)); $('#details-dialog').close(); toast(isNew ? 'Driver added — currently Off shift' : 'Driver details saved');
  }
  catch(error) { profile=previousProfile; status=previousStatus; toast(error.message || 'Could not register this phone. Please try again.'); }
  finally { changingStatus=false; submit.disabled=false; if (!sampleMode) await sync(); render(); }
});
render(); if (inviteToken) loadInvite(); else { if (installToken && !installedApp) $('#install-card').hidden = false; sync(); }
try { const events = new EventSource('/api/events'); events.addEventListener('state', sync); } catch {}

setInterval(sync, 3000);
