export function compactNumber(amount:number|null|undefined):string {
  if(amount==null||!Number.isFinite(amount))return "—";
  const magnitude=Math.abs(amount);
  const rounded=Number(magnitude.toPrecision(3));
  const [divisor,suffix]=rounded>=1e9?[1e9,"B"]:rounded>=1e6?[1e6,"M"]:rounded>=1e3?[1e3,"K"]:[1,""];
  return new Intl.NumberFormat("en-US",{maximumFractionDigits:divisor===1?0:1}).format(amount/divisor)+suffix;
}

export function estimatedUsd(amount:number|null|undefined):string {
  if(amount==null||!Number.isFinite(amount))return "—";
  if(amount>0&&amount<.01)return "~ <$0.01";
  return "~ "+new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(amount);
}
