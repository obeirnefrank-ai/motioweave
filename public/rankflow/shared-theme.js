(()=>{
  const button=document.querySelector('[data-theme-toggle]');
  if(!button)return;
  const key='motion-weave-shared-theme';
  const meta=document.querySelector('meta[name="theme-color"]');
  const label=button.querySelector('b');
  const apply=theme=>{
    const dark=theme!=='light';
    document.body.classList.toggle('dark-mode',dark);
    document.body.classList.toggle('light-mode',!dark);
    button.setAttribute('aria-pressed',String(dark));
    label.textContent=dark?'Light screen':'Dark screen';
    if(meta)meta.content=dark?'#071813':'#eef1ed';
  };
  apply(localStorage.getItem(key)||'dark');
  button.addEventListener('click',()=>{
    const next=document.body.classList.contains('dark-mode')?'light':'dark';
    localStorage.setItem(key,next);
    apply(next);
  });
  window.addEventListener('storage',event=>{if(event.key===key&&event.newValue)apply(event.newValue);});
})();
