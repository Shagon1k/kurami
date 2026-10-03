import {existsSync,lstatSync} from "node:fs";
import {resolve} from "node:path";
import {readDeploymentManifest} from "./changelog.ts";

/** A missing controller assertion permits docs-only publication; a pending/invalid one fails closed. */
export function existingDeploymentManifest(home:string):string|undefined {
  const path=resolve(home,"state/web/deployment.json");
  if(!existsSync(path))return undefined;
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error("Controller manifest must be a private regular file");
  readDeploymentManifest(path);return path;
}
