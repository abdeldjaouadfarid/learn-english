// Push subscription helpers. Assumes Auth is loaded first (uses Auth.authFetch).
window.Push = (() => {
  const SW_PATH = '/sw.js';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const bytes = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) bytes[i] = rawData.charCodeAt(i);
    return bytes;
  }

  function isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async function registerSw() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      return await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
    } catch (err) {
      console.warn('SW registration failed', err);
      return null;
    }
  }

  async function currentSubscription() {
    if (!isSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  }

  async function status() {
    const supported = isSupported();
    const permission = supported ? Notification.permission : 'default';
    const sub = supported ? await currentSubscription() : null;
    return { supported, permission, subscribed: !!sub, endpoint: sub?.endpoint || null };
  }

  async function enable() {
    if (!isSupported()) throw new Error('Push notifications are not supported in this browser.');

    const reg = await registerSw();
    if (!reg) throw new Error('Service worker could not be registered.');

    // Ask permission (must be from a user gesture)
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Permission denied.');

    // Fetch VAPID public key from server
    const kRes = await fetch('/api/push/vapid-public-key');
    const kData = await kRes.json();
    if (!kData.key) throw new Error('Push not configured on the server.');

    // Subscribe
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(kData.key),
      });
    }

    // Send subscription to server
    const res = await Auth.authFetch('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub.toJSON()),
    });
    if (!res.ok) throw new Error('Failed to save subscription on server.');
    return true;
  }

  async function disable() {
    const sub = await currentSubscription();
    if (!sub) return false;
    try {
      await Auth.authFetch('/api/push/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    } catch {}
    await sub.unsubscribe();
    return true;
  }

  async function sendTest() {
    const res = await Auth.authFetch('/api/push/test', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Test failed');
    }
    return true;
  }

  return { isSupported, status, enable, disable, sendTest };
})();
