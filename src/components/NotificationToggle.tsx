import { useEffect, useState } from "react";
import { Bell, BellOff, Vibrate, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  playTradeAlertSound,
  vibrateTradeAlert,
  isVibrationEnabled,
  setVibrationEnabled,
} from "@/lib/alertSound";
import {
  STORAGE_KEY,
  requestNotificationAccess,
  showTradeNotification,
  isNotificationApiAvailable,
  isLikelyIosSafari,
  isStandalonePwa,
  ensureServiceWorker,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { sendTelegramTradeAlert, sendTelegramTestMessage } from "@/lib/telegramNotify";

export const NotificationToggle = () => {
  const [enabled, setEnabled] = useState(false);
  const [vibrate, setVibrate] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (isNotificationApiAvailable()) {
      setPermission(Notification.permission);
    } else {
      setPermission("unsupported");
    }
    setEnabled(localStorage.getItem(STORAGE_KEY) === "true");
    setVibrate(isVibrationEnabled());
    // Register SW early so later showNotification works
    ensureServiceWorker().catch(() => {});
  }, []);

  const enableNotifications = async () => {
    const result = await requestNotificationAccess();
    setPermission(result.permission === "unsupported" ? "unsupported" : result.permission);

    if (result.ok) {
      setEnabled(true);
      playTradeAlertSound();
      vibrateTradeAlert();
      toast.success(result.inAppOnly ? "In-app alerts enabled" : "Notifications enabled", {
        description: result.message,
        duration: 8000,
      });
      return;
    }

    setEnabled(false);
    toast.error("Could not enable notifications", {
      description: result.message,
      duration: 10000,
    });
  };

  const disableNotifications = () => {
    localStorage.setItem(STORAGE_KEY, "false");
    setEnabled(false);
    toast.message("Notifications paused");
  };

  const toggleVibrate = () => {
    const next = !vibrate;
    setVibrate(next);
    setVibrationEnabled(next);
    if (next) vibrateTradeAlert();
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        className={cn(
          "gap-1.5",
          enabled && permission === "granted"
            ? "text-gold hover:text-gold"
            : "text-muted-foreground",
        )}
        onClick={enabled ? disableNotifications : enableNotifications}
        title={enabled ? "Disable notifications" : "Enable phone notifications"}
      >
        {enabled && permission === "granted" ? (
          <Bell className="h-4 w-4" />
        ) : (
          <BellOff className="h-4 w-4" />
        )}
        <span className="hidden text-xs sm:inline">
          {enabled && permission === "granted" ? "Alerts on" : "Alerts"}
        </span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={cn("px-2", vibrate ? "text-gold" : "text-muted-foreground")}
        onClick={toggleVibrate}
        title={vibrate ? "Vibration on" : "Vibration off"}
      >
        <Vibrate className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
        title="Send test Telegram message"
        onClick={async () => {
          toast.message("Sending Telegram test…");
          const r = await sendTelegramTestMessage();
          if (r.ok) toast.success("Telegram test sent — check your phone");
          else toast.error("Telegram test failed", { description: r.error, duration: 10000 });
        }}
      >
        <span className="text-[10px] font-semibold tracking-wide">Telegram</span>
      </Button>
    </div>
  );
};

export function notifyNewSignal(opts: {
  pair: string;
  direction: string;
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
}) {
  if (
    typeof Notification !== "undefined" &&
    Notification.permission === "granted" &&
    localStorage.getItem(STORAGE_KEY) !== "false"
  ) {
    localStorage.setItem(STORAGE_KEY, "true");
  }

  const enabled = localStorage.getItem(STORAGE_KEY) === "true";
  const title = `TRADE TAKEN · ${opts.direction} ${opts.pair}`;
  const body = `${opts.confidence}% · Entry ${opts.entry} · SL ${opts.stopLoss} · TP ${opts.takeProfit}`;

  toast.success(title, { description: body, duration: 12000 });
  playTradeAlertSound();
  vibrateTradeAlert();

  // Always try Telegram (configured server-side) — independent of browser permission
  void sendTelegramTradeAlert({
    pair: opts.pair,
    direction: opts.direction,
    confidence: opts.confidence,
    entry: opts.entry,
    stopLoss: opts.stopLoss,
    takeProfit: opts.takeProfit,
  });

  if (!enabled) return;

  void showTradeNotification(title, body, `trade-${opts.pair}-${opts.entry}`);
}

export function NotificationHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("jaggy-notify-hint-dismissed") === "1") return;
    if (localStorage.getItem(STORAGE_KEY) === "true") return;
    if (isNotificationApiAvailable() && Notification.permission === "granted") return;
    setShow(true);
  }, []);

  if (!show) return null;

  const iosHint = isLikelyIosSafari() && !isStandalonePwa();

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border/70 bg-surface-2/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Smartphone className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Get alerts when a trade is taken</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {iosHint
              ? "On iPhone: tap Share → Add to Home Screen, open Jaggy from the home icon, then Enable alerts."
              : "Tap Enable, then choose Allow when your browser asks. Use Chrome on Android for the most reliable banners."}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => {
            localStorage.setItem("jaggy-notify-hint-dismissed", "1");
            setShow(false);
          }}
        >
          Not now
        </Button>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={async () => {
            const result = await requestNotificationAccess();
            if (result.ok) {
              playTradeAlertSound();
              vibrateTradeAlert();
              toast.success("Alerts enabled", { description: result.message, duration: 8000 });
            } else {
              toast.error("Could not enable notifications", {
                description: result.message,
                duration: 10000,
              });
            }
            localStorage.setItem("jaggy-notify-hint-dismissed", "1");
            setShow(false);
          }}
        >
          <Bell className="h-3.5 w-3.5" />
          Enable alerts
        </Button>
      </div>
    </div>
  );
}
