// Configuration template - copy this to config.js and fill in your Supabase credentials
// config.js is gitignored, so your credentials won't be committed

const CONFIG = {
    // Supabase project URL
    supabaseUrl: 'https://your-project.supabase.co',

    // Supabase anon key (public, safe to expose in client-side code)
    supabaseAnonKey: 'your-anon-key-here',

    // Auth settings
    auth: {
        provider: 'google' // or 'email'
    }
};
