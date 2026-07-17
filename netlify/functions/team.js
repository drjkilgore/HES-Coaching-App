// netlify/functions/team.js
// Admin-only: invite coaches/principals and list team members.
//
// Why a function? Inviting users and listing accounts requires Supabase's
// SERVICE ROLE key, which must NEVER be exposed in the browser. This runs
// server-side, verifies the CALLER is a district_admin, then acts.
//
// Netlify env vars required:
//   SUPABASE_URL                = https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   = (Project Settings -> API -> service_role secret)
//   SITE_URL (optional)         = https://your-site.netlify.app  (invite redirect)

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE = process.env.SITE_URL || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (code, obj) => ({ statusCode: code, headers: cors, body: JSON.stringify(obj) });

// service-role REST helpers
const svcHeaders = (extra = {}) => ({
  apikey: SERVICE,
  Authorization: "Bearer " + SERVICE,
  "Content-Type": "application/json",
  ...extra,
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!URL || !SERVICE) return json(500, { error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" });

  // 1) Verify the caller and that they are an admin.
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json(401, { error: "Not signed in" });

  let caller;
  try {
    const r = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: "Bearer " + token } });
    if (!r.ok) return json(401, { error: "Invalid session" });
    caller = await r.json();
  } catch (e) {
    return json(502, { error: "Auth check failed" });
  }
  // look up the caller's role
  let callerRole = "coach";
  try {
    const r = await fetch(`${URL}/rest/v1/profiles?id=eq.${caller.id}&select=role`, { headers: svcHeaders() });
    const rows = await r.json();
    if (Array.isArray(rows) && rows[0]) callerRole = rows[0].role;
  } catch (e) { /* default coach */ }
  if (callerRole !== "district_admin" && callerRole !== "system_admin") {
    return json(403, { error: "Admins only" });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch { /* ignore */ }
  const action = body.action;

  // 2) LIST members
  if (action === "list") {
    try {
      const [uRes, pRes] = await Promise.all([
        fetch(`${URL}/auth/v1/admin/users`, { headers: svcHeaders() }),
        fetch(`${URL}/rest/v1/profiles?select=id,full_name,role`, { headers: svcHeaders() }),
      ]);
      const users = (await uRes.json()).users || [];
      const profs = await pRes.json();
      const pById = {}; (Array.isArray(profs) ? profs : []).forEach((p) => (pById[p.id] = p));
      const members = users.map((u) => ({
        email: u.email,
        full_name: (pById[u.id] && pById[u.id].full_name) || (u.user_metadata && u.user_metadata.full_name) || "—",
        role: (pById[u.id] && pById[u.id].role) || (u.user_metadata && u.user_metadata.role) || "coach",
        status: u.confirmed_at || u.last_sign_in_at ? "active" : "invited",
      }));
      return json(200, { members });
    } catch (e) {
      return json(502, { error: "Could not list members" });
    }
  }

  // 3) INVITE a member
  if (action === "invite") {
    const { name, email, role = "coach", contracts = [] } = body;
    if (!email || !name) return json(400, { error: "Name and email required" });
    try {
      const inv = await fetch(`${URL}/auth/v1/invite${SITE ? `?redirect_to=${encodeURIComponent(SITE)}` : ""}`, {
        method: "POST",
        headers: svcHeaders(),
        body: JSON.stringify({ email, data: { full_name: name, role } }),
      });
      const invData = await inv.json();
      if (!inv.ok) return json(inv.status, { error: invData.msg || invData.error_description || "Invite failed (user may already exist)" });

      const userId = invData.id;
      // upsert the profile row so role/name are authoritative
      await fetch(`${URL}/rest/v1/profiles`, {
        method: "POST",
        headers: svcHeaders({ Prefer: "resolution=merge-duplicates" }),
        body: JSON.stringify({ id: userId, full_name: name, role }),
      });
      // optional: contracts (schools + hours) for coaches
      if (Array.isArray(contracts) && contracts.length && userId) {
        const rows = contracts
          .filter((c) => c.school_id)
          .map((c) => ({ coach_id: userId, school_id: c.school_id, contracted_hours: c.hours || 0, hourly_rate: c.rate || 40 }));
        if (rows.length) {
          await fetch(`${URL}/rest/v1/coach_school_contracts`, {
            method: "POST",
            headers: svcHeaders({ Prefer: "resolution=ignore-duplicates" }),
            body: JSON.stringify(rows),
          });
        }
      }
      return json(200, { ok: true, id: userId, email });
    } catch (e) {
      return json(502, { error: "Invite failed: " + String(e) });
    }
  }

  return json(400, { error: "Unknown action" });
};
