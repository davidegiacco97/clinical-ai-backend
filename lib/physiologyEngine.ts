import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
 process.env.SUPABASE_URL!,
 process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type PatientState = {
 [key: string]: number
}

export async function runSimulationTurn(
 simulationId: string,
 studentAction: string
) {

 // 1️⃣ CARICA STATO PAZIENTE
 const { data: stateRows } = await supabase
  .from('simulation_state')
  .select('*')
  .eq('simulation_id', simulationId)

 const state: PatientState = {}

 stateRows?.forEach((row:any)=>{
  state[row.parameter] = row.value
 })

 // 2️⃣ APPLICA DETERIORAMENTO NATURALE
 const { data: deteriorationRules } = await supabase
  .from('physiology_deterioration')
  .select('*')

 deteriorationRules?.forEach((rule:any)=>{
  const param = rule.parameter_name

  if(state[param] !== undefined){
   state[param] += rule.delta_per_turn
  }
 })

 // 3️⃣ TROVA AZIONE
 const { data: action } = await supabase
  .from('clinical_actions')
  .select('*')
  .ilike('name', `%${studentAction}%`)
  .single()

 if(action){

  const { data: rules } = await supabase
   .from('physiology_rules')
   .select('*')
   .eq('action_name', action.name)

  // 4️⃣ APPLICA REGOLE FISIOLOGICHE

  rules?.forEach((rule:any)=>{

   const param = rule.parameter_name

   if(state[param] !== undefined){

    const random = Math.random()

    if(random <= rule.probability){

     state[param] += rule.effect

    }

   }

  })

 }

 // 5️⃣ CONTROLLA VALORI CRITICI

 const { data: parameters } = await supabase
  .from('physiology_parameters')
  .select('*')

 let patientDead = false

 parameters?.forEach((p:any)=>{

  const value = state[p.name]

  if(value === undefined) return

  if(value < p.critical_min || value > p.critical_max){

   patientDead = true

  }

 })

 // 6️⃣ SALVA NUOVO STATO

 for(const param in state){

  await supabase
   .from('simulation_state')
   .update({ value: state[param] })
   .eq('simulation_id', simulationId)
   .eq('parameter', param)

 }

 // 7️⃣ RISULTATO TURNO

 return {
  state,
  patientDead
 }

}
