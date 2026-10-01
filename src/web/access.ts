import type {IncomingMessage} from "node:http";
import {ProjectsAccess} from "../projects-site/access.ts";
import {HubAccess} from "../hub/access.ts";
import type {WebApp} from "./routes.ts";

export type WebIdentity={actor:string;scope:"owner"|"docs-reader"};

/** Reuse signed-assertion validation, but never widen Docs service identities to owner scope. */
export class WebAccess {
  private owner:ProjectsAccess;
  private docs:HubAccess;
  constructor(environment:NodeJS.ProcessEnv=process.env){
    this.owner=new ProjectsAccess({team:environment.KURAMI_WEB_ACCESS_TEAM??"",audience:environment.KURAMI_WEB_ACCESS_AUDIENCE??"",ownerEmail:environment.KURAMI_WEB_OWNER_EMAIL??"",identityPolicy:"access"});
    this.docs=new HubAccess(environment.KURAMI_WEB_ACCESS_TEAM??"",environment.KURAMI_WEB_DOCS_AUDIENCE??"");
  }
  async authorize(request:IncomingMessage,app:WebApp):Promise<WebIdentity|null>{
    const owner=await this.owner.authorize(request);
    if(owner)return {actor:owner,scope:"owner"};
    if(app!=="docs"||!["GET","HEAD"].includes(request.method??""))return null;
    const reader=await this.docs.authorize(request);
    return reader?{actor:reader,scope:"docs-reader"}:null;
  }
}
