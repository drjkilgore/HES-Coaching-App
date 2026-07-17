// config.js — YOUR settings. Set this ONCE.
// This file is NOT overwritten when you update index.html, so your keys stay put.
//
// Get both values from Supabase → Project Settings → API:
//   • Project URL      → SUPABASE_URL
//   • anon public key  → SUPABASE_ANON_KEY   (safe to be public; RLS protects your data)
// Do NOT put the service_role key here — that stays in Netlify env vars only.
//
// Leaving SUPABASE_URL or SUPABASE_ANON_KEY blank = the app runs in demo mode.

window.HCP_CONFIG = {
  SUPABASE_URL: "https://jgrrlobzrhhoeojsovof.supabase.co",   // your project URL
  SUPABASE_ANON_KEY: "PASTE_YOUR_ANON_PUBLIC_KEY_HERE",       // <-- paste the anon public key

  // Optional overrides (safe to leave as-is):
  // AI_ENDPOINT: "/.netlify/functions/ai",
  // TEAM_ENDPOINT: "/.netlify/functions/team",
  // DEFAULT_RATE: 40
};
