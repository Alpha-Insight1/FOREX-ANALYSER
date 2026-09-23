export const config = { runtime: "edge" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacToken(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const bytes = new Uint8Array(sig);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const accessCode = process.env.APP_ACCESS_CODE || "";
  const sessionSecret = process.env.APP_SESSION_SECRET || accessCode || "jaggy-dev-secret-change-me";

  if (!accessCode) {
    return new Response(
      JSON.stringify({
        error: "Access control is not configured. Set APP_ACCESS_CODE in Vercel env vars.",
      }),
      { status: 503, headers: corsHeaders },
    );
  }

  let body: { email?: string; code?: string; password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const code = String(body.code || body.password || "").trim();
  const email = String(body.email || "trader").trim().toLowerCase().slice(0, 120);

  if (!code || !timingSafeEqual(code, accessCode)) {
    // Constant-ish delay against timing probes
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 200));
    return new Response(JSON.stringify({ error: "Invalid credentials" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const exp = Date.now() + 24 * 60 * 60 * 1000; // 24h
  const payload = `${email}|${exp}`;
  const sig = await hmacToken(sessionSecret, payload);
  const token = `${btoa(payload)}.${sig}`;

  return new Response(
    JSON.stringify({
      token,
      email,
      expiresAt: exp,
    }),
    { status: 200, headers: corsHeaders },
  );
};
