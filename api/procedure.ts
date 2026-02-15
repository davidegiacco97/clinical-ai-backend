import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// ─────────────────────────────────────────────
// ENV
// ─────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const PUBMED_EMAIL = process.env.PUBMED_EMAIL || "your@email.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────
// SYSTEM PROMPT — PROCEDURE
// ─────────────────────────────────────────────
const PROCEDURE_SYSTEM_PROMPT = `
Agisci come un tutor clinico infermieristico esperto in procedure assistenziali, area critica e medicina d’urgenza, per studenti del 3° anno.

OBIETTIVO  
Fornire una procedura operativa standardizzata, sicura, aderente alla pratica infermieristica italiana.
Se la procedura è medica (es. intubazione, CVC ecc) spiegare la parte dell'assistenza infermieristica.

VINCOLO ASSOLUTO DI PERTINENZA  
La procedura DEVE riferirsi ESCLUSIVAMENTE alla richiesta dell’utente.

- Non reinterpretare.
- Non ampliare.
- Non sostituire con procedure simili.
- Non cambiare specialità.
- Non proporre varianti di altri ambiti.

Se l’utente scrive:
"EGA" → è emogasanalisi arteriosa.
"CVP" → è catetere venoso periferico.
"NIV" → ventilazione non invasiva.
"PVC" → Pressione venosa centrale
ecc.

Se non sei sicuro del significato, usa il significato più comune nella pratica infermieristica italiana.

È proibito cambiare procedura.

LINGUA E STILE
- Italiano clinico professionale.
- Terminologia infermieristica italiana.
- Niente inglesismi se non universalmente accettati.
- Stile operativo, pratico, da reparto.

USO DEL GOLD LEXICON (VOCABOLARIO OBBLIGATORIO)
- Usa SEMPRE i termini italiani presenti nel Gold Lexicon fornito.
- Non usare sinonimi, inglesismi o traduzioni alternative.
- Se un termine inglese è presente nel Gold Lexicon, utilizza esclusivamente la sua forma italiana associata.
- Mantieni coerenza terminologica in tutta la risposta.

CONTESTO ITALIANO PRIORITARIO
Prima:
- protocolli italiani
- organizzazione ospedaliera italiana
- responsabilità infermieristiche italiane

Solo alla fine puoi citare differenze estere.

REQUISITI DI CONTENUTO
Le informazioni devono essere:
- realistiche
- applicabili
- usabili in reparto
- coerenti con competenze infermieristiche

Evita materiale medico esclusivo.

NON INVENTARE ATTREZZATURE, FARMACI O PROTOCOLLI.

Se un dato non è certo → usa formulazione prudente e generica.

STRUTTURA OBBLIGATORIA  
Rispondi SOLO con JSON:

{
  "indications": [],
  "contraindications": [],
  "materials": [],
  "preparation": [],
  "steps": [],
  "monitoring": [],
  "complications": [],
  "commonErrors": [],
  "documentation": [],
  "sources": [],
  "internationalDifferences": []
}

REGOLE DI OUTPUT
- Solo JSON.
- Nessun testo prima o dopo.
- Nessuna spiegazione.
- Nessuna introduzione.
- Nessuna conclusione.

FONTI
Integra e armonizza:
- base Supabase
- letteratura PubMed ultimi 5–7 anni
- linee guida open access
- protocolli italiani

Le differenze estere vanno messe SOLO nella chiave internationalDifferences.

`.trim();

