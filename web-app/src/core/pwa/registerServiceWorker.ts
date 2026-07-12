export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) {
    return null;
  }

  return navigator.serviceWorker.register('/sw.js');
}
