import { cn } from "@/lib/utils";

interface BrandMarkProps {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  className?: string;
}

const sizes = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-14 w-14",
};

export function BrandMark({ size = "md", showWordmark = false, className }: BrandMarkProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <img
        src="/jaggy-logo.svg"
        alt="Jaggy"
        className={cn("shrink-0 rounded-xl shadow-card", sizes[size])}
      />
      {showWordmark && (
        <div className="min-w-0 text-left">
          <p className="truncate text-sm font-semibold tracking-tight text-foreground sm:text-base">
            Jaggy Analyser
          </p>
          <p className="truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Created by JAGGY
          </p>
        </div>
      )}
    </div>
  );
}

export function CreatedByJaggy({ className }: { className?: string }) {
  return (
    <p className={cn("text-center text-[11px] text-muted-foreground", className)}>
      Created by <span className="font-semibold tracking-wide text-foreground/80">JAGGY</span>
    </p>
  );
}
