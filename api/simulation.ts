import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────
// WORLD STRUCTURE (TUTTI I TUOI DATI ORIGINALI)
// ─────────────────────────────────────────────

type EnvironmentConfig = { minAge: number; maxAge: number; pathologies: string[]; };

const ENVIRONMENTS: Record<string, EnvironmentConfig> = {
  "Pronto Soccorso": { minAge: 18, maxAge: 95, pathologies: ["Dolore toracico sospetto SCA", "Sepsi", "Trauma cranico", "Trauma addominale", "Shock anafilattico", "Ictus ischemico", "Chetoacidosi diabetica", "Addome acuto", "Crisi epilettica", "Sepsi origine ignota", "Polmonite grave", "Trauma toracico", "Emorragia digestiva", "Intossicazione farmacologica", "Ritenzione urinaria acuta", "Riacutizzazione BPCO", "Dispnea", "Emorragia"] },
  "Terapia Intensiva Generale": { minAge: 18, maxAge: 95, pathologies: ["Shock settico", "ARDS", "Insufficienza multiorgano", "Post operatorio complicato", "Emorragia massiva", "Insufficienza respiratoria acuta", "Sepsi addominale", "Politrauma", "Pancreatite necrotica", "Insufficienza epatica acuta", "Insufficienza renale acuta"] },
  "Terapia Intensiva Cardiotoracovascolare": { minAge: 30, maxAge: 80, pathologies: ["Shock settico", "Shock cardiogeno", "Insufficienza respiratoria acuta", "Post CABG", "Post SVA", "Post SVM", "Post SVT", "Rottura di cuore", "Deiscenza ferita", "Dissezione aortica tipo A"] },
  "Terapia Intensiva Neonatale": { minAge: 0, maxAge: 1, pathologies: ["Prematurità con distress respiratorio", "Sepsi neonatale", "Sindrome da aspirazione di meconio", "Ittero patologico"] },
  "Geriatria": { minAge: 70, maxAge: 100, pathologies: ["Frattura femore", "Delirium", "Disidratazione severa", "Polmonite ab ingestis", "Ulcera da pressione infetta", "Malnutrizione", "Scompenso cardiaco", "Declino cognitivo acuto", "Riacutizzazione BPCO", "Insufficienza renale acuta", "Insufficienza respiratoria"] },
  "Ortopedia": { minAge: 30, maxAge: 85, pathologies: ["Post protesi anca", "Frattura esposta", "Politrauma", "Sindrome compartimentale", "Post artroplastica ginocchio", "frattura femore", "rimozione vite", "trazione"] },
  "Chirurgia Generale": { minAge: 30, maxAge: 90, pathologies: ["Post appendicectomia", "Post colectomia", "Occlusione intestinale", "Peritonite", "Post laparotomia", "Fistola intestinale", "Emorragia post operatoria"] },
  "Ginecologia": { minAge: 18, maxAge: 40, pathologies: ["Post ovarectomia", "Post vulvectotomia", "Post isteroannessiectomia", "Aborto spontaneo", "Emorragia post parto", "Parto naturale", "Parto cesareo"] },
  "Cardiologia": { minAge: 30, maxAge: 85, pathologies: ["Infarto STEMI", "Scompenso cardiaco acuto", "Aritmia instabile", "Shock cardiogeno", "NSTEMI", "Blocco AV", "Edema polmonare acuto", "storm aritmico", "Insufficienza valvolare aortica", "Insufficienza valvolare mitralica", "Insufficienza valvolare tricuspide", "Ematoma intramurario", "Dissezione tipo B"] },
  "Domicilio": { minAge: 25, maxAge: 100, pathologies: ["PEG occlusa", "Catetere ostruito", "Ulcera da pressione", "Ulcera da pressione avanzata", "Febbre in paziente fragile", "grave stato nutrizionale", "mobilità compromessa", "disidratazione"] },
  "Pneumologia": { minAge: 40, maxAge: 85, pathologies: ["Embolia polmonare", "Versamento pleurico", "BPCO grave", "Polmonite interstiziale", "Insufficienza respiratoria cronica", "Polmonite da COVID", "Polmonite da ab ingestis"] },
  "Neurologia": { minAge: 30, maxAge: 70, pathologies: ["Ictus ischemico", "Ictus emorragico", "Crisi epilettica", "Emorragia subaracnoidea", "Trauma cranico", "Miastenia gravis riacutizzata"] },
  "Oncologia": { minAge: 18, maxAge: 70, pathologies: ["Neutropenia febbrile", "Dolore oncologico severo", "Ostruzione intestinale neoplastica", "Sindrome da compressione midollare", "Cachessia severa", "chemioterapia", "radioterapia"] },
  "Dialisi": { minAge: 40, maxAge: 90, pathologies: ["Ipotensione post dialisi", "Accesso vascolare infetto", "Iperkaliemia", "Sovraccarico idrico", "Crisi ipertensiva"] },
  "Ambulanza 118": { minAge: 20, maxAge: 100, pathologies: ["Arresto cardiaco", "Politrauma", "Shock anafilattico", "Infarto in atto", "Insufficienza respiratoria acuta", "crisi epilettica"] }
};

