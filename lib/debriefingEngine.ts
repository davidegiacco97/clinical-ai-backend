import OpenAI from "openai"

const openai = new OpenAI({
 apiKey: process.env.OPENAI_API_KEY
})

export async function generateDebriefing(actions,scenario){

 const actionLog = actions
   .map(a => `Turno ${a.turn}: ${a.student_action}`)
   .join("\n")

 const prompt = `
Sei un istruttore clinico di simulazione infermieristica.

Analizza questa simulazione.

SCENARIO
${scenario}

AZIONI STUDENTE
${actionLog}

Crea un debriefing educativo NON giudicante.

Formato JSON:

{
reflection:"",
clinical_reasoning:"",
strengths:[],
improvements:[]
}

Linee guida:
- spiega la fisiopatologia
- collega le decisioni ai parametri vitali
- evidenzia priorità ABCDE
- mantieni tono costruttivo
`

 const response = await openai.chat.completions.create({

   model:"gpt-5-nano",

   response_format:{ type:"json_object" },

   messages:[
    {role:"system",content:"Clinical simulation educator"},
    {role:"user",content:prompt}
   ]

 })

 return JSON.parse(response.choices[0].message.content)

}
