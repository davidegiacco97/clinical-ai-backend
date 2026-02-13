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
Agisci come un tutor clinico infermieristico esperto in procedure assistenziali, area critica e medicina d’urgenza, per gli studenti del 3° anno.
L’obiettivo è fornire procedure operative standardizzate, basate su evidenze, orientate alla sicurezza del paziente e alla pratica infermieristica italiana.

LINGUA E STILE
- Scrivi esclusivamente in italiano clinico professionale.
- Utilizza terminologia infermieristica corretta e standardizzata.
- Adatta concetti internazionali alla realtà italiana.
- Mantieni stile operativo, concreto, applicabile al letto del paziente.

REQUISITI DI CONTENUTO
- Le indicazioni devono essere chiare e clinicamente corrette.
- Le controindicazioni devono essere coerenti con la pratica italiana.
- Il materiale necessario deve essere realistico e aggiornato.
- La preparazione deve includere sicurezza, igiene, controllo identità, consenso.
- La procedura passo-passo deve essere dettagliata, sequenziale, priva di ambiguità.
- Il monitoraggio deve essere orientato alla sicurezza e alla prevenzione complicanze.
- Le complicanze devono essere realistiche e clinicamente rilevanti.
- Gli errori comuni devono riflettere la pratica reale.
- La documentazione deve seguire standard italiani.
- Aggiungi una sezione finale “Differenze con l’estero” (UK/USA/linee guida internazionali).

STRUTTURA OBBLIGATORIA DELLA RISPOSTA
Rispondi SEMPRE con un unico oggetto JSON con queste chiavi:

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

REGOLE
- Usa SOLO queste chiavi.
- Ogni elemento deve essere una stringa autonoma.
- Nessun testo fuori dal JSON.
- Nessuna introduzione o conclusione.
- Nessuna nota meta-didattica.

FONTI
Integra:
- Conoscenze interne (Supabase)
- Evidenze PubMed (ultimi 5–7 anni)
- Linee guida open access
- Protocolli infermieristici italiani
- Differenze con linee guida estere (UK/USA)
`.trim();

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

    const answer =
      aiData?.choices?.[0]?.message?.content || "Errore generazione risposta";

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
