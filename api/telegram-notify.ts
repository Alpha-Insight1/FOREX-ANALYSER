export const config = { runtime: "edge" };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

interface NotifyBody {
  pair?: string;
  direction?: string;
  confidence?: number;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  text?: string;
  /** Optional override chat id for testing */
  chatId?: string;
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

  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const defaultChat = process.env.TELEGRAM_CHAT_ID || "";

  if (!token) {
    return new Response(
      JSON.stringify({
        error: "Telegram is not configured. Set TELEGRAM_BOT_TOKEN on Vercel.",
      }),
      { status: 503, headers: corsHeaders },
    );
  }

  let body: NotifyBody = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const chatId = String(body.chatId || defaultChat).trim();
  if (!chatId) {
    return new Response(
      JSON.stringify({
        error: "Missing chat id. Set TELEGRAM_CHAT_ID or pass chatId in the body.",
      }),
      { status: 400, headers: corsHeaders },
    );
  }

  let text = body.text?.trim();
  if (!text) {
    const dir = body.direction || "?";
    const pair = body.pair || "?";
    const conf = body.confidence != null ? `${body.confidence}%` : "—";
    text = [
      `🚨 *TRADE TAKEN*`,
      `*${dir}* \`${pair}\` · ${conf}`,
      ``,
      `Entry: \`${body.entry ?? "—"}\``,
      `SL: \`${body.stopLoss ?? "—"}\``,
      `TP: \`${body.takeProfit ?? "—"}\``,
      ``,
      `_Jaggy Analyser · Created by JAGGY_`,
    ].join("\n");
  }

  const tgUrl = `https://api.telegram.org/bot${token}/sendMessage`;
  const tgRes = await fetch(tgUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });

  const tgJson = await tgRes.json().catch(() => ({}));
  if (!tgRes.ok || !tgJson.ok) {
    return new Response(
      JSON.stringify({
        error: "Telegram API error",
        detail: tgJson.description || tgJson,
      }),
      { status: 502, headers: corsHeaders },
    );
  }

  return new Response(JSON.stringify({ ok: true, messageId: tgJson.result?.message_id }), {
    status: 200,
    headers: corsHeaders,
  });
};
