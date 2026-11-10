(() => {
  const $ = id => document.getElementById(id);
  let drivers = [], editing = null;
  async function api(path, options = {}) {
    const response = await fetch(`/api/admin/${path}`, {cache:'no-store', ...options});
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 403) { $('controls').hidden = true; $('login').hidden = false; }
      throw new Error(data.error || 'Unable to save changes.');
    }
    return data;
  }
  function render() {
    const query = $('search').value.trim().toLowerCase();
    $('drivers').replaceChildren();
    const shown = drivers.filter(driver => `${driver.name} ${driver.taxiNumber}`.toLowerCase().includes(query));
    for (const driver of shown) {
      const row = document.createElement('article'); row.className = 'driver-row';
      const details = document.createElement('div'), title = document.createElement('strong'), status = document.createElement('small');
      title.textContent = `Taxi ${driver.taxiNumber} · ${driver.name}`;
      status.textContent = driver.jobId ? 'On a job · editing unavailable' : driver.status;
      details.append(title,status);
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Edit'; button.disabled = Boolean(driver.jobId);
      button.addEventListener('click', () => { editing = driver; $('name').value = driver.name; $('taxi').value = driver.taxiNumber; $('edit-error').textContent = ''; $('edit').showModal(); });
      row.append(details, button); $('drivers').append(row);
    }
    if (!shown.length) $('drivers').textContent = drivers.length ? 'No matching drivers.' : 'No drivers registered yet.';
  }
  async function refresh() {
    $('status').textContent = 'Loading drivers…';
    try { drivers = (await api('drivers')).drivers; render(); $('status').textContent = `${drivers.length} registered drivers`; }
    catch (error) { $('status').textContent = error.message; }
  }
  $('refresh').addEventListener('click', refresh);
  $('search').addEventListener('input', render);
  $('cancel').addEventListener('click', () => $('edit').close());
  $('edit-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.submitter; button.disabled = true;
    try {
      await api(`drivers/${encodeURIComponent(editing.id)}`, {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('name').value,taxiNumber:$('taxi').value,version:editing.version})});
      $('edit').close(); await refresh(); $('status').textContent = 'Driver details saved.';
    } catch (error) { $('edit-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  api('me').then(async ({user}) => { $('email').textContent = user.email; $('login').hidden = true; $('controls').hidden = false; await refresh(); }).catch(error => { $('login-note').textContent = error.message; });
})();
