import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";

export interface AuthenticatedRequest extends Request {
  userId: string;
  supabase: SupabaseClient;
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export function requestSupabaseClient(accessToken: string): SupabaseClient {
  const config = getSupabaseConfig();
  if (!config) throw new Error("Supabase API configuration is missing.");
  return createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match?.[1]) {
    res.status(401).json({ error: "Sign in to access your profile, offers, and CVs." });
    return;
  }
  if (!getSupabaseConfig()) {
    res.status(503).json({ error: "Supabase is not configured. Add the URL and publishable key to .env." });
    return;
  }

  try {
    const client = requestSupabaseClient(match[1]);
    const { data, error } = await client.auth.getUser(match[1]);
    if (error || !data.user) {
      res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
      return;
    }
    const authenticatedRequest = req as AuthenticatedRequest;
    authenticatedRequest.userId = data.user.id;
    authenticatedRequest.supabase = client;
    next();
  } catch (error) {
    next(error);
  }
}
