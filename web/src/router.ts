// Routeur minimal par hash (#/album/…) : fonctionne sur GitHub Pages sans
// configuration et garde l'historique (geste retour, bouton retour).
import { useEffect, useState } from 'preact/hooks';

export function currentPath() {
  return decodeURI(location.hash.replace(/^#/, '')) || '/';
}

export function navigate(path: string, replace = false) {
  const h = `#${encodeURI(path)}`;
  if (replace) history.replaceState(null, '', h);
  else history.pushState(null, '', h);
  window.dispatchEvent(new Event('choutify:route'));
}

export function back(fallback = '/') {
  if (history.length > 1 && sessionStorage.getItem('choutify.nav') === '1') history.back();
  else navigate(fallback, true);
}

const scrolls = new Map<string, number>();

export function useRoute() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = (e: Event) => {
      scrolls.set(path, window.scrollY);
      const p = currentPath();
      setPath(p);
      sessionStorage.setItem('choutify.nav', '1');
      // Retour arrière : on retrouve la position ; nouvelle page : en haut.
      const y = e.type === 'popstate' ? scrolls.get(p) ?? 0 : 0;
      requestAnimationFrame(() => window.scrollTo(0, y));
    };
    // L'adresse a pu changer avant l'abonnement (retour de connexion Google).
    if (currentPath() !== path) setPath(currentPath());
    window.addEventListener('popstate', on);
    window.addEventListener('choutify:route', on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener('choutify:route', on);
    };
  }, [path]);
  return path;
}

export function link(path: string) {
  return (e: Event) => {
    e.preventDefault();
    navigate(path);
  };
}
