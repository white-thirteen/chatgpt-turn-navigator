export function watchTheme(host) {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    const html = document.documentElement;
    const explicit = html.getAttribute('data-theme') || html.getAttribute('data-color-mode');
    let dark;
    if (html.classList.contains('dark') || explicit === 'dark') dark = true;
    else if (html.classList.contains('light') || explicit === 'light') dark = false;
    else {
      const scheme = html.style.colorScheme;
      dark = scheme === 'dark' ? true : scheme === 'light' ? false : media.matches;
    }
    host.dataset.theme = dark ? 'dark' : 'light';
  };
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'] });
  media.addEventListener('change', update);
  update();
  return () => { observer.disconnect(); media.removeEventListener('change', update); };
}
