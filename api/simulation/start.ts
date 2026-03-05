import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
 process.env.SUPABASE_URL!,
 process.env.SUPABASE_SERVICE_KEY!
)

export default async function handler(req, res) {

 const patient = {
  description: "Uomo 72 anni, dispnoico, sudato, agitato.",
  vitals: {
   hr: 112,
   bp_systolic: 92,
   bp_diastolic: 58,
   spo2: 86,
   rr: 30,
   temp: 38.2,
   ph: 7.31,
   paco2: 55,
   pao2: 60,
   lactate: 2.1,
   potassium: 4.3,
   urine_output: 20,
   consciousness: "confused"
  }
 }

 const { data: simulation } = await supabase
  .from("simulations")
  .insert({
   scenario: "respiratory_failure",
   patient_description: patient.description
  })
  .select()
  .single()

 await supabase.from("physiology_state").insert({
  simulation_id: simulation.id,
  ...patient.vitals
 })

 res.json({
  simulation_id: simulation.id,
  patient
 })
}
