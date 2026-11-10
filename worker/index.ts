import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env { ASSETS: Fetcher; DB: D1Database; IMAGES: { input(stream: ReadableStream): { transform(options: Record<string, unknown>): { output(options: { format: string; quality: number }): Promise<{ response(): Response }> } } }; ADMIN_EMAIL?: string; EVENT_ACCESS_CODE: string; VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_JWK: string; }
const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers:{ "content-type":"application/json; charset=utf-8", "cache-control":"no-store", ...headers } });
const cookie = (request: Request, name: string) => request.headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || "";
const clean = (value: unknown) => String(value ?? "").trim();
const token = () => [...crypto.getRandomValues(new Uint8Array(24))].map(value => value.toString(16).padStart(2, "0")).join("");
const tokenHash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2,'0')).join('');
let schemaReady: Promise<void> | null = null;

async function ensureSchema(db: D1Database) {
  if (!schemaReady) schemaReady = (async () => { await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS admin_audit (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, driver_id TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, recorded_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS departures (id TEXT PRIMARY KEY, date TEXT NOT NULL, timestamp TEXT NOT NULL, rank TEXT NOT NULL, destination TEXT NOT NULL, passengers INTEGER NOT NULL, taxi_number TEXT NOT NULL, marshal_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', cancelled_at TEXT, collected_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS drivers (id TEXT PRIMARY KEY, name TEXT NOT NULL, taxi_number TEXT NOT NULL, status TEXT NOT NULL, instruction TEXT NOT NULL, contact_name TEXT NOT NULL, destination TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, driver_id TEXT NOT NULL, taxi_number TEXT NOT NULL, pickup TEXT NOT NULL, pickup_time TEXT, destination TEXT NOT NULL, contact_name TEXT, passenger_count INTEGER NOT NULL, job_message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, assigned_at TEXT NOT NULL, accepted_at TEXT, collected_at TEXT, completed_at TEXT, cancelled_at TEXT)"),
    db.prepare("CREATE TABLE IF NOT EXISTS job_history (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, status TEXT NOT NULL, recorded_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS command_requests (request_id TEXT PRIMARY KEY, response TEXT NOT NULL, created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_departures_date ON departures(date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_drivers_status ON drivers(status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_active_driver ON jobs(driver_id) WHERE status IN ('assigned','accepted','collected')")
  ]); const columns = await db.prepare("PRAGMA table_info(departures)").all<{ name:string }>(); const names = new Set(columns.results.map(column => column.name));
    if (!names.has("status")) await db.prepare("ALTER TABLE departures ADD COLUMN status TEXT NOT NULL DEFAULT 'active'").run();
    if (!names.has("cancelled_at")) await db.prepare("ALTER TABLE departures ADD COLUMN cancelled_at TEXT").run();
    if (!names.has("collected_at")) await db.prepare("ALTER TABLE departures ADD COLUMN collected_at TEXT").run();
    const driverColumns = await db.prepare("PRAGMA table_info(drivers)").all<{ name:string }>(); const driverNames = new Set(driverColumns.results.map(column => column.name));
    if (!driverNames.has("available_since")) await db.prepare("ALTER TABLE drivers ADD COLUMN available_since TEXT").run();
    if (!driverNames.has("current_job_id")) await db.prepare("ALTER TABLE drivers ADD COLUMN current_job_id TEXT").run();
    if (!driverNames.has("job_status")) await db.prepare("ALTER TABLE drivers ADD COLUMN job_status TEXT NOT NULL DEFAULT ''").run();
    if (!driverNames.has("version")) await db.prepare("ALTER TABLE drivers ADD COLUMN version INTEGER NOT NULL DEFAULT 1").run();
    if (!driverNames.has("allocated_area")) await db.prepare("ALTER TABLE drivers ADD COLUMN allocated_area TEXT NOT NULL DEFAULT ''").run();
    const jobColumns = await db.prepare("PRAGMA table_info(jobs)").all<{ name:string }>(); const jobNames = new Set(jobColumns.results.map(column => column.name));
    if (!jobNames.has("job_message")) await db.prepare("ALTER TABLE jobs ADD COLUMN job_message TEXT NOT NULL DEFAULT ''").run();
  })();
  await schemaReady;
}
// Sites dispatch verifies sign-in and supplies these identity headers.
// The allowlist is checked on every request; an event code never grants admin access.
function administrator(request: Request, env: Env) {
  const email = clean(request.headers.get('oai-authenticated-user-email')).toLowerCase();
  const id = clean(request.headers.get('oai-authenticated-user-id'));
  const allowed = clean(env.ADMIN_EMAIL || 'obeirnefrank@gmail.com').toLowerCase();
  return id && email && email === allowed ? {id, email, role:'admin'} : null;
}
async function adminApi(request: Request, env: Env, url: URL) {
  const user = administrator(request, env);
  if (!user) return json({error:'Sign in with the administrator account to continue.'}, 403);
  if (url.pathname === '/api/admin/me' && request.method === 'GET') return json({user});
  if (url.pathname === '/api/admin/drivers' && request.method === 'GET') {
    await ensureSchema(env.DB);
    const rows = await env.DB.prepare("SELECT id,name,taxi_number AS taxiNumber,status,version,current_job_id AS jobId FROM drivers WHERE status<>'inactive' ORDER BY taxi_number").all();
    return json({drivers:rows.results});
  }
  if (url.pathname === '/api/admin/driver-invites' && request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({error:'Invalid request origin'},403);
    const input = await request.json().catch(() => ({})) as Record<string,unknown>;
    const name = clean(input.name), taxiNumber = clean(input.taxiNumber), phoneNumber = clean(input.phoneNumber).replace(/[\s()-]/g,'');
    if (!name || name.length > 120 || !/^\d{2}$/.test(taxiNumber) || !/^\+?\d{7,15}$/.test(phoneNumber)) return json({error:'Enter a driver name, two-digit taxi number, and valid mobile number.'},400);
    await ensureSchema(env.DB);
    const existing = await env.DB.prepare("SELECT id,name,status,current_job_id AS currentJobId FROM drivers WHERE taxi_number=? AND status<>'inactive'").bind(taxiNumber).first<Record<string,unknown>>();
    if (existing && (existing.currentJobId || existing.status === 'busy')) return json({error:`Taxi ${taxiNumber} has an active job and cannot be re-invited yet.`},409);
    const rawToken = token(), hash = await tokenHash(rawToken), driverId = String(existing?.id || crypto.randomUUID()), now = new Date(), createdAt = now.toISOString(), expiresAt = new Date(now.getTime()+7*24*60*60*1000).toISOString();
    const invitation = env.DB.prepare('INSERT INTO driver_invites(token_hash,driver_id,phone_number,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(hash,driverId,phoneNumber,user.id,createdAt,expiresAt);
    const audit = env.DB.prepare("INSERT INTO admin_audit(id,actor_id,driver_id,before_json,after_json,recorded_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),user.id,driverId,JSON.stringify(existing || {}),JSON.stringify({name:existing?.name || name,taxiNumber,status:existing?.status || 'offline',invitedByPhone:true,reinvited:Boolean(existing)}),createdAt);
    if (existing) await env.DB.batch([invitation,audit]);
    else await env.DB.batch([
      env.DB.prepare("INSERT INTO drivers(id,name,taxi_number,status,instruction,contact_name,destination,updated_at,available_since) VALUES(?,?,?,'offline','Invited — awaiting phone connection','','',?,NULL)").bind(driverId,name,taxiNumber,createdAt),
      invitation,
      audit
    ]);
    return json({driverId,phoneNumber,inviteUrl:`${url.origin}/rankflow/driver.html?invite=${encodeURIComponent(rawToken)}`,expiresAt,reinvited:Boolean(existing)},201);
  }
  const match = url.pathname.match(/^\/api\/admin\/drivers\/([^/]+)$/);
  if (match && request.method === 'PATCH') {
    if (request.headers.get('origin') !== url.origin) return json({error:'Invalid request origin'},403);
    const input = await request.json().catch(() => ({})) as Record<string,unknown>;
    const name = clean(input.name), taxi = clean(input.taxiNumber), version = Number(input.version);
    if (!name || name.length > 120 || !/^\d{2}$/.test(taxi) || !Number.isInteger(version) || version < 1) return json({error:'Enter a driver name and a two-digit taxi number.'},400);
    await ensureSchema(env.DB);
    const id = decodeURIComponent(match[1]), now = new Date().toISOString();
    // A single conditional update prevents overwriting a concurrent assignment or edit.
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO admin_audit(id,actor_id,driver_id,before_json,after_json,recorded_at) SELECT ?,?,id,json_object('name',name,'taxiNumber',taxi_number),?,? FROM drivers WHERE id=? AND version=? AND current_job_id IS NULL AND NOT EXISTS(SELECT 1 FROM drivers WHERE taxi_number=? AND id<>? AND status<>'inactive')").bind(crypto.randomUUID(),user.id,JSON.stringify({name,taxiNumber:taxi}),now,id,version,taxi,id),
      env.DB.prepare("UPDATE drivers SET name=?,taxi_number=?,version=version+1,updated_at=? WHERE id=? AND version=? AND current_job_id IS NULL AND NOT EXISTS(SELECT 1 FROM drivers WHERE taxi_number=? AND id<>? AND status<>'inactive')").bind(name,taxi,now,id,version,taxi,id)
    ]);
    const result = results[1];
    if (!result.meta.changes) return json({error:'Driver changed, has an active job, or that taxi number is already in use. Refresh and try again.'},409);
    return json({ok:true});
  }
  if (match && request.method === 'DELETE') {
    if (request.headers.get('origin') !== url.origin) return json({error:'Invalid request origin'},403);
    await ensureSchema(env.DB);
    const id = decodeURIComponent(match[1]), now = new Date().toISOString();
    const driver = await env.DB.prepare('SELECT id,name,taxi_number AS taxiNumber,status,allocated_area AS allocatedArea,current_job_id AS jobId,version FROM drivers WHERE id=?').bind(id).first<Record<string,unknown>>();
    if (!driver || driver.status === 'inactive') return json({error:'Driver not found on the dashboard.'},404);
    if (driver.jobId) return json({error:'Complete or cancel the current job before removing this driver.'},409);
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE drivers SET status='inactive',allocated_area='',available_since=NULL,instruction='Removed from dashboard',version=version+1,updated_at=? WHERE id=? AND current_job_id IS NULL AND status<>'inactive'").bind(now,id),
      env.DB.prepare("INSERT INTO admin_audit(id,actor_id,driver_id,before_json,after_json,recorded_at) SELECT ?,?,?,?,?,? FROM drivers WHERE id=? AND status='inactive' AND updated_at=?").bind(crypto.randomUUID(),user.id,id,JSON.stringify(driver),JSON.stringify({status:'inactive',removedFromDashboard:true}),now,id,now),
      env.DB.prepare("DELETE FROM push_subscriptions WHERE driver_id=? AND EXISTS(SELECT 1 FROM drivers WHERE id=? AND status='inactive' AND updated_at=?)").bind(id,id,now)
    ]);
    if (!results[0].meta.changes) return json({error:'Driver changed or has an active job. Refresh and try again.'},409);
    return json({ok:true,retainedJobHistory:true});
  }
  return json({error:'Not found'},404);
}
async function authorised(request: Request, env: Env) {
  if (administrator(request, env)) { await ensureSchema(env.DB); return true; }
  await ensureSchema(env.DB); const value = cookie(request, "rankflow_session"); if (!value) return false;
  const row = await env.DB.prepare("SELECT token FROM sessions WHERE token = ? AND expires_at > ?").bind(value, new Date().toISOString()).first(); return Boolean(row);
}
async function state(env: Env) {
  const [departures, drivers, jobs] = await Promise.all([
    env.DB.prepare("SELECT p.id, p.date, p.timestamp, p.rank, p.destination, p.passengers, p.taxi_number AS taxiNumber, p.marshal_name AS marshalName, p.status, p.cancelled_at AS cancelledAt, p.collected_at AS collectedAt, j.status AS jobStatus, j.completed_at AS completedAt FROM departures p LEFT JOIN jobs j ON j.id=p.id ORDER BY p.timestamp ASC").all(),
    env.DB.prepare("SELECT EXISTS(SELECT 1 FROM push_subscriptions p WHERE p.driver_id=d.id) AS hasJobAlerts,d.id,d.name,d.taxi_number AS taxiNumber,d.status,d.instruction,d.allocated_area AS allocatedArea,d.available_since AS availableSince,d.current_job_id AS jobId,d.job_status AS jobStatus,d.version AS driverVersion,d.updated_at AS updatedAt,j.version AS jobVersion,j.pickup,j.pickup_time AS pickupTime,j.destination,j.contact_name AS contactName,j.passenger_count AS passengerCount,j.job_message AS jobMessage,j.assigned_at AS assignedAt FROM drivers d LEFT JOIN jobs j ON j.id=d.current_job_id WHERE d.status<>'inactive' ORDER BY d.available_since ASC").all(),
    env.DB.prepare("SELECT j.id,j.driver_id AS driverId,j.taxi_number AS taxiNumber,d.name AS driverName,j.pickup,j.pickup_time AS pickupTime,j.destination,j.contact_name AS contactName,j.passenger_count AS passengerCount,j.job_message AS jobMessage,j.status,j.assigned_at AS assignedAt,j.accepted_at AS acceptedAt,j.collected_at AS collectedAt,j.completed_at AS completedAt,j.cancelled_at AS cancelledAt FROM jobs j LEFT JOIN drivers d ON d.id=j.driver_id LEFT JOIN departures p ON p.id=j.id WHERE p.id IS NULL ORDER BY j.assigned_at DESC").all()
  ]);
  return { departures:departures.results, drivers:drivers.results, jobs:jobs.results };
}
function validPushEndpoint(value: string) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && (u.hostname === 'web.push.apple.com' || u.hostname.endsWith('.push.apple.com') || u.hostname === 'fcm.googleapis.com' || u.hostname === 'updates.push.services.mozilla.com' || u.hostname.endsWith('.notify.windows.com')); } catch { return false; }
}
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
async function pushAuthorization(endpoint: string, env: Env) {
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({typ:'JWT',alg:'ES256'})}.${encode({aud:new URL(endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:'https://motion-weave-private-test.obeirnefrank.chatgpt.site'})}`;
  const key = await crypto.subtle.importKey('jwk',JSON.parse(env.VAPID_PRIVATE_JWK),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${base64url(new Uint8Array(signature))}, k=${env.VAPID_PUBLIC_KEY}`;
}
async function notifyDriver(env: Env, driverId: string) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return {sent:0,status:'not_configured'};
  const subscriptions = await env.DB.prepare('SELECT endpoint FROM push_subscriptions WHERE driver_id=?').bind(driverId).all<{endpoint:string}>();
  let sent = 0;
  await Promise.all(subscriptions.results.map(async ({endpoint}) => {
    if (!validPushEndpoint(endpoint)) return;
    try {
      // No passenger data leaves the app: the service worker displays a generic alert.
      const response = await fetch(endpoint,{method:'POST',headers:{Authorization:await pushAuthorization(endpoint,env),TTL:'300',Urgency:'high'},redirect:'error',signal:AbortSignal.timeout(8000)});
      if (response.ok) sent++;
      else if (response.status === 404 || response.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(endpoint).run();
    } catch { /* Job assignment remains committed even when the push service is unavailable. */ }
  }));
  return {sent,status:sent ? 'sent' : subscriptions.results.length ? 'failed' : 'not_enabled'};
}

