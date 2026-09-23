import { ShieldCheck, Target, Scale, Ban } from "lucide-react";

/** Discipline checklist for funded-account / challenge style trading. */
export function PropFirmRules() {
  return (
    <div className="rounded-xl border border-gold/25 bg-gold/5 p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-gold" />
        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          Prop-firm mode · A+ setups only
        </h3>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        Scanner fires only high-conviction setups (confidence ≥ 85%). Built for
        challenge consistency — not signal volume.
      </p>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        <Rule
          icon={Target}
          title="Only take Live signals"
          body="Developing = watchlist. Enter only when TRADE TAKEN / Live card prints."
        />
        <Rule
          icon={Scale}
          title="Risk 0.25–0.5% per trade"
          body="Never risk more than 0.5% of account equity. One loss must not breach daily limit."
        />
        <Rule
          icon={Ban}
          title="Max 1–2 trades / day"
          body="Stop after two A+ setups or one full R loss. Overtrading fails challenges."
        />
        <Rule
          icon={ShieldCheck}
          title="Honor SL · BE at +2R"
          body="Never move SL against you. At +2R, break-even is automatic. Trail only in profit."
        />
      </ul>
    </div>
  );
}

function Rule({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-2.5 rounded-lg border border-border/50 surface-1 px-3 py-2.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
      <div>
        <p className="text-xs font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}
