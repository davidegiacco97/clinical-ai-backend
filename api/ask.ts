console.log("ENV CHECK", {
  SUPABASE_URL: !!SUPABASE_URL,
  SERVICE_ROLE: !!SUPABASE_SERVICE_ROLE_KEY,
  OPENAI_KEY: !!OPENAI_API_KEY,
  PUBMED_EMAIL
});

console.log("ENV CHECK:", {
  url: Deno.env.get("SUPABASE_URL"),
  role: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ? "OK" : "MISSING"
});

const { data, error } = await supabase
  .from("document_chunks")
  .select("id")
  .limit(1);

console.log("SUPABASE TEST:", { data, error });
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────
// ENV VARIABLES (Supabase + OpenAI + PubMed)
// ─────────────────────────────────────────────
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const PUBMED_EMAIL = Deno.env.get("PUBMED_EMAIL") || "your@email.com";

// ─────────────────────────────────────────────
// Supabase client
// ─────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────
// SYSTEM PROMPT (CLINICAL TUTOR) – TUO ORIGINALE
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `
Agisci come un tutor clinico infermieristico esperto in area critica e medicina acuta.
Il tuo obiettivo è sviluppare ragionamento clinico, decisionale e critico nello studente
di Infermieristica (livello: 3° anno).

LINGUA E STILE
- Scrivi esclusivamente in italiano clinico professionale.
- Utilizza terminologia infermieristica corretta e standardizzata.
- Evita ibridismi inglese–italiano (es. “management”, “setting”, “trigger” se non tradotti).
- Adatta e rielabora concetti provenienti da fonti in inglese in un italiano chiaro,
  preciso e didatticamente avanzato.

STRUTTURA OBBLIGATORIA DELLA RISPOSTA
Segui SEMPRE e IN QUESTO ORDINE la seguente struttura:

1. Definizione
2. Fisiopatologia (concettuale e clinicamente orientata)
3. Priorità cliniche (minimo 5–6 punti, ciascuno con razionale)
4. Trigger decisionali (formato IF / THEN, orientati all’escalation assistenziale)
5. Gestione infermieristica (minimo 6 punti, operativi e motivati)
6. Errori clinici comuni (espliciti e clinicamente rilevanti)
7. Red flags / Segni di allarme
8. Esempio di ragionamento clinico (scenario → osservazione → decisione → outcome)

USO DELLE FONTI
I materiali forniti rappresentano una base iniziale.
Devi integrarli con conoscenze evidence-based derivate da:

- Linee guida internazionali OPEN ACCESS
- Articoli scientifici indicizzati su PubMed (open access)

CRITERI DI RICERCA PUBMED
Quando integri evidenze scientifiche:
- privilegia linee guida, revisioni sistematiche, consensus statement
- limita la ricerca preferibilmente agli ultimi 5–7 anni
- utilizza termini MeSH pertinenti
- prediligi contenuti rilevanti per la pratica infermieristica e l’area critica
- evita singoli case report o studi non generalizzabili

VINCOLI ETICI E DI COPYRIGHT
- Non copiare né citare testualmente linee guida o articoli.
- Non riportare frasi, paragrafi o raccomandazioni testuali.
- Rielabora, sintetizza e integra i concetti in modo originale e didattico.

TRASPARENZA
Al termine della risposta aggiungi:
- una sezione “Trasparenza delle evidenze” (tipologia di fonti utilizzate)
- una sezione “Approfondimenti” con massimo 3–4 riferimenti open access
  (es. PubMed, linee guida internazionali).
`.trim();

// ─────────────────────────────────────────────
// HELPER: category detection avanzata
// ─────────────────────────────────────────────
function detectCategory(q: string): string {
  const text = q.toLowerCase();

  const map: { category: string; keywords: string[] }[] = [
    { category: "sepsis", keywords: ["sepsi", "septic", "shock settico"] },
    { category: "respiratory", keywords: ["ards", "polmon", "respir", "niv", "cpap", "bipap", "ventilazione", "ega"] },
    { category: "cardiology", keywords: ["scompenso", "insufficienza cardiaca", "shock cardiogeno", "cardiaco"] },
    { category: "wound", keywords: ["lesione da pressione", "decubito", "ulcera", "wound", "piaga"] },
    { category: "neuro", keywords: ["glasgow", "gcs", "neurolog", "delirium", "coscienza"] },
    { category: "peg", keywords: ["peg", "nutrizione enterale", "gastrostomia"] },
    { category: "stoma", keywords: ["stomia", "stomaterapia", "colostomia", "ileostomia"] },
    { category: "ecmo", keywords: ["ecmo", "vv-ecmo", "va-ecmo"] },
    { category: "oral_health", keywords: ["salute orale", "igiene orale", "bocca"] },
    { category: "pain", keywords: ["dolore", "pain", "cpot", "bps", "nrs"] },
    { category: "safety", keywords: ["news2", "early warning", "escalation", "sbar", "sicurezza", "risk management"] },
    { category: "renal", keywords: ["diuresi", "bilancio idrico", "aki", "insufficienza renale"] },
    { category: "nutrition", keywords: ["nutrizione", "malnutrizione", "bmi", "albumina"] },
  ];

  for (const entry of map) {
    if (entry.keywords.some(k => text.includes(k))) {
      return entry.category;
    }
  }

  return "general";
}

