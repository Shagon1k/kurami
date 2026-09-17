export type StockAsset={id:string;symbol:string;name:string;isin:string;currency:"USD"|"EUR";exchange:"US"|"XETRA";timezone:string;kind:"stock"|"etf";listedFrom?:string};
export type StocksConfig={enabled:boolean;assets:StockAsset[];benchmark:string;moveThresholdPercent:number;error?:string};
export function parseStocksConfig(value:unknown):StocksConfig {
  const off:StocksConfig={enabled:false,assets:[],benchmark:"",moveThresholdPercent:2};
  if(value===undefined)return off;
  try {
    if(!value||typeof value!=="object"||Array.isArray(value))throw Error();
    const raw=value as StocksConfig;
    if(typeof raw.enabled!=="boolean"||!Array.isArray(raw.assets)||raw.assets.length<1||raw.assets.length>12
      ||typeof raw.benchmark!=="string"||!Number.isFinite(raw.moveThresholdPercent)||raw.moveThresholdPercent<0||raw.moveThresholdPercent>20)throw Error();
    const seen=new Set<string>();
    const assets=raw.assets.map(a=>{
      if(!a||typeof a.id!=="string"||!/^[A-Z][A-Z0-9.-]{0,15}$/.test(a.id)||seen.has(a.id)
        ||typeof a.symbol!=="string"||!/^[A-Z0-9-]+\.(US|XETRA)$/.test(a.symbol)
        ||typeof a.name!=="string"||!a.name.trim()||a.name.length>100||!/^[A-Z]{2}[A-Z0-9]{10}$/.test(a.isin)
        ||!["USD","EUR"].includes(a.currency)||!["US","XETRA"].includes(a.exchange)||a.symbol!==a.id+"."+a.exchange
        ||!["stock","etf"].includes(a.kind))throw Error();
      new Intl.DateTimeFormat("en",{timeZone:a.timezone});
      if(a.listedFrom&&!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(a.listedFrom))throw Error();
      seen.add(a.id);
      return {id:a.id,symbol:a.symbol,name:a.name,isin:a.isin,currency:a.currency,exchange:a.exchange,timezone:a.timezone,kind:a.kind,...(a.listedFrom?{listedFrom:a.listedFrom}:{})};
    });
    if(!seen.has(raw.benchmark))throw Error();
    return {enabled:raw.enabled,assets,benchmark:raw.benchmark,moveThresholdPercent:raw.moveThresholdPercent};
  } catch {return {...off,error:"invalid_stocks_config"};}
}