// ─────────────────────────────────────────────
// HELPER: filtro richieste NON procedurali
// ─────────────────────────────────────────────
function isForbiddenProcedureQuery(q: string): boolean {
  const forbiddenPatterns = [
    // Domande teoriche / spiegazioni
    "cos'è", "cos e", "cos è", "cosa è", "cosa significa",
    "spiegami", "perché", "perche", "perchè",
    "per quale motivo", "come funziona",

    // Diagnosi / clinica
    "diagnosi", "diagnosticare", "diagnostica",
    "sintomi", "segni", "terapia",
    "prognosi", "decorso",

    // Decision making
    "cosa devo", "cosa faccio", "cosa fare",
    "se il paziente", "se il pz",
    "se peggiora", "se migliora",
    "cosa succede se",

    // Confronti
    "meglio", "peggio", "preferibile",
    "differenza", "differenze",
    "confronto", "vs", "versus",

    // Farmaci
    "farmaco", "farmaci", "dose", "dosaggio", "posologia",

    // Protocolli medici
    "protocollo medico", "linee guida", "algoritmo",

    // Richieste non procedurali
    "cos'è un", "cos'è una",
    "che cos'è", "che cosa è",
    "definizione", "spiegazione",

    // Richieste generiche
    "qual è", "quale ", "qual e",
  ];

  return forbiddenPatterns.some(p => q.toLowerCase().includes(p));
}

// ─────────────────────────────────────────────
// EMBEDDING
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
// COSINE SIMILARITY
// ─────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const normB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  if (!normA || !normB) return 0;
  return dot / (normA * normB);
}

