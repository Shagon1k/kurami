import {createPublicKey,verify} from "node:crypto";
import type {IncomingMessage} from "node:http";
import {fetchAccessKeys,AccessVerificationUnavailableError,type AccessKey} from "../web/access-keys.ts";

export class HubAccess {
  private keys:{at:number;keys:AccessKey[]}|null=null;
  private team:string;
  private audience:string;
  private fetchKeys:typeof fetch;
  constructor(team="",audience="",fetchKeys=fetch){this.team=team;this.audience=audience;this.fetchKeys=fetchKeys;}
  async authorize(request:IncomingMessage):Promise<string|null> {
    if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(this.team)||!this.audience)return null;
    const token=request.headers["cf-access-jwt-assertion"];
    if(typeof token!=="string"||token.length>16000)return null;
    try {
      const parts=token.split(".");if(parts.length!==3)return null;
      const header=JSON.parse(Buffer.from(parts[0]!,"base64url").toString());
      const claims=JSON.parse(Buffer.from(parts[1]!,"base64url").toString());
      const now=Date.now()/1000;
      if(header.alg!=="RS256"||claims.iss!==this.team||!Array.isArray(claims.aud)||!claims.aud.includes(this.audience)||
        !Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.nbf)||claims.nbf>now+30||typeof claims.sub!=="string"||!claims.sub)return null;
      if(!this.keys||Date.now()-this.keys.at>3600_000||!this.keys.keys.some(key=>key.kid===header.kid)){
        this.keys={at:Date.now(),keys:await fetchAccessKeys(this.team,this.fetchKeys)};
      }
      if(claims.exp<=Date.now()/1000)return null;
      const key=this.keys.keys.find(key=>key.kid===header.kid&&key.kty==="RSA");if(!key)return null;
      if(!verify("RSA-SHA256",Buffer.from(parts[0]+"."+parts[1]),createPublicKey({key:key as any,format:"jwk"}),Buffer.from(parts[2]!,"base64url")))return null;
      return claims.sub;
    }catch(error){if(error instanceof AccessVerificationUnavailableError)throw error;return null;}
  }
}
