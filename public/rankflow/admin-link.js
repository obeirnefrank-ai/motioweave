(() => {
  const link = document.createElement('a');
  link.href = './admin.html'; link.target = '_top'; link.textContent = 'Administrator';
  link.style.cssText = 'display:block;width:max-content;max-width:100%;margin:16px auto;padding:12px 20px;border-radius:8px;background:#10261f;color:#fff;font:600 14px system-ui;text-decoration:underline;text-align:center';
  document.body.append(link);
})();
