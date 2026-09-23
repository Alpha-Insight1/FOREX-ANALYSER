import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://wkgdlkijfgjebwlgdpcf.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

export const supabaseConfigured = Boolean(SUPABASE_PUBLISHABLE_KEY);

export const supabase = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY || "public-anon-placeholder",
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
);

/**
 * Primary: Vercel /api/forex-analysis (full FX + Gold + indices, prop-firm gates).
 * Fallback: legacy Supabase edge function if Vercel API fails.
 */
export const FOREX_ANALYSIS_URL =
  import.meta.env.VITE_FOREX_ANALYSIS_URL || "/api/forex-analysis";

export const FOREX_ANALYSIS_FALLBACK_URL = `${SUPABASE_URL}/functions/v1/forex-analysis`;