// ─────────────────────────────────────────────
// HELPER: filtro “solo definizioni” (già concordato)
// ─────────────────────────────────────────────
function isForbiddenQuery(q: string): boolean {
  const forbiddenPatterns = [
    "come ", "quando ", "perché", "perche", "perchè",
    "cosa devo", "cosa faccio", "cosa fare",
    "meglio", "preferibile", "scelta", "confronto",
    " vs ", "versus",
    "gestire", "gestisco",
    "trattare",
    "dose", "dosaggio",
    "protocollo", "algoritmo",
    "quale ", "qual è", "qual e",
    "differenza", "differenze",
    "se il paziente", "se il pz",
    "se peggiora", "se migliora",
    "cosa succede se"
  ];
  return forbiddenPatterns.some(p => q.includes(p));
}

// ─────────────────────────────────────────────
// HELPER: embedding + RAG con Supabase
// (richiede una funzione RPC tipo "match_document_chunks"
// che restituisca i chunk più simili)
// ─────────────────────────────────────────────
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

  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

async function getRagContext(query: string, category: string): Promise<string> {
  // 1) Provo con embeddings
  const embedding = await getEmbedding(query);
  if (embedding) {
    const { data: matches } = await supabase.rpc("match_document_chunks", {
      query_embedding: embedding,
      match_count: 8,
      filter_category: category === "general" ? null : category,
    });

    if (matches && matches.length > 0) {
      return matches.map((m: any) => m.content).join("\n---\n");
    }
  }

  // 2) Fallback: vecchio metodo per categoria
  const { data: chunks } = await supabase
    .from("document_chunks")
    .select("content")
    .eq("category", category)
    .limit(6);

  return chunks?.map(c => c.content).join("\n---\n") || "";
}

// ─────────────────────────────────────────────
// HELPER: PubMed RAG 2.0 (abstract sintetici)
// ─────────────────────────────────────────────
async function fetchPubMedEvidence(query: string): Promise<string> {
  try {
    const baseTerm = encodeURIComponent(query + " nursing guideline review");
    const esearchUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?` +
      `db=pubmed&term=${baseTerm}&retmode=json&retmax=3&email=${PUBMED_EMAIL}`;

    const esRes = await fetch(esearchUrl);
    const esData = await esRes.json();
    const ids: string[] = esData?.esearchresult?.idlist || [];
    if (!ids.length) return "";

    const idList = ids.join(",");
    const efetchUrl =
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?` +
      `db=pubmed&id=${idList}&rettype=abstract&retmode=text&email=${PUBMED_EMAIL}`;

    const efRes = await fetch(efetchUrl);
    const rawText = await efRes.text();

    // Spezzetto in blocchi (grezzo ma efficace)
    const abstracts = rawText
      .split(/\n\n+/)
      .map(s => s.trim())
      .filter(s => s.length > 100)
      .slice(0, 3);

    if (!abstracts.length) return "";

    const summarized = abstracts
      .map((abs, i) => `Abstract ${i + 1} (sintesi):\n${abs.slice(0, 800)}\n`)
      .join("\n---\n");

    return summarized;
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────
serve(async (req) => {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.query) {
      return new Response(JSON.stringify({ error: "Missing query" }), { status: 400 });
    }

    const query = body.query.trim();
    const q = query.toLowerCase();

    // ─────────────────────────────────────────
    // BLOCCO: solo definizioni cliniche
    // ─────────────────────────────────────────
    if (isForbiddenQuery(q)) {
      return new Response(
        JSON.stringify({
          error:
            "Questa modalità fornisce solo definizioni cliniche strutturate. " +
            "Per domande, confronti o decision-making utilizza la modalità avanzata."
        }),
        { status: 400 }
      );
    }

    // ─────────────────────────────────────────
    // CATEGORY DETECTION (NUOVA)
// ─────────────────────────────────────────
    const category = detectCategory(q);

    // ─────────────────────────────────────────
    // CACHE CHECK (30 DAYS)
// ─────────────────────────────────────────
    const limitDate = new Date(Date.now() - 30 * 86400000).toISOString();

    const { data: cached } = await supabase
      .from("ai_cache")
      .select("response")
      .eq("query_hash", q)
      .gte("created_at", limitDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.response) {
      return new Response(
        JSON.stringify({ source: "cache", category, answer: cached.response }),
        { status: 200 }
      );
    }

    // ─────────────────────────────────────────
    // RAG: DOCUMENT CHUNKS (NUOVO, CON EMBEDDINGS)
// ─────────────────────────────────────────
    const ragContext = await getRagContext(query, category);

    // ─────────────────────────────────────────
    // PUBMED RAG 2.0 (ABSTRACT SINTETICI)
// ─────────────────────────────────────────
    const pubmedEvidence = await fetchPubMedEvidence(query);

    // ─────────────────────────────────────────
    // OPENAI CALL
// ─────────────────────────────────────────
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `
DOMANDA:
${query}

MATERIALE DI BASE (KNOWLEDGE BASE INTERNA):
${ragContext}

EVIDENZE DA PUBMED (ABSTRACT SINTETICI, SOLO PER CONTESTO):
${pubmedEvidence}
`.trim()
          }
        ]
      })
    });

    const aiData = await openaiRes.json();
    const answer = aiData.choices?.[0]?.message?.content || "Errore generazione risposta";

    // ─────────────────────────────────────────
    // SAVE CACHE
// ─────────────────────────────────────────
    await supabase.from("ai_cache").insert({
      query_hash: q,
      category,
      response: answer
    });

    return new Response(
      JSON.stringify({ source: "live", category, answer }),
      { status: 200 }
    );

  } catch (err) {
    console.error("ask_ai error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500 }
    );
  }
});
