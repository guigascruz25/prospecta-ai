// Official OpenAI model documentation checked on 2026-10-28. Standard text rates.
export const openaiModelOptions = [
  {id:'gpt-6-luna',label:'GPT-6 Luna',description:'Sugestão econômica para pesquisa e respostas.',input:0.1,output:0.5},
  {id:'gpt-5.4-mini-2026-03-17',label:'GPT-5.4 Mini',description:'Alternativa para pesquisa e decisões comerciais.',input:0.75,output:4.5},
] as const;
export const recommendedOpenAIModel = openaiModelOptions[0];
// Short structured tasks need their output budget available for the answer.
// Preserve provider defaults for existing/custom IDs that may not accept this option.
export function structuredModelOptions(id:string) {
  return id==='gpt-6-luna'?{reasoning:{effort:'none' as const}}:{};
}
export function researchInputReservation(id:string) {
  return id==='gpt-6-luna'?1050000:400000;
}
export function modelOption(id:string) {
  return openaiModelOptions.find(model=>model.id===id||model.id.replace(/-\d{4}-\d{2}-\d{2}$/,'')===id);
}
// The local budget currently uses one price pair for both models. Take the higher
// rate of each, so selecting two different suggestions cannot underprice either.
export function suggestedModelRates(research:string,replies:string) {
  const rateFor=(id:string)=>modelOption(id)||(/^gpt-5\.4-nano(?:-2026-03-17)?$/.test(id)?{input:0.2,output:1.25}:undefined);
  const models=[rateFor(research),rateFor(replies)];
  if(models.some(model=>!model))return null;
  return {input:Math.max(...models.map(model=>model!.input)),output:Math.max(...models.map(model=>model!.output))};
}
