import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────
// SYSTEM PROMPT – SIMULATORE CLINICO ADATTIVO
// ─────────────────────────────────────────────
const SYSTEM_PROMPT = `
Sei il motore narrativo di un simulatore clinico infermieristico ad alta fedeltà, rivolto a studenti del 3° anno.

Non stai generando un caso.
Stai gestendo un turno reale.
Il tuo compito è generare pressione, incertezza, priorità concorrenti
e conseguenze credibili nel tempo.
La simulazione deve sembrare viva.
La simulazione deve svilupparsi attraverso vari step.
Non può terminare rapidamente.
Le decisioni, gli interventi e le manovre devono essere infermieristiche, non mediche. Se si tratta di manovre mediche, specifica che bisogna fare l’assistenza infermieristica a quella manovra.

────────────────────────
IDENTITÀ DEL MONDO
────────────────────────
Ogni nuova partita deve svolgersi in un ambiente potenzialmente diverso:
reparto, terapia intensiva, pronto soccorso, ambulanza, territorio, RSA,
ambulatorio, luogo pubblico.
Prendi in considerazione tutti i reparti ospedalieri (medicina, geriatria, chirurgia, urologia, terapia intensiva di qualsiasi specialistica, pronto soccorso, pneumologia, ortopedia, cardiologia, reparti di imaging come TAC, Radiografia, RMN, sala operatoria di qualsiasi specialistica, ecc. e tutto quello che ti viene in mente).
Ogni nuovo caso deve prendere in considerazione tutti i tipi di pazienti (post operato di tutte le specialità, anziano, pediatrico, giovane, donna, uomo, gravida, psichiatrico, trauma,  problematiche cardiache, problemi respiratori, scompensi, BPCO, ecc. e tutto quello che ti viene in mente.)

Evita ripetizioni rispetto alle simulazioni precedenti.
────────────────────────
IDENTITÀ DEL PAZIENTE
────────────────────────
Quando il contesto lo consente, fornisci:
età, motivo di ricovero, comorbilità essenziali.

Se non realistico, limita le informazioni.

────────────────────────
STRUTTURA DELLA PARTITA
────────────────────────
Una simulazione NON può concludersi prima di 5 step.
Idealmente 6 o più.

Non terminare mai al primo step anche se la scelta è ottima.

────────────────────────
MECCANICA PRINCIPALE
────────────────────────
Ogni step deve introdurre almeno UNO dei seguenti:

• nuovo rischio
• peggioramento inatteso
• informazione ambigua
• distrazione
• conflitto di priorità
• conseguenza di decisione precedente
• evento latente che emerge
Tutti sullo stesso paziente! Quando hai iniziato un caso su un paziente, evolvi quel caso, non cambiare paziente/situazione.

────────────────────────
PRIORITÀ IN CONFLITTO
────────────────────────
Le azioni disponibili devono competere tra loro.
Sceglierne una implica ritardare o rinunciare alle altre.
Se lo studente si concentra su un problema, qualcos’altro può peggiorare.

Evita liste generiche di buone pratiche.

────────────────────────
EFFETTI RITARDATI
────────────────────────
Alcune decisioni producono effetti dopo 1–3 turni.
Mantieni memoria.

────────────────────────
TEMPO
────────────────────────
Il tempo passa sempre.
Anche il non scegliere una azione modifica il rischio.

────────────────────────
DINAMICA DEL PAZIENTE
────────────────────────
Il paziente può:
migliorare, peggiorare, stabilizzarsi temporaneamente,
mostrare falsi segnali rassicuranti.

────────────────────────
COMPLESSITÀ
────────────────────────
Introduci rumore realistico:
allarmi secondari, richieste del medico, familiari, problemi tecnici.

────────────────────────
INFORMAZIONI
────────────────────────
Non dare tutto subito.
Alcuni dati compaiono solo se il discente presta attenzione.

────────────────────────
DIFFICOLTÀ
────────────────────────
La pressione deve aumentare con gli step.

SCELTE
────────────────────────
Fornisci da 2 fino a 4 opzioni.
Devono rappresentare alternative realistiche.
NON deve essere evidente quella migliore.

────────────────────────
NESSUN FEEDBACK
────────────────────────
Durante il gioco NON dire se è giusto o sbagliato.
Solo conseguenze cliniche.

────────────────────────
OBIETTIVO NASCOSTO
────────────────────────
Allenare:
- priorità
- anticipazione
- gestione del carico
- pensiero critico

────────────────────────
VIETATO
────────────────────────
- spiegazioni didattiche
- morale
- suggerimenti
- NANDA NIC NOC

────────────────────────
LINGUA
────────────────────────
Italiano clinico realistico.

────────────────────────
JSON
────────────────────────
{
  "phase": "string",
  "turn": number,
  "environment": "string",
  "patientUpdate": "string",
  "vitals": { hr, bp, rr, spo2, temp, consciousness },
  "newFindings": [],
  "interruptions": [],
  "pendingEffects": [],
  "availableActions": [
    { "id": "A", "label": "string" },
    { "id": "B", "label": "string" }
  ],
  "outcome": "ongoing | improved | critical | stabilized",
  "xpDelta": number
}

REGOLE:
Se turn < 5 → outcome = ongoing.
Nessun testo esterno.
Solo JSON.
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

async function getProfile(userId: string) {
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
// RISK LEVEL
// ─────────────────────────────────────────────
function inferRiskLevel(v: any): "low" | "medium" | "high" {
  if (!v) return "medium";

  const hr = Number(v.hr || 0);
  const rr = Number(v.rr || 0);
  const spo2 = Number(v.spo2 || 0);
  const temp = Number(v.temp || 0);
  const systolic = parseInt(String(v.bp || "0/0").split("/")[0], 10);

  if (spo2 < 90 || systolic < 90 || hr > 130 || rr > 30 || temp > 39.5 || temp < 35)
    return "high";

  if (spo2 < 94 || systolic < 100 || hr > 110 || rr > 24 || temp > 38.5)
    return "medium";

  return "low";
}

// ─────────────────────────────────────────────
// DEBRIEF BUILDER (BACKEND)
// ─────────────────────────────────────────────
async function buildDebrief(userId: string, simData: any, history: string[]) {
  const profile = await getProfile(userId);

  const outcome = simData.outcome;
  const lastUpdate = simData.patientUpdate || "";
  const findings = Array.isArray(simData.newFindings) ? simData.newFindings : [];

  let summary = "";
  let strengths: string[] = [];
  let priorityErrors: string[] = [];
  let missedRisks: string[] = [];
  let clinicalReasoning: string[] = [];
  let whatWouldHappenNext = "";

  if (outcome === "improved") {
    summary = `Il paziente ha mostrato un miglioramento clinico. ${lastUpdate}`;
    strengths = [
      "Hai riconosciuto precocemente i segni di instabilità.",
      "Hai scelto interventi coerenti con le priorità cliniche.",
      "Hai monitorato in modo sistematico i parametri vitali."
    ];
    priorityErrors = [];
    missedRisks = findings.length ? ["Alcuni reperti non sono stati integrati pienamente."] : [];
    clinicalReasoning = [
      "Il ragionamento clinico è stato coerente con la situazione.",
      "Hai mantenuto una buona sequenza decisionale."
    ];
    whatWouldHappenNext =
      "Il paziente potrebbe consolidare il miglioramento con monitoraggio continuo.";
  }

  if (outcome === "critical") {
    summary = `Il quadro clinico è evoluto verso una condizione critica. ${lastUpdate}`;
    strengths = ["Hai mantenuto un monitoraggio costante."];
    priorityErrors = [
      "Alcune priorità critiche non sono state affrontate tempestivamente.",
      "La sequenza degli interventi non ha rispecchiato la gravità del quadro."
    ];
    missedRisks = findings.length
      ? ["Alcuni reperti indicavano un rischio imminente non riconosciuto."]
      : ["Il deterioramento non è stato anticipato."];
    clinicalReasoning = [
      "Il ragionamento clinico è stato presente ma non sempre allineato alla gravità.",
      "Alcuni segni di allarme non sono stati interpretati come prioritari."
    ];
    whatWouldHappenNext =
      "In uno scenario reale sarebbe necessaria un'escalation assistenziale urgente.";
  }

  if (outcome === "stabilized") {
    summary = `Il paziente ha raggiunto una stabilizzazione relativa. ${lastUpdate}`;
    strengths = [
      "Hai ottenuto una stabilizzazione dei parametri vitali.",
      "Hai mantenuto un monitoraggio regolare."
    ];
    priorityErrors = ["Alcune aree di rischio residuo non sono state affrontate completamente."];
    missedRisks = findings.length ? ["Alcuni reperti suggeriscono rischi evolutivi."] : [];
    clinicalReasoning = [
      "Il ragionamento clinico ha evitato un deterioramento.",
      "La gestione delle priorità è stata adeguata."
    ];
    whatWouldHappenNext =
      "Con monitoraggio continuo il paziente potrebbe progredire verso un miglioramento.";
  }

  // Aggiungiamo riflessione sulla storia
  if (history.length > 0) {
    clinicalReasoning.push(
      `La sequenza delle azioni (${history.join(" → ")}) mostra il tuo stile decisionale.`
    );
  }

  return {
    type: "debrief",
    summary,
    strengths,
    missedRisks,
    priorityErrors,
    communicationNotes: [], // <── IMPORTANTE PER EVITARE CRASH
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
Genera fase iniziale.

Materiale di riferimento:
${ragContext}
`;
    } else if (action === "step") {
      userMessage = `
Simulazione in corso.

STORIA PRECEDENTE:
${JSON.stringify(history || [])}

AZIONE SCELTA:
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

    const cleaned = content
      .trim()
      .replace(/```json/g, "")
      .replace(/```/g, "");

    let simData: any;
    try {
      simData = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({ error: "Invalid simulation JSON", rawContent: cleaned });
    }

    // Fallback vitals
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

    // Fallback arrays
    if (!Array.isArray(simData.newFindings)) simData.newFindings = [];
    if (!Array.isArray(simData.availableActions)) {
      simData.availableActions = [
        { id: "A", label: "Rivaluta il paziente" },
        { id: "B", label: "Richiedi supporto" },
        { id: "C", label: "Controlla i parametri" },
        { id: "D", label: "Documenta" }
      ];
    }

    // Risk level
    if (!simData.riskLevel) {
      simData.riskLevel = inferRiskLevel(simData.vitals);
    }

    const xpDelta = Number(simData.xpDelta || 0);
    await addXP(userId, xpDelta);

    // ─────────────────────────────────────────────
    // STEP NORMALE
    // ─────────────────────────────────────────────
    if (!simData.outcome || simData.outcome === "ongoing") {
      return res.status(200).json({
        type: "step",
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

    // ─────────────────────────────────────────────
    // DEBRIEF FINALE
    // ─────────────────────────────────────────────
    const debrief = await buildDebrief(userId, simData, history || []);
    return res.status(200).json(debrief);

  } catch (err) {
    console.error("Simulation error:", err);
    return res.status(500).json({ error: "Simulation error" });
  }
}
