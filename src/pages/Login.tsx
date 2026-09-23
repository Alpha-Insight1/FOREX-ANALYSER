import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { Lock, Mail, Shield, Eye, EyeOff, Loader2 } from "lucide-react";
import { BrandMark, CreatedByJaggy } from "@/components/BrandMark";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function Login() {
  const { isAuthenticated, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim() || "trader", code);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12 overflow-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 ambient-bg" />
      <div className="pointer-events-none absolute inset-0 grid-pattern opacity-40" />

      <div className="relative w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark size="lg" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
            Jaggy Analyser
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Institutional SMC scanner · Secure workspace
          </p>
          <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-primary/90">
            Created by JAGGY
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-border/70 surface-1 p-7 shadow-card">
          <div className="mb-6 flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Sign in to continue</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Signals and trade analytics are restricted to authorised users only.
              </p>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="you@firm.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 pl-10 surface-2 border-border/80"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="code" className="text-xs uppercase tracking-wider text-muted-foreground">
                Access code
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="code"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••••••"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  className="h-11 pl-10 pr-10 surface-2 border-border/80"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={show ? "Hide code" : "Show code"}
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                className={cn(
                  "rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear",
                )}
                role="alert"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting || !code}
              className="h-11 w-full gap-2 gradient-gold text-primary-foreground font-semibold shadow-gold"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Unlock workspace
                </>
              )}
            </Button>
          </form>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
            Sessions expire after 24 hours. Do not share your access code.
          </p>
        </div>

        <div className="mt-6 space-y-1.5">
          <CreatedByJaggy />
          <p className="text-center text-[11px] text-muted-foreground/80">
            Educational analysis only · Not financial advice
          </p>
        </div>
      </div>
    </div>
  );
}
