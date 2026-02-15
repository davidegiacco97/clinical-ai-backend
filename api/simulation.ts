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
    .select("xp, level")
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

async function getSimulationProfile(userId: string) {
  const { data } = await supabase
    .from("simulation_profiles")
    .select("xp, level")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    xpTotal: data?.xp || 0,
    level: data?.level || 1
  };
}

// ─────────────────────────────────────────────
// RISK LEVEL INFERENCE
// ─────────────────────────────────────────────
function inferRiskLevel(vitals: any): "low" | "medium" | "high" {
  if (!vitals) return "medium";

  const hr = Number(vitals.hr || 0);
  const rr = Number(vitals.rr || 0);
  const spo2 = Number(vitals.spo2 || 0);
  const temp = Number(vitals.temp || 0);
  const bpStr = String(vitals.bp || "");
  const systolic = parseInt(bpStr.split("/")[0] || "0", 10);

  if (
    spo2 < 90 ||
    systolic < 90 ||
    hr > 130 ||
    rr > 30 ||
    temp > 39.5 ||
    temp < 35
  ) {
    return "high";
  }

  if (
    spo2 < 94 ||
    systolic < 100 ||
    hr > 110 ||
    rr > 24 ||
    temp > 38.5
  ) {
    return "medium";
  }

  return "low";
}

