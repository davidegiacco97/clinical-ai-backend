import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────
// ENV VARIABLES (Supabase + OpenAI + PubMed)
// ─────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const PUBMED_EMAIL = process.env.PUBMED_EMAIL || "your@email.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log("ENV CHECK:", {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_ROLE_KEY ? "OK" : "MISSING",
  OPENAI_API_KEY: OPENAI_API_KEY ? "OK" : "MISSING",
  PUBMED_EMAIL
});

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
  
  ⚠️ REGOLE ASSOLUTE
- Rispondi SOLO in formato JSON valido.
- NON aggiungere testo fuori dal JSON.
- NON inserire commenti, note, spiegazioni sul processo.
- NON usare anglicismi, ibridismi o termini impropri.
- NON includere frasi meta-didattiche come “minimo X punti”, “concettuale e clinicamente orientata”, “operativi e motivati”.
- NON proporre servizi aggiuntivi o frasi come “se vuoi posso…”.
- NON includere sezioni extra come “trasparenza delle evidenze”, “approfondimenti”, “trasformazione finale delle evidenze”.
- Il linguaggio deve essere italiano clinico formale, scorrevole e coerente.
NON includere mai nelle risposte:
- istruzioni tra parentesi come “(minimo X punti)”, “(concettuale e clinicamente orientata)”, “(operativi e motivati)”
- note meta-didattiche
- spiegazioni sul processo
- frasi come “se vuoi posso…”, “potrei anche…”, “approfondimenti”, “trasparenza delle evidenze”
- anglicismi o ibridismi

Le sezioni devono essere scritte in italiano clinico formale, senza parentesi descrittive o commenti.
Produci comunque il numero corretto di punti richiesti, ma senza dichiararlo.


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

⚠️ FORMATO DI OUTPUT
- Nessun testo fuori dal JSON.
- Nessuna spiegazione.
- Nessuna introduzione.
- Nessuna conclusione.
- Nessuna frase motivazionale.
- Nessuna offerta di aiuto aggiuntivo.

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
// HELPER: embedding (OpenAI)
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

// ─────────────────────────────────────────────
// HELPER: cosine similarity (per RAG senza RPC)
// ─────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  if (!normA || !normB) return 0;
  return dot / (normA * normB);
}

// ─────────────────────────────────────────────
// HELPER: RAG con clinical_knowledge_base + map/fonti
// ─────────────────────────────────────────────
async function getRagContext(query: string, category: string): Promise<string> {
  const embedding = await getEmbedding(query);

  // 1) Nuovo metodo: embeddings su clinical_knowledge_base
  if (embedding) {
    const { data, error } = await supabase
      .from("clinical_knowledge_base")
      .select("id, content, category, embedding")
      .not("embedding", "is", null);

    if (error || !data) {
      console.error("clinical_knowledge_base error:", error);
    } else {
      const filtered = category === "general"
        ? data
        : data.filter((row: any) => row.category === category);

      const scored = filtered.map((row: any) => ({
        ...row,
        score: cosineSimilarity(embedding, row.embedding as number[])
      }));

      const top = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      if (top.length > 0) {
        // opzionale: recupero fonti collegate via evidence_map / evidence_sources
        const ids = top.map((t: any) => t.id);
        let sourcesBlock = "";

        const { data: mapRows } = await supabase
          .from("evidence_map")
          .select("knowledge_id, source_id")
          .in("knowledge_id", ids);

        if (mapRows && mapRows.length > 0) {
          const sourceIds = Array.from(new Set(mapRows.map((m: any) => m.source_id)));
          const { data: sources } = await supabase
            .from("evidence_sources")
            .select("id, title, citation, url")
            .in("id", sourceIds);

          if (sources && sources.length > 0) {
            sourcesBlock =
              "\n\n--- FONTI INTERNE COLLEGATE ---\n" +
              sources
                .map((s: any) => `• ${s.title || "Senza titolo"} – ${s.citation || ""} ${s.url || ""}`)
                .join("\n");
          }
        }

        const contentBlock = top.map((m: any) => m.content).join("\n---\n");
        return contentBlock + sourcesBlock;
      }
    }
  }

  // 2) Fallback: vecchio metodo per categoria (senza embeddings)
  const { data: chunks } = await supabase
    .from("clinical_knowledge_base")
    .select("content")
    .eq("category", category)
    .limit(6);

  return chunks?.map((c: any) => c.content).join("\n---\n") || "";
}

// ─────────────────────────────────────────────
// HELPER: PubMed RAG 2.0 (abstract sintetici, SEMPRE)
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
// MAIN HANDLER (versione Vercel, non Deno serve)
// ─────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
 // CORS
res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");

// Preflight
if (req.method === "OPTIONS") {
  return res.status(200).end();
}
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body as any;
    if (!body?.query) {
      return res.status(400).json({ error: "Missing query" });
    }

    const query = String(body.query).trim();
    const q = query.toLowerCase();

    // BLOCCO: solo definizioni cliniche
    if (isForbiddenQuery(q)) {
      return res.status(400).json({
        error:
          "Questa modalità fornisce solo definizioni cliniche strutturate. " +
          "Per domande, confronti o decision-making utilizza la modalità avanzata."
      });
    }

    // CATEGORY DETECTION
    const category = detectCategory(q);

    // CACHE CHECK (30 DAYS)
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
      return res.status(200).json({ source: "cache", category, answer: cached.response });
    }

    // RAG: clinical_knowledge_base
    const ragContext = await getRagContext(query, category);

    // PUBMED RAG 2.0
    const pubmedEvidence = await fetchPubMedEvidence(query);

    // OPENAI CALL
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        temperature: 1,
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

    // RAW RESPONSE
    const raw = await openaiRes.text();
    console.log("OPENAI RAW RESPONSE:", raw);

    // PARSE JSON
    let aiData;
    try {
      aiData = JSON.parse(raw);
    } catch (e) {
      console.error("JSON PARSE ERROR:", e);
      return res.status(500).json({ error: "Invalid JSON from OpenAI", raw });
    }

// EXTRACT CONTENT
const content =
  aiData?.choices?.[0]?.message?.content || "{}";

// Il modello restituisce JSON → lo trasformiamo in oggetto vero
let parsed;
try {
  parsed = JSON.parse(content);
} catch (e) {
  console.error("MODEL JSON ERROR:", e);
  return res.status(500).json({ error: "Model did not return valid JSON", raw: content });
}

// SAVE CACHE (salviamo sempre il JSON stringa)
await supabase.from("ai_cache").insert({
  query_hash: q,
  category,
  response: content
});

// RETURN STRUTTURATO
return res.status(200).json({
  source: "live",
  category,
  concept: query,
  ...parsed
});

