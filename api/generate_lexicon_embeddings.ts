// generate_lexicon_embeddings.ts
// Deno script per generare embedding del Gold Lexicon

import "https://deno.land/x/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Funzione per generare embedding
async function getEmbedding(text: string): Promise<number[] | null> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });

  if (!res.ok) {
    console.error("Errore embedding:", await res.text());
    return null;
  }

  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

console.log("🔍 Recupero termini dal Gold Lexicon…");

const { data: rows, error } = await supabase
  .from("gold_lexicon")
  .select("id, english, italian");

if (error) {
  console.error("Errore Supabase:", error);
  Deno.exit(1);
}

for (const row of rows) {
  const text = `${row.english} → ${row.italian}`;

  console.log(`🧠 Genero embedding per: ${row.english}`);

  const embedding = await getEmbedding(text);
  if (!embedding) continue;

  const { error: updateError } = await supabase
    .from("gold_lexicon")
    .update({ embedding })
    .eq("id", row.id);

  if (updateError) {
    console.error("Errore aggiornamento:", updateError);
  } else {
    console.log(`✅ Embedding salvato per: ${row.english}`);
  }

  // Rate limit safety
  await new Promise((r) => setTimeout(r, 150));
}

console.log("🎉 Embedding completati!");
