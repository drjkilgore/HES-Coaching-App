// netlify/functions/pay.js
// Coach payouts via Stripe Connect (Express). Admin-gated money movement.
//
// Netlify env vars required:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (verify caller + write payout records)
//   STRIPE_SECRET_KEY                          (test: sk_test_...  live: sk_live_...)
//   SITE_URL (optional)                        (return URL after Stripe onboarding)
//
// Actions (POST { action, ... }):
//   onboard : signed-in coach connects a bank -> returns a Stripe onboarding URL
//   status  : payout-readiness for the caller (or {coach_id} if admin)
//   pay     : ADMIN pays an approved period to a coach (creates a Stripe transfer)

const SB_URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE = process.env.STRIPE_SECRET_KEY;
const SITE = process.env.SITE_URL || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (code, obj) => ({ statusCode: code, headers: cors, body: JSON.stringify(obj) });
const svc = (extra = {}) => ({ apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json", ...extra });

// Stripe uses form-encoding; flatten nested keys like capabilities[transfers][requested].
function form(obj, prefix, out) {
  out = out || new URLSearchParams();
  for (const k in obj) {
    const key = prefix ? `${prefix}[${k}]` : k;
    const v = obj[k];
    if (v && typeof v === "object" && !Array.isArray(v)) form(v, key, out);
    else if (v !== undefined && v !== null) out.append(key, String(v));
  }
  return out;
}
async function stripe(path, params, idempotencyKey) {
  const headers = { Authorization: "Bearer " + STRIPE, "Content-Type": "application/x-www-form-urlencoded" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const r = await fetch("https://api.stripe.com/v1/" + path, {
    method: params ? "POST" : "GET",
    headers,
    body: params ? form(params).toString() : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data.error && data.error.message) || "Stripe error");
  return data;
}
async function getProfile(id) {
  const r = await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}&select=id,full_name,role,stripe_account_id,payouts_enabled`, { headers: svc() });
  const rows = await r.json();
  return Array.isArray(rows) ? rows[0] : null;
}
async function patchProfile(id, patch) {
  await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", headers: svc({ Prefer: "return=minimal" }), body: JSON.stringify(patch) });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!SB_URL || !SERVICE) return json(500, { error: "Supabase env vars not set" });
  if (!STRIPE) return json(500, { error: "STRIPE_SECRET_KEY not set" });

  // verify caller
  const token = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Not signed in" });
  let caller;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: "Bearer " + token } });
    if (!r.ok) return json(401, { error: "Invalid session" });
    caller = await r.json();
  } catch { return json(502, { error: "Auth check failed" }); }
  const callerProfile = await getProfile(caller.id);
  const isAdmin = callerProfile && (callerProfile.role === "district_admin" || callerProfile.role === "system_admin");

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}
  const action = body.action;
  const origin = body.return_url || SITE || "";

  // ---- ONBOARD: caller connects their own payout account ----
  if (action === "onboard") {
    try {
      let acct = callerProfile && callerProfile.stripe_account_id;
      if (!acct) {
        const created = await stripe("accounts", {
          type: "express",
          country: "US",
          email: caller.email,
          capabilities: { transfers: { requested: true } },
          business_type: "individual",
          metadata: { app_user_id: caller.id },
        });
        acct = created.id;
        await patchProfile(caller.id, { stripe_account_id: acct });
      }
      const link = await stripe("account_links", {
        account: acct,
        refresh_url: origin || "https://example.com",
        return_url: origin || "https://example.com",
        type: "account_onboarding",
      });
      return json(200, { url: link.url });
    } catch (e) { return json(502, { error: String(e.message || e) }); }
  }

  // ---- STATUS: payout readiness (self, or a coach if admin) ----
  if (action === "status") {
    try {
      const targetId = (isAdmin && body.coach_id) ? body.coach_id : caller.id;
      const prof = await getProfile(targetId);
      if (!prof || !prof.stripe_account_id) return json(200, { connected: false, payouts_enabled: false });
      const acct = await stripe("accounts/" + prof.stripe_account_id);
      const enabled = !!acct.payouts_enabled;
      if (enabled !== prof.payouts_enabled) await patchProfile(targetId, { payouts_enabled: enabled });
      return json(200, { connected: true, payouts_enabled: enabled, details_submitted: !!acct.details_submitted });
    } catch (e) { return json(502, { error: String(e.message || e) }); }
  }

  // ---- PAY: admin pays a coach for an approved period ----
  if (action === "pay") {
    if (!isAdmin) return json(403, { error: "Admins only" });
    const { coach_id, amount_cents, hours, rate, period_label } = body;
    if (!coach_id || !amount_cents || !period_label) return json(400, { error: "Missing coach, amount, or period" });
    if (amount_cents <= 0) return json(400, { error: "Amount must be positive" });

    const coach = await getProfile(coach_id);
    if (!coach || !coach.stripe_account_id) return json(400, { error: "Coach hasn't connected a payout account" });
    if (!coach.payouts_enabled) return json(400, { error: "Coach's payout account isn't fully set up yet" });

    // idempotency: DB unique(coach_id, period_label) blocks duplicates; check first for a clean message
    const dup = await fetch(`${SB_URL}/rest/v1/payouts?coach_id=eq.${coach_id}&period_label=eq.${encodeURIComponent(period_label)}&select=id,status`, { headers: svc() });
    const existing = await dup.json();
    if (Array.isArray(existing) && existing.length && existing[0].status === "paid") {
      return json(409, { error: "This period was already paid to this coach" });
    }

    try {
      const transfer = await stripe(
        "transfers",
        { amount: amount_cents, currency: "usd", destination: coach.stripe_account_id, metadata: { period: period_label, coach: coach_id } },
        `payout:${coach_id}:${period_label}` // Stripe idempotency key
      );
      await fetch(`${SB_URL}/rest/v1/payouts`, {
        method: "POST",
        headers: svc({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify({
          coach_id, period_label, hours, rate, amount_cents,
          status: "paid", provider: "stripe", stripe_transfer_id: transfer.id, created_by: caller.id,
        }),
      });
      return json(200, { ok: true, transfer_id: transfer.id });
    } catch (e) {
      await fetch(`${SB_URL}/rest/v1/payouts`, {
        method: "POST",
        headers: svc({ Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify({ coach_id, period_label, hours, rate, amount_cents, status: "failed", error: String(e.message || e), created_by: caller.id }),
      });
      return json(502, { error: String(e.message || e) });
    }
  }

  return json(400, { error: "Unknown action" });
};
