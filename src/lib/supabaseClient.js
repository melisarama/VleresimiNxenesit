const appConfig = window.MESIMI_CONFIG || {};

export const supabaseUrl = appConfig.supabaseUrl;
export const supabasePublishableKey = appConfig.supabasePublishableKey;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Supabase configuration is missing. Create .env for local development or provide src/config.js in static hosting.');
}

if (!window.supabase || typeof window.supabase.createClient !== 'function') {
  throw new Error('Supabase browser client failed to load. Run npm install and make sure public/vendor/supabase-js/supabase.js is available.');
}

export const supabaseClient = window.supabase.createClient(supabaseUrl, supabasePublishableKey);
