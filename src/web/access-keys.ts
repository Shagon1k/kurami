import type {JsonWebKeyInput} from "node:crypto";

export type AccessKey=JsonWebKeyInput["key"] & {kid:string};
export const ACCESS_KEYS_TIMEOUT_MS=15_000;

export class AccessVerificationUnavailableError extends Error {
  constructor(){super("Access verification temporarily unavailable");this.name="AccessVerificationUnavailableError";}
}

export function accessUnavailableMessage(language:"en"|"ru"):string {
  return language==="ru"
    ? "Проверка входа временно недоступна. Обнови страницу через несколько секунд."
    : "Sign-in verification is temporarily unavailable. Refresh the page in a few seconds.";
}

/** Only successfully fetched public keys can be used to verify an assertion. */
export async function fetchAccessKeys(team:string,fetchKeys:typeof fetch=fetch):Promise<AccessKey[]> {
  try {
    const response=await fetchKeys(`${team}/cdn-cgi/access/certs`,{signal:AbortSignal.timeout(ACCESS_KEYS_TIMEOUT_MS),redirect:"error"});
    if(!response.ok)throw new AccessVerificationUnavailableError();
    const raw=await response.text();
    if(raw.length>65_536)throw new AccessVerificationUnavailableError();
    const body=JSON.parse(raw) as {keys?:AccessKey[]};
    if(!Array.isArray(body.keys)||body.keys.length>16)throw new AccessVerificationUnavailableError();
    return body.keys.filter(key=>key&&typeof key.kid==="string"&&key.kty==="RSA");
  }catch{throw new AccessVerificationUnavailableError();}
}
