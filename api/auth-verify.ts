export const config = { runtime: "edge" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export default async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const accessCode = process.env.APP_ACCESS_CODE || "";
  const sessionSecret = process.env.APP_SESSION_SECRET || accessCode || "jaggy-dev-secret-change-me";

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || !token.includes(".")) {
    return new Response(JSON.stringify({ valid: false }), { status: 401, headers: corsHeaders });
  }

  try {
    const [payloadB64, sig] = token.split(".");
    const payload = atob(payloadB64);
    const expected = await hmacToken(sessionSecret, payload);
    if (!timingSafeEqual(sig, expected)) {
      return new Response(JSON.stringify({ valid: false }), { status: 401, headers: corsHeaders });
    }
    const [email, expStr] = payload.split("|");
    const exp = Number(expStr);
    if (!exp || Date.now() > exp) {
      return new Response(JSON.stringify({ valid: false, reason: "expired" }), {
        status: 401,
        headers: corsHeaders,
      });
    }
    return new Response(JSON.stringify({ valid: true, email, expiresAt: exp }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ valid: false }), { status: 401, headers: corsHeaders });
  }
};
