(() => {
  const endpoint = '/api/access';
  let overlay;
  const show = () => {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'event-access-overlay';
    overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-label','Event access');
    overlay.style.cssText='position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:#071813ee;color:#fff9ea';
    overlay.innerHTML = `<form class="event-access-card"><p>EVENT LONDON TAXIS</p><h1>Event access</h1><span>Enter the shared event code to continue.</span><input name="code" autocomplete="current-password" required autofocus /><button>Enter app</button><small></small><a href="./admin.html" target="_top" style="color:white">Administrator sign-in</a></form>`;
    document.body.append(overlay);
    overlay.querySelector('form').style.cssText='display:grid;gap:14px;width:min(100%,390px);padding:28px;border:1px solid #59b85b;border-radius:20px;background:#10261f';
    overlay.querySelector('input').setAttribute('aria-label','Event code');
    overlay.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const note = overlay.querySelector('small');
      try { const response = await fetch(endpoint, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ code:form.get('code') }) }); if (!response.ok) throw new Error(); const url=new URL(location.href); url.searchParams.delete('eventLogin'); location.replace(url.href); }
      catch { note.textContent = 'That code was not recognised. Please try again.'; }
    });
  };
  const hasDriverInvite = location.pathname.endsWith('/driver.html') && new URLSearchParams(location.search).has('invite');
  window.RankFlowAccess = fetch(endpoint, { credentials:'same-origin' }).then(response => response.ok ? response.json() : null).then(result => { if ((result?.authenticated && !new URLSearchParams(location.search).has('eventLogin')) || hasDriverInvite) return true; show(); return false; }).catch(() => { if (hasDriverInvite) return true; show(); overlay.querySelector('small').textContent='Unable to connect. Check your internet connection and try again.'; return false; });
})();
