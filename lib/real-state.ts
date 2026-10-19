type LegacyState={offers:Array<{demo?:boolean}>;history:Array<{input:{demo?:boolean};result?:{shopping?:Array<{offer:{demo?:boolean}}>}}> ;input?:{demo?:boolean}};
export function removeSyntheticData<T extends LegacyState>(state:T):T {
  return {...state,offers:state.offers.filter(o=>o.demo!==true),history:state.history.filter(p=>p.input.demo!==true&&!p.result?.shopping?.some(i=>i.offer.demo===true)),input:state.input?.demo===true?undefined:state.input};
}
