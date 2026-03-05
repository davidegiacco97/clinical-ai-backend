import { createClient } from "@supabase/supabase-js"
import { generateDebriefing } from "@/lib/debriefingEngine"

const supabase = createClient(
 process.env.SUPABASE_URL!,
 process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export default async function handler(req,res){

 const { simulationId } = req.body

 const { data:actions } =
 await supabase
  .from("simulation_actions")
  .select("*")
  .eq("simulation_id",simulationId)

 const { data:simulation } =
 await supabase
  .from("simulations")
  .select("*")
  .eq("id",simulationId)
  .single()

 const debriefing =
 await generateDebriefing(actions,simulation)

 await supabase
  .from("simulation_debriefings")
  .insert({

   simulation_id:simulationId,

   reflection:debriefing.reflection,

   clinical_reasoning:debriefing.clinical_reasoning,

   strengths:debriefing.strengths,

   improvements:debriefing.improvements

  })

 return res.json(debriefing)

}