async function api(request: Request, env: Env, url: URL) {
  if (url.pathname.startsWith("/api/admin/")) return adminApi(request, env, url);
  const driverInstallManifest = url.pathname.match(/^\/api\/driver-install-manifest\/([a-f0-9]{48})$/);
  if (driverInstallManifest && request.method === 'GET') {
    await ensureSchema(env.DB);
    const rawToken = driverInstallManifest[1], hash = await tokenHash(rawToken), now = new Date().toISOString();
    const valid = await env.DB.prepare("SELECT i.driver_id FROM driver_invites i JOIN drivers d ON d.id=i.driver_id WHERE i.token_hash=? AND i.expires_at>? AND d.status<>'inactive'").bind(hash,now).first();
    if (!valid) return json({error:'This installation link is invalid or expired.'},410);
    const manifest = {id:'/rankflow/driver',name:'Motion Weave Driver',short_name:'MW Driver',start_url:`/rankflow/driver.html?invite=${rawToken}`,scope:'/rankflow/',display:'standalone',background_color:'#071813',theme_color:'#071813',icons:[{src:'/rankflow/icons/icon-192.svg',sizes:'192x192',type:'image/svg+xml'},{src:'/rankflow/icons/icon-512.svg',sizes:'512x512',type:'image/svg+xml'}]};
    return new Response(JSON.stringify(manifest),{status:200,headers:{'content-type':'application/manifest+json; charset=utf-8','cache-control':'no-store'}});
  }
  const driverInvite = url.pathname.match(/^\/api\/driver-invites\/([a-f0-9]{48})$/);
  if (driverInvite && (request.method === 'GET' || request.method === 'POST')) {
    await ensureSchema(env.DB);
    const hash = await tokenHash(driverInvite[1]), now = new Date().toISOString();
    const invitation = await env.DB.prepare("SELECT i.driver_id AS driverId,i.phone_number AS phoneNumber,i.created_by AS createdBy,i.expires_at AS expiresAt,d.name,d.taxi_number AS taxiNumber,d.status FROM driver_invites i JOIN drivers d ON d.id=i.driver_id WHERE i.token_hash=? AND i.expires_at>? AND d.status<>'inactive'").bind(hash,now).first<Record<string,unknown>>();
    if (!invitation) return json({error:'This invitation is invalid or expired.'},410);
    if (request.method === 'GET') return json({name:invitation.name,taxiNumber:invitation.taxiNumber,expiresAt:invitation.expiresAt});
    const input = await request.json().catch(() => ({})) as {createInstallInvite?:unknown};
    const installInviteToken = input.createInstallInvite === true ? driverInvite[1] : undefined;
    const sessionToken = token(), expires = new Date(Date.now()+7*24*60*60*1000).toISOString();
    await env.DB.prepare('INSERT INTO sessions(token,expires_at) VALUES(?,?)').bind(sessionToken,expires).run();
    return json({driver:{id:invitation.driverId,name:invitation.name,taxiNumber:invitation.taxiNumber},status:invitation.status,installInviteToken},200,{"set-cookie":`rankflow_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`});
  }
  if (url.pathname === "/api/access" && request.method === "GET") return json({ authenticated:await authorised(request, env) });
  if (url.pathname === "/api/access" && request.method === "POST") {
    const input = await request.json().catch(() => ({})) as { code?:unknown };
    if (!env.EVENT_ACCESS_CODE || clean(input.code) !== env.EVENT_ACCESS_CODE) return json({ error:"Invalid access code" }, 401);
    await ensureSchema(env.DB); const value = token(), expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("INSERT INTO sessions (token, expires_at) VALUES (?, ?)").bind(value, expires).run();
    return json({ ok:true }, 200, { "set-cookie":`rankflow_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` });
  }
  if (!(await authorised(request, env))) return json({ error:"Event access required" }, 401);
  if (url.pathname === '/api/push/key' && request.method === 'GET') return json({enabled:Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK),publicKey:env.VAPID_PUBLIC_KEY || null});
  if (url.pathname === '/api/push/subscriptions' && request.method === 'POST') {
    const input = await request.json().catch(() => ({})) as {driverId?:unknown,subscription?:{endpoint?:unknown}};
    const driverId = clean(input.driverId), endpoint = clean(input.subscription?.endpoint);
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return json({error:'Job alerts are not configured yet'},503);
    if (!driverId || !validPushEndpoint(endpoint) || endpoint.length > 4096) return json({error:'Invalid phone subscription'},400);
    if (!(await env.DB.prepare('SELECT id FROM drivers WHERE id=?').bind(driverId).first())) return json({error:'Save your driver details first'},404);
    await env.DB.prepare('INSERT INTO push_subscriptions(endpoint,driver_id,updated_at) VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET driver_id=excluded.driver_id,updated_at=excluded.updated_at').bind(endpoint,driverId,new Date().toISOString()).run();
    return json({ok:true},201);
  }
  if (url.pathname === '/api/push/test' && request.method === 'POST') {
    const input = await request.json().catch(() => ({})) as {driverId?:unknown};
    const driverId = clean(input.driverId);
    if (!driverId || !(await env.DB.prepare('SELECT id FROM drivers WHERE id=?').bind(driverId).first())) return json({error:'Save your driver details first'},404);
    const notification = await notifyDriver(env,driverId).catch(() => ({sent:0,status:'failed'}));
    if (!notification.sent) return json({error:notification.status === 'not_configured' ? 'Job alerts are not configured yet.' : notification.status === 'not_enabled' ? 'Turn on job alerts on this phone first.' : 'The push service did not accept the test alert.',...notification},503);
    return json(notification,201);
  }
  if (url.pathname === "/api/state" && request.method === "GET") return json(await state(env));
  if (url.pathname === "/api/jobs" && request.method === "POST") {
    const input = await request.json().catch(() => ({})) as Record<string,unknown>, driverId=clean(input.driverId), pickup=clean(input.pickup), destination=clean(input.destination), jobMessage=clean(input.jobMessage), requestId=clean(input.requestId), passengers=Number(input.passengerCount), expected=Number(input.expectedDriverVersion);
    if(!driverId||!pickup||!destination||!requestId||jobMessage.length>500||!Number.isInteger(passengers)||passengers<1||passengers>6)return json({error:"Invalid job details"},400);
    const duplicate=await env.DB.prepare("SELECT response FROM command_requests WHERE request_id=?").bind(requestId).first<{response:string}>();if(duplicate)return json(JSON.parse(duplicate.response),201);
    const driver=await env.DB.prepare("SELECT * FROM drivers WHERE id=?").bind(driverId).first<Record<string,unknown>>();if(!driver)return json({error:"Driver not found"},404);
    if(driver.status!=="available"||driver.current_job_id||Number(driver.version)!==expected)return json({error:"Taxi is no longer available",code:"DRIVER_NOT_AVAILABLE"},409);
    const id=crypto.randomUUID(),now=new Date().toISOString(),response={job:{id,status:"assigned",version:1,driverId,taxiNumber:driver.taxi_number,pickup,pickupTime:clean(input.pickupTime),destination,contactName:clean(input.contactName),passengerCount:passengers,jobMessage,assignedAt:now},driver:{id:driverId,status:"busy",jobStatus:"assigned",jobId:id,version:expected+1,availableSince:null,updatedAt:now},serverTime:now};
    try{await env.DB.batch([
      env.DB.prepare("INSERT INTO jobs(id,driver_id,taxi_number,pickup,pickup_time,destination,contact_name,passenger_count,job_message,status,assigned_at) SELECT ?,id,taxi_number,?,?,?,?,?,?,'assigned',? FROM drivers WHERE id=? AND status='available' AND current_job_id IS NULL AND version=?").bind(id,pickup,clean(input.pickupTime)||null,destination,clean(input.contactName)||null,passengers,jobMessage,now,driverId,expected),
      env.DB.prepare("UPDATE drivers SET status='busy',available_since=NULL,current_job_id=?,job_status='assigned',instruction=?,version=version+1,updated_at=? WHERE id=? AND status='available' AND current_job_id IS NULL AND version=?").bind(id,`Pickup: ${pickup} → ${destination}`,now,driverId,expected),
      env.DB.prepare("INSERT INTO job_history(id,job_id,status,recorded_at)VALUES(?,?,'assigned',?)").bind(crypto.randomUUID(),id,now),
      env.DB.prepare("INSERT INTO command_requests(request_id,response,created_at)VALUES(?,?,?)").bind(requestId,JSON.stringify(response),now)
    ]);}catch{return json({error:"Taxi is no longer available",code:"DRIVER_NOT_AVAILABLE"},409);}const notification = await notifyDriver(env,driverId).catch(() => ({sent:0,status:"failed"})); return json({...response,notification},201);
  }
  const jobTransition=url.pathname.match(/^\/api\/jobs\/([^/]+)\/transition$/);
  if(jobTransition&&request.method==="POST"){
    const id=decodeURIComponent(jobTransition[1]),input=await request.json().catch(() => ({})) as Record<string,unknown>,action=clean(input.action)==="cancel" && input.confirmation!=="CANCEL" ? "request_cancel" : clean(input.action),requestId=clean(input.requestId),expected=Number(input.expectedJobVersion),rules:Record<string,[string[],string]>={acknowledge:[["assigned"],"accepted"],pickup:[["accepted"],"collected"],dropoff:[["collected"],"completed"],request_cancel:[["assigned","accepted"],"cancel_requested"],cancel:[["assigned","accepted","collected","cancel_requested"],"cancelled"]};
    if(!requestId||!rules[action])return json({error:"Invalid job command"},400);const duplicate=await env.DB.prepare("SELECT response FROM command_requests WHERE request_id=?").bind(requestId).first<{response:string}>();if(duplicate)return json(JSON.parse(duplicate.response));
    const job=await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<Record<string,unknown>>();if(!job)return json({error:"Job not found"},404);const [allowed,next]=rules[action];if(!allowed.includes(String(job.status))||Number(job.version)!==expected)return json({error:"This job changed since the screen last synced",code:"VERSION_CONFLICT"},409);
    const now=new Date().toISOString(),terminal=next==="completed"||next==="cancelled",stamp={accepted:"accepted_at",collected:"collected_at",completed:"completed_at",cancelled:"cancelled_at"}[next],driverVersion=Number((await env.DB.prepare("SELECT version FROM drivers WHERE id=?").bind(job.driver_id).first<{version:number}>())?.version||0)+1,response={job:{...job,status:next,version:expected+1},driver:{id:job.driver_id,status:terminal?"available":"busy",jobStatus:next,jobId:terminal?null:id,version:driverVersion,availableSince:terminal?now:null,updatedAt:now},serverTime:now};
    await env.DB.batch([
      stamp ? env.DB.prepare(`UPDATE jobs SET status=?,${stamp}=?,version=version+1 WHERE id=? AND status=? AND version=?`).bind(next,now,id,job.status,expected) : env.DB.prepare("UPDATE jobs SET status=?,version=version+1 WHERE id=? AND status=? AND version=?").bind(next,id,job.status,expected),
      env.DB.prepare("UPDATE drivers SET status=?,available_since=?,current_job_id=?,job_status=?,instruction=?,version=version+1,updated_at=? WHERE id=? AND current_job_id=?").bind(terminal?"available":"busy",terminal?now:null,terminal?null:id,next,terminal?"Waiting for your next job":next==="cancel_requested"?"Cancelled — awaiting Drive Office confirmation":next==="accepted"?"Proceed to pickup":"Passenger onboard — proceed to destination",now,job.driver_id,id),
      env.DB.prepare("INSERT INTO job_history(id,job_id,status,recorded_at)VALUES(?,?,?,?)").bind(crypto.randomUUID(),id,next,now),
      env.DB.prepare("INSERT INTO command_requests(request_id,response,created_at)VALUES(?,?,?)").bind(requestId,JSON.stringify(response),now),
      env.DB.prepare("UPDATE departures SET status='cancelled',cancelled_at=? WHERE id=? AND ?='cancelled'").bind(now,id,next)
    ]);return json(response);
  }
  if (url.pathname === "/api/departures" && request.method === "POST") {
    const input = await request.json().catch(() => ({})) as Record<string, unknown>;
    const passengers = Number(input.passengers), taxiNumber = clean(input.taxiNumber), rank = clean(input.rank), destination = clean(input.destination), id = clean(input.id) || crypto.randomUUID();
    if (!rank || rank.length > 80 || !destination || destination.length > 80 || !/^\d{2}$/.test(taxiNumber) || !Number.isInteger(passengers) || passengers < 1 || passengers > 6) return json({error:"Invalid departure details"},400);
    const existing = await env.DB.prepare('SELECT id FROM departures WHERE id=?').bind(id).first();
    if (existing) return json({id,alreadyLogged:true},200);
    const driver = await env.DB.prepare("SELECT id,version,status,current_job_id FROM drivers WHERE taxi_number=? AND status<>'inactive'").bind(taxiNumber).first<{id:string,version:number,status:string,current_job_id:string|null}>();
    if (!driver) return json({error:`Taxi ${taxiNumber} is not registered. Add the driver in Drive Office first.`},404);
    if (driver.current_job_id || driver.status === 'busy') return json({error:`Taxi ${taxiNumber} is already on a job. Enter the next taxi number, or wait for the driver to complete drop-off.`},409);
    if (driver.status !== 'available') return json({error:`Taxi ${taxiNumber} is off shift. The driver must check in first.`},409);
    const now = new Date().toISOString(), marshalName = clean(input.marshalName).slice(0,40) || 'Marshal';
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(clean(input.date)) ? clean(input.date) : now.slice(0,10);
    const departure = {id,date:eventDate,timestamp:now,rank,destination,passengers,taxiNumber,marshalName,status:'active',jobStatus:'collected'};
    try {
      const results = await env.DB.batch([
        env.DB.prepare("INSERT INTO jobs(id,driver_id,taxi_number,pickup,destination,passenger_count,status,version,assigned_at,accepted_at,collected_at) SELECT ?,id,taxi_number,?,?,?,'collected',1,?,?,? FROM drivers WHERE id=? AND status='available' AND current_job_id IS NULL AND version=?").bind(id,rank,destination,passengers,now,now,now,driver.id,driver.version),
        env.DB.prepare("UPDATE drivers SET status='busy',available_since=NULL,current_job_id=?,job_status='collected',instruction=?,version=version+1,updated_at=? WHERE id=? AND status='available' AND current_job_id IS NULL AND version=? AND EXISTS(SELECT 1 FROM jobs WHERE id=?)").bind(id,`Passengers onboard — ${rank} → ${destination}`,now,driver.id,driver.version,id),
        env.DB.prepare("INSERT INTO departures(id,date,timestamp,rank,destination,passengers,taxi_number,marshal_name) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)").bind(id,departure.date,now,rank,destination,passengers,taxiNumber,marshalName,id),
        env.DB.prepare("INSERT INTO job_history(id,job_id,status,recorded_at) SELECT ?,?,'collected',? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=?)").bind(crypto.randomUUID(),id,now,id)
      ]);
      if (!results[0].meta.changes || !results[1].meta.changes) return json({error:`Taxi ${taxiNumber} changed while logging. Refresh and try again.`},409);
    } catch { return json({error:`Taxi ${taxiNumber} could not be assigned. Refresh and try again.`},409); }
    const notification = await notifyDriver(env,driver.id).catch(() => ({sent:0,status:'failed'}));
    return json({...departure,notification},201);
  }
  if (url.pathname.startsWith("/api/drivers/") && request.method === "PUT") {
    const id = decodeURIComponent(url.pathname.slice("/api/drivers/".length)); const input = await request.json().catch(() => ({})) as Record<string, unknown>; const taxiNumber = clean(input.taxiNumber);
    if (!id || !clean(input.name) || !/^\d{2}$/.test(taxiNumber) || !["available","break","offline"].includes(clean(input.status))) return json({ error:"Invalid driver details" }, 400);
    const allocatedArea = clean(input.allocatedArea); if (allocatedArea.length > 80) return json({error:"Invalid allocated area"},400);
    const duplicate = await env.DB.prepare("SELECT id FROM drivers WHERE taxi_number=? AND id<>? AND status<>'inactive'").bind(taxiNumber,id).first();
    if (duplicate) return json({error:`Taxi ${taxiNumber} is already in the dashboard.`},409);
    const driver = { id, name:clean(input.name), taxiNumber, status:clean(input.status), allocatedArea, instruction:clean(input.instruction) || "", contactName:clean(input.contactName), destination:clean(input.destination), updatedAt:new Date().toISOString() };
    const savedDriver = await env.DB.prepare("INSERT INTO drivers (id, name, taxi_number, status, allocated_area, instruction, contact_name, destination, updated_at, available_since) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ?='available' THEN ? ELSE NULL END) ON CONFLICT(id) DO UPDATE SET name=excluded.name, taxi_number=excluded.taxi_number, status=excluded.status, allocated_area=excluded.allocated_area, instruction=excluded.instruction, contact_name=excluded.contact_name, destination=excluded.destination, updated_at=excluded.updated_at, available_since=CASE WHEN excluded.status='available' THEN COALESCE(drivers.available_since,excluded.updated_at) ELSE NULL END, version=drivers.version+1 WHERE drivers.current_job_id IS NULL").bind(driver.id, driver.name, driver.taxiNumber, driver.status, driver.allocatedArea, driver.instruction, driver.contactName, driver.destination, driver.updatedAt,driver.status,driver.updatedAt).run();
    if (!savedDriver.meta.changes) return json({error:"Finish the current job before taking a break or changing driver details."},409);
    return json(driver);
  }
  if (url.pathname.startsWith("/api/departures/") && request.method === "PATCH") {
    const id = decodeURIComponent(url.pathname.slice("/api/departures/".length)); const input = await request.json().catch(() => ({})) as { action?:unknown }; const action = clean(input.action);
    if (!["cancel","restore","collect"].includes(action)) return json({ error:"Invalid departure action" }, 400);
    const departure = await env.DB.prepare("SELECT status FROM departures WHERE id = ?").bind(id).first<{ status:string }>(); if (!departure) return json({ error:"Departure not found" }, 404);
    const now = new Date().toISOString();
    const linkedJob = await env.DB.prepare("SELECT status,driver_id AS driverId,version FROM jobs WHERE id=?").bind(id).first<{status:string,driverId:string,version:number}>();
    if (linkedJob && action === 'restore') return json({error:'A cancelled driver job cannot be restored. Log a new departure if the taxi leaves again.'},409);
    if (linkedJob && action === 'cancel') {
      if (linkedJob.status !== 'collected') return json({error:'This job has already been completed or cancelled.'},409);
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE jobs SET status='cancelled',cancelled_at=?,version=version+1 WHERE id=? AND status='collected' AND version=?").bind(now,id,linkedJob.version),
        env.DB.prepare("UPDATE drivers SET status='available',available_since=?,current_job_id=NULL,job_status='cancelled',instruction='Waiting for your next job',version=version+1,updated_at=? WHERE id=? AND current_job_id=?").bind(now,now,linkedJob.driverId,id),
        env.DB.prepare("UPDATE departures SET status='cancelled',cancelled_at=?,collected_at=NULL WHERE id=?").bind(now,id),
        env.DB.prepare("INSERT INTO job_history(id,job_id,status,recorded_at) VALUES(?,?,'cancelled',?)").bind(crypto.randomUUID(),id,now)
      ]);
      if (!results[0].meta.changes || !results[1].meta.changes) return json({error:'This job changed. Refresh and try again.'},409);
      return json({id,action});
    }
    if (action === "cancel") await env.DB.prepare("UPDATE departures SET status = 'cancelled', cancelled_at = ?, collected_at = NULL WHERE id = ?").bind(now, id).run();
    if (action === "restore") await env.DB.prepare("UPDATE departures SET status = 'active', cancelled_at = NULL, collected_at = NULL WHERE id = ?").bind(id).run();
    if (action === "collect") { if (departure.status !== "cancelled") return json({ error:"Only cancelled jobs can be collected" }, 409); await env.DB.prepare("UPDATE departures SET collected_at = ? WHERE id = ?").bind(now, id).run(); }
    return json({ id, action });
  }
  return json({ error:"Not found" }, 404);
}

export default { async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return api(request, env, url);
  if (url.pathname === "/_vinext/image") return handleImageOptimization(request, { fetchAsset:path => env.ASSETS.fetch(new Request(new URL(path, request.url))), transformImage:async (body, { width, format, quality }) => (await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality })).response() }, [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES]);
  return handler.fetch(request, env, context);
} };
