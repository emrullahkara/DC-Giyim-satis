// Tema tercihi sayfa çizilmeden önce uygulanır (yanıp sönmeyi önler)
try {
  const t = localStorage.getItem('dc-tema');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* depolama kapalı olabilir */ }
