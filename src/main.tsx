import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ensureServiceWorker } from "./lib/notifications";

createRoot(document.getElementById("root")!).render(<App />);

// Register SW for notification display (non-blocking)
if (typeof window !== "undefined") {
  ensureServiceWorker().catch(() => {});
}
