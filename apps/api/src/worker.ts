import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { runSearch } from "./search.js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const userId = process.env.SUPABASE_USER_ID;
if (!url || !serviceKey || !userId) {
  console.error("Scheduled search needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_USER_ID.");
  process.exitCode = 1;
} else {
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const result = await runSearch(client, userId, { trigger: "scheduled" });
  console.log(JSON.stringify(result));
  if (result.status === "FAILED") process.exitCode = 1;
}