// ─────────────────────────────────────────────
// RAG — PROCEDURE
// ─────────────────────────────────────────────
async function getProcedureRag(query: string, category: string): Promise<string> {
  const embedding = await getEmbedding(query);

  if (embedding) {
    const { data, error } = await supabase
      .from("procedures_knowledge_base")
      .select("id, content, category, embedding")
      .not("embedding", "is", null);

    if (error || !data) return "";

    const filtered = category === "general"
      ? data
      : data.filter((row: any) => row.category === category);

    const scored = filtered.map((row: any) => ({
      ...row,
      score: cosineSimilarity(embedding, row.embedding as number[])
    }));

    const top = scored.sort((a, b) => b.score - a.score).slice(0, 8);

    if (top.length > 0) {
      const ids = top.map((t: any) => t.id);
      let sourcesBlock = "";

      const { data: mapRows } = await supabase
        .from("procedures_evidence_map")
        .select("knowledge_id, source_id")
        .in("knowledge_id", ids);

      if (mapRows && mapRows.length > 0) {
        const sourceIds = Array.from(new Set(mapRows.map((m: any) => m.source_id)));
        const { data: sources } = await supabase
          .from("procedures_sources")
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

  return "";
}

// ─────────────────────────────────────────────
// PUBMED
// ─────────────────────────────────────────────
async function fetchPubMedEvidence(query: string): Promise<string> {
  try {
    const baseTerm = encodeURIComponent(query + " nursing procedure guideline review");
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
// MAIN HANDLER
// ─────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body as any;

    const userId = body.userId;
    const userEmailRaw = body.userEmail;

    if (!userId) return res.status(400).json({ error: "Missing userId" });
    if (!userEmailRaw) return res.status(400).json({ error: "Missing userEmail" });

    const userEmail = String(userEmailRaw).toLowerCase();

// ─────────────────────────────────────────────
// REGISTRAZIONE / AGGIORNAMENTO UTENTE IN custom_users
// ─────────────────────────────────────────────
await supabase
  .from("custom_users")
  .upsert({
    id: userId,
    email: userEmail,
    last_seen: new Date().toISOString()
  });
    
    // WHITELIST
    const { data: allowed } = await supabase
      .from("allowed_emails")
      .select("email")
      .eq("email", userEmail)
      .maybeSingle();

    if (!allowed) {
      return res.status(403).json({
        error: "Accesso riservato. La tua email non è autorizzata al beta."
      });
    }

    // USAGE
    const { data: usageRow } = await supabase
      .from("api_usage")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const now = new Date();

    if (!usageRow) {
      await supabase.from("api_usage").insert({
        user_id: userId,
        period_start: now.toISOString(),
        last_reset_at: now.toISOString(),
        count: 1
      });
    } else {
      const lastReset = new Date(usageRow.last_reset_at || usageRow.period_start);
      const diffDays = (now.getTime() - lastReset.getTime()) / 86400000;

      if (diffDays > 30) {
        await supabase
          .from("api_usage")
          .update({
            period_start: now.toISOString(),
            last_reset_at: now.toISOString(),
            count: 1
          })
          .eq("user_id", userId);
      } else {
        if (usageRow.count >= 45) {
          return res.status(429).json({
            error: "Hai raggiunto il limite di 45 richieste per il ciclo di 30 giorni."
          });
        }

        await supabase
          .from("api_usage")
          .update({ count: usageRow.count + 1 })
          .eq("user_id", userId);
      }
    }

if (!body?.query) {
  return res.status(400).json({ error: "Missing query" });
}

const query = String(body.query).trim();
const q = query.toLowerCase();

if (isForbiddenQuery(q)) {
  return res.status(400).json({
    error:
      "Questa modalità fornisce solo procedure infermieristiche strutturate. " +
      "Per domande, confronti o decision-making utilizza la modalità avanzata."
  });
}

    const category = body.category || "general";

    // CACHE
    const limitDate = new Date(Date.now() - 30 * 86400000).toISOString();

    const { data: cached } = await supabase
      .from("procedures_cache")
      .select("response")
      .eq("query_hash", q)
      .gte("created_at", limitDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.response) {
      return res.status(200).json({
        source: "cache",
        category,
        answer: cached.response
      });
    }

    // RAG
    const ragContext = await getProcedureRag(query, category);

    // PUBMED
    const pubmedEvidence = await fetchPubMedEvidence(query);

// ─────────────────────────────────────────────
// RAG TERMINOLOGICO — GOLD LEXICON
// ─────────────────────────────────────────────
async function getLexiconTerms(category: string) {
  const { data, error } = await supabase
    .from("gold_lexicon")
    .select("english, italian, embedding");

  if (error || !data) return [];

  const queryEmbedding = await getEmbedding(category);
  if (!queryEmbedding) return [];

  const scored = data.map((row) => ({
    ...row,
    score: cosineSimilarity(queryEmbedding, row.embedding || []),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((t) => `- "${t.english}" → "${t.italian}"`);
}

const lexiconTerms = await getLexiconTerms(category);

const lexiconBlock = lexiconTerms.length
  ? "\n\nVOCABOLARIO OBBLIGATORIO (GOLD LEXICON):\n" + lexiconTerms.join("\n")
  : "";
    
    // OPENAI
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
          { role: "system", content: PROCEDURE_SYSTEM_PROMPT },
          {
            role: "user",
            content: `
PROCEDURA:
${query}

CONOSCENZE INTERNE:
${ragContext}

EVIDENZE PUBMED (ultimi 5–7 anni):
${pubmedEvidence}
`.trim()
          }
        ]
      })
    });

const raw = await openaiRes.text();
console.log("OPENAI RAW PROCEDURE:", raw);

let aiData;
try {
  aiData = JSON.parse(raw);
} catch (e) {
  console.error("JSON PARSE ERROR:", e);
  return res.status(500).json({ error: "Invalid JSON from OpenAI", raw });
}

let answer = aiData?.choices?.[0]?.message?.content || "";

// Ora dobbiamo verificare che answer sia un JSON valido
let parsed;
try {
  parsed = JSON.parse(answer);
} catch (e) {
  console.error("PROCEDURE JSON INVALIDO:", answer);
  return res.status(500).json({
    error: "Invalid procedure JSON from OpenAI",
    raw: answer
  });
}

// Se parsed è valido, lo salviamo e lo restituiamo
answer = JSON.stringify(parsed);

    await supabase.from("procedures_cache").insert({
      query_hash: q,
      category,
      response: answer
    });

    return res.status(200).json({ source: "live", category, answer });

  } catch (err) {
    console.error("procedure.ts error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
