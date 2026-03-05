import { generateScenario } from "@/lib/scenarioGenerator"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
 process.env.SUPABASE_URL!,
 process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req,res){

 const scenario = await generateScenario()

 const { data } = await supabase
  .from("simulations")
  .insert({

   template_id:scenario.template.id,
   patient_id:scenario.patient.id,
   complication_id:scenario.complication.id

  })
  .select()
  .single()

 return res.json({

  simulationId:data.id,
  scenario

 })

}
