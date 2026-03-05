import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
 process.env.SUPABASE_URL!,
 process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function generateScenario(){

 const { data:templates } =
 await supabase.from("scenario_templates").select("*")

 const template =
 templates[Math.floor(Math.random()*templates.length)]

 const { data:patients } =
 await supabase.from("patient_profiles").select("*")

 const patient =
 patients[Math.floor(Math.random()*patients.length)]

 const { data:complications } =
 await supabase
  .from("complication_sets")
  .select("*")
  .eq("pathology",template.pathology)

 const complication =
 complications[Math.floor(Math.random()*complications.length)]

 return {

  template,
  patient,
  complication

 }

}