const PERSONALITIES = ["collaborante", "ansioso", "aggressivo", "confuso", "negante", "spaventato"];

/* ================================
   UTIL ORIGINALI + MIGLIORATE
================================ */

function randomFrom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function generateCoherentAge(env: EnvironmentConfig) { return Math.floor(Math.random() * (env.maxAge - env.minAge + 1)) + env.minAge; }
function generateGender(age: number) { return age < 1 ? "N/D" : (Math.random() > 0.5 ? "M" : "F"); }
function isPregnancyPossible(age: number, gender: string) { return gender === "F" && age >= 16 && age <= 45 && Math.random() < 0.2; }
function initialSeverity(pathology: string): number {
  const p = pathology.toLowerCase();
  if (p.includes("shock") || p.includes("ards") || p.includes("emorragia") || p.includes("arresto")) return 4;
  if (p.includes("infarto") || p.includes("sepsi") || p.includes("ictus")) return 3;
  return 2;
}

function vitalsBySeverity(severity: number) {
  if (severity <= 2) return { hr: 88, bp: "125/75", rr: 16, spo2: 98, temp: 36.8, consciousness: "vigile" };
  if (severity === 3) return { hr: 105, bp: "100/60", rr: 22, spo2: 94, temp: 38, consciousness: "vigile" };
  if (severity === 4) return { hr: 125, bp: "90/55", rr: 28, spo2: 90, temp: 39, consciousness: "confuso" };
  return { hr: 140, bp: "80/45", rr: 32, spo2: 85, temp: 39.5, consciousness: "soporoso" };
}

// NUOVO: Sanity Check per evitare allucinazioni AI
function sanitizeVitals(v) {
  return {
    hr: Math.min(Math.max(v.hr || 0, 0), 220),
    bp: v.bp || "0/0",
    rr: Math.min(Math.max(v.rr || 0, 0), 60),
    spo2: Math.min(Math.max(v.spo2 || 0, 0), 100),
    temp: Math.min(Math.max(v.temp || 36, 34), 42),
    consciousness: v.consciousness || "stato ignoto"
  };
}

/* ================================
   PROFILO ADATTIVO STUDENTE
================================ */

async function getOrCreateAdaptiveProfile(userId: string) {
  const { data, error } = await supabase.from("simulation_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (!data) {
    const { data: created } = await supabase.from("simulation_profiles").insert({
      user_id: userId, xp: 0, level: 1, behavior: { escalationDelay: 0, airwayFocus: 0, hemodynamicNeglect: 0, renalNeglect: 0, impulsivity: 0 }
    }).select().single();
    return created;
  }
  return data;
}

function updateBehaviorMetrics(profile: any, choice: string | undefined) {
  if (!choice) return profile.behavior;
  const behavior = profile.behavior || {};
  const c = choice.toLowerCase();
  if (c.includes("ossigen")) behavior.airwayFocus = (behavior.airwayFocus || 0) + 1;
  if (c.includes("pressione") || c.includes("fluid")) behavior.hemodynamicNeglect = Math.max((behavior.hemodynamicNeglect || 0) - 1, 0);
  if (c.includes("diures")) behavior.renalNeglect = Math.max((behavior.renalNeglect || 0) - 1, 0);
  if (c.includes("attendi")) behavior.escalationDelay = (behavior.escalationDelay || 0) + 1;
  return behavior;
}

function adaptiveDifficulty(profile: any, baseSeverity: number) {
  const behavior = profile.behavior || {};
  let modifier = 0;
  if ((behavior.escalationDelay || 0) > 3) modifier += 1;
  if ((behavior.renalNeglect || 0) > 3) modifier += 1;
  return Math.min(baseSeverity + modifier, 5);
}

/* ================================
   SYSTEM PROMPT (MIGLIORATO CON LOGICA WOW)
================================ */

