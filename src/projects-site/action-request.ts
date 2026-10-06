type Kind="review"|"action"|"status";
type ResponseBody=Record<string,unknown>;
type RequestOptions={kind:Kind;path:string;body:unknown;timeout:number;unconfirmed:string;
  response:(body:ResponseBody,response:Response)=>void|Promise<void>;error?:()=>void;after?:()=>void|Promise<void>};
type Environment={busy:()=>boolean;setBusy:(kind:Kind,value:boolean)=>void;headers:Record<string,string>;
  url:(path:string)=>string;notify:(message:string,tone:string)=>void;fetcher?:typeof fetch};

/** Owns transport and busy cleanup; each operation retains its receipt and refresh policy. */
export function createProjectActionRequest(environment:Environment) {
  let locked=false;
  return async(button:HTMLButtonElement,options:RequestOptions)=>{
    if(button.disabled||locked||environment.busy())return;
    locked=true;environment.setBusy(options.kind,true);button.setAttribute("aria-busy","true");
    try {
      const response=await (environment.fetcher??fetch)(environment.url(options.path),{
        method:"POST",headers:environment.headers,body:JSON.stringify(options.body),signal:AbortSignal.timeout(options.timeout),
      });
      const body=await response.json() as ResponseBody;
      await options.response(body,response);
    } catch(error) {
      const failure=error as Error;
      environment.notify(["TimeoutError","TypeError"].includes(failure.name)?options.unconfirmed:failure.message,"failure");
      options.error?.();
    } finally {
      locked=false;environment.setBusy(options.kind,false);button.removeAttribute("aria-busy");
      await options.after?.();
    }
  };
}
export const PROJECT_ACTION_REQUEST_JS=`const createProjectActionRequest=${createProjectActionRequest.toString()};\n`;
