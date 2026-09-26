module.exports = (request, response) => {
  const config = {
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
    storageApiBaseUrl: process.env.STORAGE_API_BASE_URL || "",
  };

  response.setHeader("Content-Type", "application/javascript; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.status(200).send(`window.MESIMI_CONFIG = ${JSON.stringify(config)};`);
};
