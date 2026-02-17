import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─────────────────────────────────────────────
// WORLD STRUCTURE COERENTE
// ─────────────────────────────────────────────

type EnvironmentConfig = {
  minAge: number;
  maxAge: number;
  pathologies: string[];
};

const ENVIRONMENTS: Record<string, EnvironmentConfig> = {
  "Pronto Soccorso": {
    minAge: 18,
    maxAge: 95,
    pathologies: [
      "Dolore toracico sospetto SCA",
      "Sepsi",
      "Trauma cranico",
      "Trauma addominale",
      "Shock anafilattico",
      "Ictus ischemico",
      "Chetoacidosi diabetica",
      "Addome acuto",
      "Crisi epilettica",       
    "Sepsi origine ignota",
    "Polmonite grave",
    "Trauma toracico",
    "Emorragia digestiva",
    "Intossicazione farmacologica",
    "Ritenzione urinaria acuta",
      "Riacutizzazione BPCO",
      "Dispnea",
      "Emorragia"
      ]
  },

  "Terapia Intensiva Generale": {
    minAge: 18,
    maxAge: 95,
    pathologies: [
      "Shock settico",
      "ARDS",
      "Insufficienza multiorgano",
      "Post operatorio complicato",
      "Emorragia massiva",
    "Insufficienza respiratoria acuta",
    "Sepsi addominale",
    "Politrauma",
    "Pancreatite necrotica",
    "Insufficienza epatica acuta",
      "Insufficienza renale acuta"
    ]
  },

  "Terapia Intensiva Cardiotoracovascolare": {
    minAge: 30,
    maxAge: 80,
    pathologies: [
      "Shock settico",
      "Shock cardiogeno",
      "Insufficienza respiratoria acuta",
      "Post CABG",
      "Post SVA"
    "Post SVM",
    "Post SVT",
    "Rottura di cuore",
    "Deiscenza ferita",
    "Dissezione aortica tipo A"
    ]
  },  

  "Terapia Intensiva Neonatale": {
    minAge: 0,
    maxAge: 1,
    pathologies: [
      "Prematurità con distress respiratorio",
      "Sepsi neonatale",
      "Sindrome da aspirazione di meconio",
    "Ittero patologico"
    ]
  },

  "Geriatria": {
    minAge: 70,
    maxAge: 100,
    pathologies: [
      "Frattura femore",
      "Delirium",
      "Disidratazione severa",
      "Polmonite ab ingestis",
      "Ulcera da pressione infetta",
    "Malnutrizione",
    "Scompenso cardiaco",
    "Declino cognitivo acuto",
      "Riacutizzazione BPCO",
      "Insufficienza renale acuta",
      "Insufficienza respiratoria"
    ]
  },

    "Ortopedia": {
    minAge: 30,
    maxAge: 85,
    pathologies: [
    "Post protesi anca",
    "Frattura esposta",
    "Politrauma",
    "Sindrome compartimentale",
    "Post artroplastica ginocchio",
      "frattura femore",
      "rimozione vite",
      "trazione"
  ]
      },

  "Chirurgia Generale": {
    minAge: 30,
    maxAge: 90,
    pathologies: [
    "Post appendicectomia",
    "Post colectomia",
    "Occlusione intestinale",
    "Peritonite",
    "Post laparotomia",
    "Fistola intestinale",
    "Emorragia post operatoria"
  ]
     },

   "Ginecologia": {
    minAge: 18,
    maxAge: 40,
    pathologies: [
    "Post ovarectomia",
    "Post vulvectotomia",
    "Post isteroannessiectomia",
    "Aborto spontaneo",
    "Emorragia post parto",
    "Parto naturale",
    "Parto cesareo"
  ]
     },

  "Cardiologia": {
    minAge: 30,
    maxAge: 85,
    pathologies: [
      "Infarto STEMI",
      "Scompenso cardiaco acuto",
      "Aritmia instabile",
      "Shock cardiogeno",
    "NSTEMI",
    "Blocco AV",
    "Edema polmonare acuto",
      "storm aritmico",
      "Insufficienza valvolare aortica",
      "Insufficienza valvolare mitralica",
      "Insufficienza valvolare tricuspide",
      "Ematoma intramurario",
      "Dissezione tipo B"
    ]
  },

  "Domicilio": {
    minAge: 25,
    maxAge: 100,
    pathologies: [
      "PEG occlusa",
      "Catetere ostruito",
      "Ulcera da pressione",
    "Ulcera da pressione avanzata",
    "Febbre in paziente fragile",
      "grave stato nutrizionale",
      "mobilità compromessa",
      "disidratazione"
    ]
  },

   "Pneumologia": { 
    minAge: 40,
    maxAge: 85,
    pathologies: [
    "Embolia polmonare",
    "Versamento pleurico",
    "BPCO grave",
    "Polmonite interstiziale",
    "Insufficienza respiratoria cronica",
      "Polmonite da COVID",
      "Polmonite da ab ingestis"
    ]
   },    

   "Neurologia": { 
    minAge: 30,
    maxAge: 70,
    pathologies: [
    "Ictus ischemico",
    "Ictus emorragico",
    "Crisi epilettica",
    "Emorragia subaracnoidea",
    "Trauma cranico",
    "Miastenia gravis riacutizzata"
  ]
       },

   "Oncologia": { 
    minAge: 18,
    maxAge: 70,
    pathologies: [
    "Neutropenia febbrile",
    "Dolore oncologico severo",
    "Ostruzione intestinale neoplastica",
    "Sindrome da compressione midollare",
    "Cachessia severa",
      "chemioterapia",
      "radioterapia"
  ]
       },

    "Dialisi": { 
    minAge: 40,
    maxAge: 90,
    pathologies:[
    "Ipotensione post dialisi",
    "Accesso vascolare infetto",
    "Iperkaliemia",
    "Sovraccarico idrico",
    "Crisi ipertensiva"
  ]
       },

  "Ambulanza 118": {
    minAge: 20,
    maxAge: 100,
    pathologies: [
    "Arresto cardiaco",
    "Politrauma",
    "Shock anafilattico",
    "Infarto in atto",
    "Insufficienza respiratoria acuta",
      "crisi epilettica"
  ]
};

const PERSONALITIES = [
  "collaborante",
  "ansioso",
  "aggressivo",
  "confuso",
  "negante",
  "spaventato"
];

// ─────────────────────────────────────────────
// UTIL
// ─────────────────────────────────────────────

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCoherentAge(env: EnvironmentConfig) {
  return Math.floor(
    Math.random() * (env.maxAge - env.minAge + 1)
  ) + env.minAge;
}

function generateGender(age: number) {
  if (age < 1) return "N/D";
  return Math.random() > 0.5 ? "M" : "F";
}

function isPregnancyPossible(age: number, gender: string) {
  return gender === "F" && age >= 16 && age <= 45 && Math.random() < 0.2;
}

function initialSeverity(pathology: string): number {
  if (
    pathology.includes("Shock") ||
    pathology.includes("ARDS") ||
    pathology.includes("Emorragia")
  ) return 4;

  if (
    pathology.includes("Infarto") ||
    pathology.includes("Sepsi") ||
    pathology.includes("Ictus")
  ) return 3;

  return 2;
}

function vitalsBySeverity(severity: number) {
  if (severity <= 2)
    return { hr: 88, bp: "125/75", rr: 16, spo2: 98, temp: 36.8, consciousness: "vigile" };

  if (severity === 3)
    return { hr: 105, bp: "100/60", rr: 22, spo2: 94, temp: 38, consciousness: "vigile" };

  if (severity === 4)
    return { hr: 125, bp: "90/55", rr: 28, spo2: 90, temp: 39, consciousness: "confuso" };

  return { hr: 140, bp: "80/45", rr: 32, spo2: 85, temp: 39.5, consciousness: "soporoso" };
}

// ─────────────────────────────────────────────
// SYSTEM PROMPT AAA + SBAR
// ─────────────────────────────────────────────

const SYSTEM_PROMPT = `
Sei il motore narrativo di una simulazione clinica infermieristica realistica.

REGOLE FERREE:
- Non cambiare paziente.
- Non cambiare reparto.
- Minimo 5 turni.
- Se gravità alta può arrivare a 7.
- Pressione progressiva.
- Nessuna spiegazione didattica.

PRIMO TURNO OBBLIGATORIO:
Devi generare briefing SBAR completo.

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

VIETATO ASSOLUTO:
- NANDA
- NIC
- NOC
- Linguaggio scolastico

Solo JSON.

{
  "phase": "string",
  "turn": number,
  "patientUpdate": "string",
  "vitals": { hr, bp, rr, spo2, temp, consciousness },
  "availableActions": [
    { "id": "A", "label": "string" },
    { "id": "B", "label": "string" }
  ],
  "outcome": "ongoing | improved | critical | stabilized",
  "xpDelta": number
}
`.trim();

// ─────────────────────────────────────────────
// CREATE GAME COERENTE
// ─────────────────────────────────────────────

async function createGame(userId: string) {
  const environmentName = randomFrom(Object.keys(ENVIRONMENTS));
  const env = ENVIRONMENTS[environmentName];

  const pathology = randomFrom(env.pathologies);
  const age = generateCoherentAge(env);
  const gender = generateGender(age);
  const pregnant = isPregnancyPossible(age, gender);

  const severity = initialSeverity(pathology);

  const { data: game } = await supabase
    .from("simulation_games")
    .insert({
      user_id: userId,
      environment: environmentName,
      patient_name: "Paziente " + Math.floor(Math.random() * 9999),
      patient_age: age,
      patient_gender: gender,
      context: {
        pathology,
        personality: randomFrom(PERSONALITIES),
        severity,
        pregnant
      },
      turn: 1
    })
    .select()
    .single();

  await supabase.from("simulation_state").insert({
    game_id: game.id,
    vitals: vitalsBySeverity(severity)
  });

  return game;
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { action, userId, gameId, choice } = req.body;

    let game;

    if (action === "start") {
      game = await createGame(userId);
    } else {
      const { data } = await supabase
        .from("simulation_games")
        .select("*")
        .eq("id", gameId)
        .single();
      game = data;
    }

    const { data: state } = await supabase
      .from("simulation_state")
      .select("*")
      .eq("game_id", game.id)
      .single();

    const turn = action === "step" ? game.turn + 1 : 1;

    await supabase
      .from("simulation_games")
      .update({ turn })
      .eq("id", game.id);

    const userMessage = `
Reparto: ${game.environment}
Età: ${game.patient_age}
Genere: ${game.patient_gender}
Gravidanza: ${game.context?.pregnant ? "SI" : "NO"}
Patologia: ${game.context?.pathology}
Gravità: ${game.context?.severity}
Turno: ${turn}

Parametri:
${JSON.stringify(state.vitals)}

Scelta precedente: ${choice || "Nessuna"}

Evolvi la situazione.
`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        temperature: 1.1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage }
        ]
      })
    });

    const raw = await openaiRes.json();
    const content = raw.choices?.[0]?.message?.content;

    const simData = JSON.parse(content);

    const minTurns = 5;
    if (turn < minTurns) simData.outcome = "ongoing";

    return res.status(200).json({
      type: simData.outcome === "ongoing" ? "step" : "debrief",
      gameId: game.id,
      environment: game.environment,
      turn,
      ...simData
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Simulation error" });
  }
}
