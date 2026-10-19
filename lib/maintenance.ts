const TASKS=['known','catalog','discovery','recipes'] as const;
/** Round-robin persists before I/O: an unavailable source cannot monopolize every scheduler tick. */
export function nextMaintenanceTask(phase:number|undefined,available:Record<(typeof TASKS)[number],boolean>){
 const start=Number.isInteger(phase)?Math.abs(phase!)%TASKS.length:0;
 for(let offset=0;offset<TASKS.length;offset++){const index=(start+offset)%TASKS.length,task=TASKS[index];if(available[task])return {task,nextPhase:(index+1)%TASKS.length};}
}
export function catalogDiscoveryDue(source:{enabled:boolean;lastDiscovery?:string;nextDiscoveryAfter?:string},now=new Date()){
 return source.enabled&&!(Date.parse(source.nextDiscoveryAfter??'')>now.getTime())&&!(Date.parse(source.lastDiscovery??'')>now.getTime()-7*86400000);
}
