import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const PUBMED_EMAIL = process.env.PUBMED_EMAIL || "your@email.com";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────
// SYSTEM PROMPT – SIMULATORE CLINICO ADATTIVO
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `
Sei un simulatore clinico infermieristico ad alta fedeltà.

Il tuo compito è creare una esperienza dinamica, realistica e immersiva
per uno studente del terzo anno.

NON sei un quiz.
NON sei un libro.
SEI un paziente che evolve nel tempo.

La situazione deve cambiare in base alle decisioni.

LINGUA
Italiano clinico professionale.
Nessun inglesismo.

VIETATO
- Nessun riferimento a diagnosi NANDA NIC NOC
- Nessuna spiegazione didattica
- Nessun commento morale
- Nessun suggerimento su cosa sarebbe meglio fare

SIMULAZIONE
Ogni turno devi:

1. aggiornare parametri vitali
2. descrivere il comportamento del paziente
3. introdurre nuovi rischi o opportunità
4. mantenere coerenza con la storia
5. mostrare conseguenze reali delle decisioni precedenti

La progressione può includere:
- miglioramento
- stabilità
- deterioramento rapido
- complicanza improvvisa
- falso miglioramento
- errore latente che esplode dopo

PRESSIONE
Il paziente può peggiorare se il tempo passa o le priorità sono errate.

OBIETTIVO DIDATTICO NASCOSTO
Allenare riconoscimento precoce e priorità.

FORMATO JSON OBBLIGATORIO

{
  "phase": "string",
  "environment": "string",
  "patientUpdate": "string",
  "vitals": {
    "hr": number,
    "bp": "string",
    "rr": number,
    "spo2": number,
    "temp": number,
    "consciousness": "string"
  },
  "newFindings": [],
  "availableActions": [
    { "id": "A", "label": "string" },
    { "id": "B", "label": "string" },
    { "id": "C", "label": "string" },
    { "id": "D", "label": "string" }
  ],
  "outcome": "ongoing | improved | critical | stabilized",
  "xpDelta": number
}

REGOLE
- Solo JSON
- Nessun testo fuori
`.trim();

// ─────────────────────────────────────────────
// RAG BASE
// ─────────────────────────────────────────────
async function getRagContext(): Promise<string> {
  const { data } = await supabase
    .from("clinical_knowledge_base")
    .select("content")
    .limit(6);

  return data?.map((d: any) => d.content).join("\n---\n") || "";
}

// ─────────────────────────────────────────────
// XP SYSTEM
// ─────────────────────────────────────────────
async function addXP(userId: string, xp: number) {
  if (!xp) return;

  const { data } = await supabase
    .from("simulation_profiles")
    .select("xp")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) {
    await supabase.from("simulation_profiles").insert({
      user_id: userId,
      xp,
      level: 1
    });
    return;
  }

  const newXP = (data.xp || 0) + xp;
  const newLevel = Math.floor(newXP / 100) + 1;

  await supabase
    .from("simulation_profiles")
    .update({ xp: newXP, level: newLevel })
    .eq("user_id", userId);
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { action, userId, history, choice } = req.body;

    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const ragContext = await getRagContext();

    let userMessage = "";

    if (action === "start") {
      userMessage = `
Inizia una nuova simulazione clinica.
Contesto italiano reale.
Genera fase iniziale.

Materiale di riferimento:
${ragContext}
`;
    }

    if (action === "step") {
      userMessage = `
Simulazione in corso.

STORIA PRECEDENTE:
${JSON.stringify(history)}

AZIONE SCELTA DALLO STUDENTE:
${choice}

Evolvi la situazione.
`;
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        temperature: 1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ]
      })
    });

    const raw = await openaiRes.text();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: "Invalid JSON", raw });
    }

    const content = parsed?.choices?.[0]?.message?.content;
    if (!content) return res.status(500).json({ error: "No content" });

    const simData = JSON.parse(content);

    await addXP(userId, simData.xpDelta || 0);

    return res.status(200).json(simData);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Simulation error" });
  }
}
