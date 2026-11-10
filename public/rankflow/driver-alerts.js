(() => {
  const button=document.querySelector('#enable-job-alerts'),testButton=document.querySelector('#test-job-alerts'),note=document.querySelector('#job-alerts-note');
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  const standalone=window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  let registration,config,preparing=false,retryRequested=false;
  const bytes=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const profile=()=>JSON.parse(localStorage.getItem('event-london-taxis-driver-profile')||'null');
  const connectedMessage=()=>`Connected to the dashboard at ${new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit'}).format(new Date())}. Test this phone before the event.`;
  async function save(subscription){const driver=profile();if(!driver?.id)throw Error('Connect this phone to the driver first.');const r=await fetch('/api/push/subscriptions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({driverId:driver.id,subscription:subscription.toJSON()})});const result=await r.json().catch(()=>({}));if(!r.ok)throw Error(r.status===401?'Waiting for the driver connection…':result.error||'Could not register this phone with the dashboard.');return result;}
  function enabled(){button.disabled=false;button.textContent='Job alerts enabled';testButton.hidden=false;note.textContent=connectedMessage();}
  async function prepareOnce(){
    if(ios&&!standalone){button.disabled=true;note.textContent='On iPhone: open this Driver app in Safari, tap Share → Add to Home Screen, then open its icon to turn on alerts.';return;}
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){button.disabled=true;note.textContent='This browser does not support phone alerts. On iPhone, use iOS 16.4 or later and open the Home Screen app.';return;}
    if(!profile()?.id){button.disabled=true;note.textContent='Connect this phone to the driver before turning on job alerts.';return;}
    try{
      registration=await navigator.serviceWorker.register('./service-worker.js',{scope:'/rankflow/'});await registration.update();registration=await navigator.serviceWorker.ready;
      const r=await fetch('/api/push/key');
      if(r.status===401){button.disabled=true;note.textContent='Finishing the driver connection…';return;}
      if(!r.ok)throw Error('Could not contact the dashboard. Reopen the app and try again.');
      config=await r.json();if(!config.enabled)throw Error('Job alerts are not configured yet.');button.disabled=false;
      const existing=await registration.pushManager.getSubscription();
      if(existing&&Notification.permission==='granted'){await save(existing);enabled();}
      else if(Notification.permission==='denied')note.textContent='Notifications are blocked. Allow notifications in phone settings, then reopen this app.';
      else note.textContent='Tap Turn on job alerts. The app will confirm when this phone is registered with the dashboard.';
    }catch(error){note.textContent=error.message;}
  }
  async function prepare(){
    if(preparing){retryRequested=true;return;}
    preparing=true;
    try{do{retryRequested=false;await prepareOnce();}while(retryRequested);}finally{preparing=false;}
  }
  button.addEventListener('click',async()=>{
    if(!profile()?.id){note.textContent='Connect this phone to the driver first.';return;}
    if(!registration||!config){await prepare();if(!registration||!config){note.textContent='The phone is not connected to the dashboard yet. Reopen the app and try again.';return;}}
    const permission=await Notification.requestPermission();if(permission!=='granted'){note.textContent='Allow notifications to receive job alerts.';return;}
    button.disabled=true;note.textContent='Registering this phone with the dashboard…';
    try{const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});await save(subscription);enabled();}catch(error){note.textContent=error.message;}finally{button.disabled=false;}
  });
  testButton.addEventListener('click',async event=>{
    const driver=profile();if(!driver?.id){note.textContent='Connect this phone to the driver first.';return;}
    event.currentTarget.disabled=true;note.textContent='Sending a test alert…';
    try{const r=await fetch('/api/push/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({driverId:driver.id})});const result=await r.json().catch(()=>({}));if(!r.ok||!result.sent)throw Error(result.error||'The push service did not accept the test alert. Reopen the app, register alerts again, and retry.');note.textContent='Test alert accepted. It should appear on this phone now.';}catch(error){note.textContent=error.message;}finally{event.currentTarget.disabled=false;}
  });
  window.addEventListener('rankflow-driver-connected',prepare);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Notification.permission==='granted')prepare();});
  window.addEventListener('online',prepare);
  prepare();
})();
