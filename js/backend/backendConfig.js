/**
 * backend/backendConfig.js — Supabase connection settings.
 *
 * Paste your project's values here (see SETUP.md, step 4):
 *   - Project URL:        Supabase dashboard → Settings → Data API
 *   - Publishable key:    Supabase dashboard → Settings → API Keys
 *
 * The publishable (anon) key is DESIGNED to ship in browser code — every
 * Supabase app exposes it. Security comes from Row Level Security in the
 * database (see supabase/schema.sql), NOT from hiding this key.
 *
 * NEVER put the service_role / secret key anywhere in this project.
 *
 * Until real values are set, the game runs in fully local mode and the
 * account screen explains what to do.
 */
export const SUPABASE_URL = 'https://ptbxwtkrncyesvrplzda.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFremRsbG1mZG50bnBqY3l3a3NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMTk4NTIsImV4cCI6MjA5OTY5NTg1Mn0.7p_7sKIZRquFXddu0YuDxP7jmE5eNVOntsh4dQAYF9U';
