export function rampedDailyLimit(maximum:number,initial:number,startedAt:string,at=new Date()) {
  const elapsed=at.getTime()-Date.parse(startedAt);
  const weeks=Number.isFinite(elapsed)?Math.max(0,Math.floor(elapsed/(7*86400000))):0;
  return Math.min(maximum,initial+weeks*5);
}
