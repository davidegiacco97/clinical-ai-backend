import { runSimulationTurn } from "@/lib/physiologyEngine"

export default async function handler(req,res){

 if(req.method !== "POST"){
  return res.status(405).json({error:"Method not allowed"})
 }

 const { simulationId, action } = req.body

 const result = await runSimulationTurn(simulationId,action)

 return res.json(result)

}