const SYSTEM_PROMPT = `
Sei il motore narrativo di YouWare, una simulazione clinica infermieristica.
REGOLE FERREE:
- Genera briefing SBAR solo al Turno 1 così strutturato:
S – Situazione
Perché è ricoverato.

B – Background
Cosa è successo prima.

A – Assessment
Stato neurologico
Respirazione (spontanea? NIV? Intubato?)
Emodinamica
Diuresi
Alimentazione (orale? PEG? SNG? Digiuno?)
Mobilità
Lesioni da pressione
Accessi vascolari
Dispositivi presenti

R – Raccomandazione
Cosa monitorare ora.

- CRITICAL FAIL: Se lo studente ignora parametri critici (SpO2 < 85%, BP < 80/40) per 2 turni o compie errori letali, imposta outcome: "critical".
- REATTIVITÀ: Se l'azione è corretta, i parametri migliorano nel turno successivo.
- PARAMETRI NASCOSTI: Se l'azione dell'utente non include monitoraggi (es. EGA, diuresi), ometti o scrivi "Richiedere valutazione" nei dati extra.
- VARIABILITÀ: Non dare sempre lo stesso esito per la stessa patologia.
REGOLE FERREE:
- Non cambiare paziente.
- Non cambiare reparto.
- Minimo 5 turni.
- Se gravità alta puoi arrivare a 7.
- Introduci pressione progressiva.
- Introduci effetti ritardati.
- Analizza lo stile decisionale implicito.
- Adatta la difficoltà.

VIETATO ASSOLUTO:
- NANDA
- NIC
- NOC
- Spiegazioni didattiche
- Linguaggio scolastico

OUTPUT SOLO JSON:
{
  "phase": "string",
  "turn": number,
  "patientUpdate": "Descrizione clinica in base alla scelta",
  "vitals": { "hr": number, "bp": "string", "rr": number, "spo2": number, "temp": number, "consciousness": "string", "hiddenParams": { "diuresi": "string", "ega": "string" } },
  "availableActions": [ { "id": "A", "label": "string" }, { "id": "B", "label": "string" } ],
  "outcome": "ongoing | improved | critical | stabilized",
  "debriefing": "Solo se outcome != ongoing. Analizza le scelte dello studente.",
  "xpDelta": number
}
`.trim();

/* ================================
   GESTIONE GIOCO
================================ */

async function createGame(userId: string) {
  const environmentName = randomFrom(Object.keys(ENVIRONMENTS));
  const env = ENVIRONMENTS[environmentName];
  const pathology = randomFrom(env.pathologies);
  const age = generateCoherentAge(env);
  const gender = generateGender(age);
  const pregnant = isPregnancyPossible(age, gender);
  const severity = initialSeverity(pathology);

  const { data: game, error } = await supabase.from("simulation_games").insert({
    user_id: userId, environment: environmentName, patient_name: "Paziente " + Math.floor(Math.random() * 9999),
    patient_age: age, patient_gender: gender, context: { pathology, personality: randomFrom(PERSONALITIES), severity, pregnant }, turn: 1
  }).select().single();

  if (error || !game) throw new Error("Game creation failed");

  await supabase.from("simulation_state").insert({
    game_id: game.id, vitals: vitalsBySeverity(severity), choice_made: "Inizio simulazione"
  });

  return game;
}

/* ================================
   HANDLER (ESPOSTO)
================================ */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { action, userId, gameId, choice } = req.body;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const profile = await getOrCreateAdaptiveProfile(userId);
    let game: any;

    if (action === "start") {
      game = await createGame(userId);
    } else {
      const { data } = await supabase.from("simulation_games").select("*").eq("id", gameId).single();
      if (!data) return res.status(404).json({ error: "Game not found" });
      game = data;
    }

    // RECUPERO HISTORY (PER COERENZA CLINICA)
    const { data: history } = await supabase.from("simulation_state").select("*").eq("game_id", game.id).order("created_at", { ascending: true });
    const lastState = history ? history[history.length - 1] : { vitals: vitalsBySeverity(game.context.severity) };

    const turn = action === "step" ? (game.turn || 1) + 1 : 1;
    const updatedBehavior = updateBehaviorMetrics(profile, choice);
    await supabase.from("simulation_profiles").update({ behavior: updatedBehavior }).eq("user_id", userId);

    const adaptiveSev = adaptiveDifficulty(profile, game.context.severity);

    const userMessage = `
Paziente: ${game.patient_age}a, ${game.patient_gender}, ${game.context.pathology}. 
Turno Corrente: ${turn}. 
Ultima Azione Studente: "${choice || "Nessuna"}". 
Parametri Precedenti: ${JSON.stringify(lastState.vitals)}.
Storia della simulazione: ${history?.map(h => h.choice_made).join(" -> ")}.
Genera il prossimo stato clinico.
`.trim();

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o", // O gpt-5-nano se hai accesso
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userMessage }]
      })
    });

    const raw = await openaiRes.json();
    let simData = JSON.parse(raw.choices[0].message.content);

    // Sanificazione e gestione turni
    simData.vitals = sanitizeVitals(simData.vitals);
    if (turn >= 7 && simData.outcome === "ongoing") simData.outcome = "stabilized";

    // Salvataggio stato
    await supabase.from("simulation_games").update({ turn }).eq("id", game.id);
    await supabase.from("simulation_state").insert({
      game_id: game.id,
      vitals: simData.vitals,
      choice_made: choice || "Inizio",
      ai_response: simData.patientUpdate
    });

    return res.status(200).json({ type: simData.outcome === "ongoing" ? "step" : "debrief", gameId: game.id, ...simData });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Simulation crash" });
  }
}
