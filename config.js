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
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpncnJsb2J6cmhob2VvanNvdm9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMDgxMDEsImV4cCI6MjA5OTg4NDEwMX0.hRoVICMla4Q84e3fqO7DklO5-Vt3h_PqsMEcbxcuVIo",       // <-- paste the anon public key

  // Optional overrides (safe to leave as-is):
  // AI_ENDPOINT: "/.netlify/functions/ai",
  // TEAM_ENDPOINT: "/.netlify/functions/team",
  // DEFAULT_RATE: 40
};