// ─────────────────────────────────────────────
// DEBRIEF BUILDER (BACKEND-DRIVEN)
// ─────────────────────────────────────────────
async function buildDebrief(
  userId: string,
  simData: any,
  history: string[] | undefined
) {
  const profile = await getSimulationProfile(userId);

  const outcome = simData.outcome || "ongoing";
  const lastUpdate = simData.patientUpdate || "";
  const findings: string[] = Array.isArray(simData.newFindings)
    ? simData.newFindings
    : [];

  const historyText = (history || []).join(" | ");

  let summary = "";
  let strengths: string[] = [];
  let priorityErrors: string[] = [];
  let missedRisks: string[] = [];
  let clinicalReasoning: string[] = [];
  let whatWouldHappenNext = "";

  if (outcome === "improved") {
    summary = `Il paziente ha mostrato un miglioramento clinico significativo. ${lastUpdate}`;
    strengths = [
      "Hai riconosciuto precocemente i segni di instabilità.",
      "Hai scelto interventi coerenti con le priorità cliniche.",
      "Hai monitorato in modo sistematico i parametri vitali.",
      "Hai rivalutato l'efficacia degli interventi nel tempo."
    ];
    priorityErrors = [];
    missedRisks = findings.length
      ? [
          "Alcuni reperti aggiuntivi non sono stati pienamente integrati nel ragionamento clinico.",
          "Alcuni rischi potenziali sono stati riconosciuti ma non gestiti in modo esplicito."
        ]
      : [];
    clinicalReasoning = [
      "Hai dimostrato una buona capacità di collegare segni e sintomi alle priorità assistenziali.",
      "La sequenza delle azioni è stata in gran parte coerente con la gravità del quadro clinico.",
      "Hai mostrato attenzione alla stabilizzazione respiratoria e circolatoria."
    ];
    whatWouldHappenNext =
      "Con il proseguire del monitoraggio e degli interventi, il paziente potrebbe consolidare il miglioramento e avviarsi verso una stabilizzazione completa, con progressiva riduzione dell'intensità assistenziale.";
  } else if (outcome === "critical") {
    summary = `Il quadro clinico è evoluto verso una condizione critica. ${lastUpdate}`;
    strengths = [
      "Hai mantenuto un monitoraggio costante dei parametri vitali.",
      "Hai tentato di intervenire su alcuni aspetti prioritari del quadro clinico."
    ];
    priorityErrors = [
      "Alcune priorità critiche non sono state affrontate con sufficiente tempestività.",
      "La sequenza degli interventi non ha sempre rispecchiato la gravità dei segni vitali.",
      "Non tutte le modifiche dei parametri vitali sono state tradotte in azioni concrete."
    ];
    missedRisks = findings.length
      ? [
          "Alcuni reperti aggiuntivi indicavano un rischio imminente che non è stato pienamente riconosciuto.",
          "Il deterioramento progressivo non è stato intercettato con un cambio di strategia assistenziale."
        ]
      : [
          "Il rischio di deterioramento rapido non è stato anticipato in modo adeguato.",
          "La possibilità di complicanze non è stata integrata nel piano assistenziale."
        ];
    clinicalReasoning = [
      "Il ragionamento clinico è stato presente ma non sempre allineato alla gravità del quadro.",
      "Alcuni segni di allarme non sono stati interpretati come prioritari.",
      "La gestione delle risorse e del tempo potrebbe essere ottimizzata nelle fasi critiche."
    ];
    whatWouldHappenNext =
      "In uno scenario reale, il paziente richiederebbe un'escalation assistenziale rapida, con coinvolgimento del team medico, possibile trasferimento in area ad alta intensità di cura e attivazione di protocolli di emergenza.";
  } else if (outcome === "stabilized") {
    summary = `Il paziente ha raggiunto una stabilizzazione relativa, pur mantenendo alcuni elementi di fragilità clinica. ${lastUpdate}`;
    strengths = [
      "Hai ottenuto una stabilizzazione dei parametri vitali più critici.",
      "Hai mantenuto un monitoraggio regolare e strutturato.",
      "Hai dimostrato capacità di rivalutazione nel tempo."
    ];
    priorityErrors = [
      "Alcune aree di rischio residuo non sono state affrontate in modo completo.",
      "La pianificazione a medio termine potrebbe essere ulteriormente strutturata."
    ];
    missedRisks = findings.length
      ? [
          "Alcuni reperti suggeriscono rischi evolutivi che richiederebbero un follow-up più stretto.",
          "Non tutti i potenziali punti di deterioramento sono stati esplicitamente considerati."
        ]
      : [];
    clinicalReasoning = [
      "Il ragionamento clinico ha permesso di evitare un deterioramento, ma può essere reso più proattivo.",
      "La gestione delle priorità è stata generalmente adeguata, con margini di miglioramento nella previsione dei rischi.",
      "Hai mostrato attenzione alla continuità assistenziale."
    ];
    whatWouldHappenNext =
      "Con una pianificazione assistenziale strutturata e un monitoraggio continuo, il paziente potrebbe mantenere la stabilità e progredire verso un miglioramento, riducendo gradualmente il livello di intensità assistenziale.";
  } else {
    // fallback, non dovrebbe arrivare qui per il debrief
    summary = `La simulazione si è conclusa con un esito non specificato. ${lastUpdate}`;
    strengths = [
      "Hai portato a termine la simulazione mantenendo un monitoraggio costante.",
      "Hai esplorato diverse opzioni decisionali nel corso dello scenario."
    ];
    priorityErrors = [];
    missedRisks = [];
    clinicalReasoning = [
      "Il ragionamento clinico può essere ulteriormente strutturato per migliorare la gestione delle priorità.",
    ];
    whatWouldHappenNext =
      "In uno scenario reale, sarebbe necessario un debriefing strutturato per consolidare gli apprendimenti e identificare le aree di miglioramento.";
  }

  // Se abbiamo una storia, usiamola per arricchire il reasoning
  if (history && history.length > 0) {
    clinicalReasoning.push(
      `La sequenza delle azioni (${historyText}) mostra il tuo stile decisionale: puoi usarla per riflettere su tempi, priorità e alternative possibili.`
    );
  }

  return {
    summary,
    strengths,
    priorityErrors,
    missedRisks,
    clinicalReasoning,
    whatWouldHappenNext,
    xpTotal: profile.xpTotal,
    level: profile.level
  };
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
    } else if (action === "step") {
      userMessage = `
Simulazione in corso.

STORIA PRECEDENTE:
${JSON.stringify(history || [])}

AZIONE SCELTA DALLO STUDENTE:
${choice}

Evolvi la situazione.
`;
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }

    // ─────────────────────────────────────────────
    // OPENAI CALL
    // ─────────────────────────────────────────────
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

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: "Invalid JSON from OpenAI", raw });
    }

    const content = parsed?.choices?.[0]?.message?.content;
    if (!content) return res.status(500).json({ error: "No content", raw });

    // ─────────────────────────────────────────────
    // SANITIZER JSON
    // ─────────────────────────────────────────────
    const cleaned = content
      .trim()
      .replace(/```json/g, "")
      .replace(/```/g, "");

    let simData: any;
    try {
      simData = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({
        error: "Invalid simulation JSON",
        rawContent: cleaned
      });
    }

    // Assicuriamoci che vitals esista
    if (!simData.vitals) {
      simData.vitals = {
        hr: 90,
        bp: "120/70",
        rr: 16,
        spo2: 98,
        temp: 36.8,
        consciousness: "vigile"
      };
    }

    // Assicuriamoci che newFindings e availableActions siano array
    if (!Array.isArray(simData.newFindings)) {
      simData.newFindings = [];
    }
    if (!Array.isArray(simData.availableActions)) {
      simData.availableActions = [
        { id: "A", label: "Valuta nuovamente il paziente" },
        { id: "B", label: "Richiedi supporto al team" },
        { id: "C", label: "Rivaluta i parametri vitali" },
        { id: "D", label: "Documenta la situazione" }
      ];
    }

    // Risk level fallback
    if (!simData.riskLevel) {
      simData.riskLevel = inferRiskLevel(simData.vitals);
    }

    const xpDelta = Number(simData.xpDelta || 0);

    // Se outcome è ongoing → step normale
    if (!simData.outcome || simData.outcome === "ongoing") {
      await addXP(userId, xpDelta);
      return res.status(200).json({
        phase: simData.phase || "Fase iniziale",
        environment: simData.environment || "Reparto",
        patientUpdate: simData.patientUpdate || "",
        vitals: simData.vitals,
        newFindings: simData.newFindings,
        availableActions: simData.availableActions,
        outcome: "ongoing",
        xpDelta,
        riskLevel: simData.riskLevel
      });
    }

    // Se outcome è finale → generiamo debrief
    await addXP(userId, xpDelta);
    const debrief = await buildDebrief(userId, simData, history || []);

    return res.status(200).json(debrief);

  } catch (err) {
    console.error("Simulation error:", err);
    return res.status(500).json({ error: "Simulation error" });
  }
}
