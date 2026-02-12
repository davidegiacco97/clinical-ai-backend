import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { userId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  const { data: usageRow } = await supabase
    .from("api_usage")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const limit = 45;
  const now = new Date();

  if (!usageRow) {
    const cycleEnd = new Date(now.getTime() + 30 * 86400000);

    await supabase.from("api_usage").insert({
      user_id: userId,
      period_start: now.toISOString(),
      last_reset_at: now.toISOString(),
      count: 0
    });

    return res.status(200).json({
      count: 0,
      limit,
      remaining: limit,
      cycle_end: cycleEnd.toISOString()
    });
  }

  const lastReset = new Date(usageRow.last_reset_at || usageRow.period_start);
  const diffDays = (now.getTime() - lastReset.getTime()) / 86400000;

  if (diffDays > 30) {
    const cycleEnd = new Date(now.getTime() + 30 * 86400000);

    await supabase
      .from("api_usage")
      .update({
        period_start: now.toISOString(),
        last_reset_at: now.toISOString(),
        count: 0
      })
      .eq("user_id", userId);

    return res.status(200).json({
      count: 0,
      limit,
      remaining: limit,
      cycle_end: cycleEnd.toISOString()
    });
  }

  const cycleEnd = new Date(lastReset.getTime() + 30 * 86400000);

  const count = usageRow.count || 0;

  return res.status(200).json({
    count,
    limit,
    remaining: Math.max(0, limit - count),
    cycle_end: cycleEnd.toISOString()
  });
}
