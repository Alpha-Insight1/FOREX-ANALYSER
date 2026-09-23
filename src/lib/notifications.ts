const STORAGE_KEY = "smc-notify-enabled";

export function isNotificationApiAvailable(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function isSecureContextOk(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

/** iOS Safari only exposes reliable web notifications for installed Home Screen apps. */
export function isLikelyIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const chrome = /CriOS|Chrome|FxiOS/.test(ua);
  return iOS && webkit && !chrome;
}

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = window.matchMedia?.("(display-mode: standalone)")?.matches;
  // iOS legacy
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(standalone || iosStandalone);
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

export async function showTradeNotification(title: string, body: string, tag?: string): Promise<boolean> {
  if (!isNotificationApiAvailable()) return false;
  if (Notification.permission !== "granted") return false;

  try {
    const reg = await ensureServiceWorker();
    if (reg?.showNotification) {
      await reg.showNotification(title, {
        body,
        tag: tag || "jaggy-trade",
        icon: "/jaggy-logo.svg",
        badge: "/jaggy-logo.svg",
        // @ts-expect-error vibrate is supported on many mobile browsers
        vibrate: [100, 50, 100],
        data: { url: "/" },
      });
      return true;
    }
  } catch {
    // fall through to page Notification
  }

  try {
    // Some browsers throw if constructed outside SW; catch and still count as enabled
    const n = new Notification(title, {
      body,
      tag: tag || "jaggy-trade",
      icon: "/jaggy-logo.svg",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

export async function requestNotificationAccess(): Promise<{
  ok: boolean;
  permission: NotificationPermission | "unsupported";
  message: string;
  inAppOnly?: boolean;
}> {
  if (!isSecureContextOk()) {
    return {
      ok: false,
      permission: "unsupported",
      message: "Notifications require HTTPS. Open this site (HTTPS)",
    };
  }

  if (!isNotificationApiAvailable()) {
    const ios = isLikelyIosSafari() && !isStandalonePwa();
    return {
      ok: false,
      permission: "unsupported",
      message: ios
        ? "On iPhone: Share → Add to Home Screen, open Jaggy from the icon, then enable alerts."
        : "This browser does not support web notifications. Try Chrome or Edge.",
    };
  }

  // Already denied — browser will not show the prompt again
  if (Notification.permission === "denied") {
    return {
      ok: false,
      permission: "denied",
      message:
        "Notifications are blocked for this site. In your browser settings, allow notifications for this site, then try again.",
    };
  }

  let permission: NotificationPermission = Notification.permission;
  try {
    // Prefer promise form; older Safari uses callback
    const maybe = Notification.requestPermission();
    if (typeof maybe === "string") {
      permission = maybe as NotificationPermission;
    } else {
      permission = await maybe;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Permission request failed";
    return { ok: false, permission: "default", message: msg };
  }

  if (permission !== "granted") {
    return {
      ok: false,
      permission,
      message:
        permission === "denied"
          ? "Permission denied. Allow notifications in browser site settings."
          : "Permission dismissed. Tap the bell again and choose Allow.",
    };
  }

  localStorage.setItem(STORAGE_KEY, "true");
  await ensureServiceWorker();

  const shown = await showTradeNotification(
    "Jaggy Analyser · Alerts on",
    "You will be notified when a trade is taken.",
    "jaggy-notify-on",
  );

  if (!shown) {
    // Permission granted but OS banner could not be shown (common on some mobile browsers).
    // In-app toasts + sound still work.
    return {
      ok: true,
      permission: "granted",
      inAppOnly: true,
      message:
        "Alerts enabled (in-app). System banners may need Home Screen install on iPhone, or Chrome on Android.",
    };
  }

  return {
    ok: true,
    permission: "granted",
    message: "Phone notifications enabled. Keep the app open or installed for best delivery.",
  };
}

export { STORAGE_KEY };
