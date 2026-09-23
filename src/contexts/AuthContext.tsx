import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "jaggy_session_v1";

interface Session {
  token: string;
  email: string;
  expiresAt: number;
}

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, code: string) => Promise<void>;
  signOut: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStored(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s?.token || !s?.expiresAt || Date.now() > s.expiresAt) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = readStored();
    if (!s) {
      setLoading(false);
      return;
    }
    // Re-verify token with server
    fetch("/api/auth-verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${s.token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("invalid");
        const j = await r.json();
        if (!j.valid) throw new Error("invalid");
        setSession(s);
      })
      .catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const signIn = useCallback(async (email: string, code: string) => {
    const res = await fetch("/api/auth-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Sign-in failed");
    }
    const next: Session = {
      token: data.token,
      email: data.email,
      expiresAt: data.expiresAt,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      signIn,
      signOut,
      isAuthenticated: Boolean(session),
    }),
    [session, loading, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
