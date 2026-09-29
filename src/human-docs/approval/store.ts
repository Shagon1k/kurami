// Durable state for owner-approved docs proposals. A small SQLite file next to the docs release,
// separate from the orchestrator database and its migrations.
import {mkdirSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {resolveKuramiHome} from "../../core/kurami-home.ts";
import type {PageChange,ProposalState} from "./policy.ts";

export const DEFAULT_KURAMI_HOME="/home/shagon1k/_hermes/_kurami";

export function kuramiHome():string {
  return resolveKuramiHome(DEFAULT_KURAMI_HOME);
}

export function docsStateDir(home=kuramiHome()):string {
  return resolve(home,"state/human-docs");
}

export type ProposalRow={
  proposal_id:string;
  state:ProposalState;
  created_at:string;
  updated_at:string;
  draft_path:string;
  summary_path:string;
  branch:string;
  base_sha:string;
  head_sha:string|null;
  pr_number:number|null;
  pr_url:string|null;
  summary_ru:string|null;
  summary_en:string|null;
  pages_json:string|null;
  card_channel_id:string|null;
  card_message_id:string|null;
  thread_id:string|null;
  revision_count:number;
  remarks_after_message_id:string|null;
  requested_by:string|null;
  requested_at:string|null;
  requested_head_sha:string|null;
  merged_sha:string|null;
  published_docs_sha:string|null;
  rollback_dir:string|null;
  last_error:string|null;
  cleaned_at:string|null;
};

const SCHEMA=`
CREATE TABLE IF NOT EXISTS docs_proposals(
  proposal_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  draft_path TEXT NOT NULL,
  summary_path TEXT NOT NULL,
  branch TEXT NOT NULL UNIQUE,
  base_sha TEXT NOT NULL,
  head_sha TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  summary_ru TEXT,
  summary_en TEXT,
  pages_json TEXT,
  card_channel_id TEXT,
  card_message_id TEXT,
  thread_id TEXT,
  revision_count INTEGER NOT NULL DEFAULT 0,
  remarks_after_message_id TEXT,
  requested_by TEXT,
  requested_at TEXT,
  requested_head_sha TEXT,
  merged_sha TEXT,
  published_docs_sha TEXT,
  rollback_dir TEXT,
  last_error TEXT,
  cleaned_at TEXT
);
CREATE TABLE IF NOT EXISTS docs_proposal_events(
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id TEXT NOT NULL REFERENCES docs_proposals(proposal_id),
  at TEXT NOT NULL,
  type TEXT NOT NULL,
  details_json TEXT NOT NULL
);`;

export class ProposalStore {
  readonly database:DatabaseSync;
  readonly #now:()=>Date;

  constructor(path:string,now:()=>Date=()=>new Date()){
    mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.database=new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
    this.database.exec(SCHEMA);
    this.#now=now;
  }

  static open(home=kuramiHome(),now?:()=>Date):ProposalStore {
    return new ProposalStore(resolve(docsStateDir(home),"proposals.db"),now);
  }

  close():void {this.database.close();}

  now():string {return this.#now().toISOString();}

  create(row:Pick<ProposalRow,"proposal_id"|"draft_path"|"summary_path"|"branch"|"base_sha">):ProposalRow {
    const at=this.now();
    this.database.prepare(`INSERT INTO docs_proposals(proposal_id,state,created_at,updated_at,draft_path,summary_path,branch,base_sha)
      VALUES(?,?,?,?,?,?,?,?)`).run(row.proposal_id,"drafting",at,at,row.draft_path,row.summary_path,row.branch,row.base_sha);
    this.event(row.proposal_id,"created",{branch:row.branch,baseSha:row.base_sha});
    return this.get(row.proposal_id);
  }

  find(proposalId:string):ProposalRow|undefined {
    return this.database.prepare("SELECT * FROM docs_proposals WHERE proposal_id=?").get(proposalId) as ProposalRow|undefined;
  }

  get(proposalId:string):ProposalRow {
    const row=this.find(proposalId);
    if(!row)throw new Error(`Docs proposal not found: ${proposalId}`);
    return row;
  }

  inStates(states:readonly ProposalState[]):ProposalRow[] {
    return this.database.prepare(`SELECT * FROM docs_proposals WHERE state IN (${states.map(()=>"?").join(",")}) ORDER BY created_at`).all(...states) as ProposalRow[];
  }

  needingCleanup(states:readonly ProposalState[]):ProposalRow[] {
    return this.inStates(states).filter(row=>!row.cleaned_at);
  }

  /** Update fields; with `from`, only when the row is still in one of those states (a stale click or tick loses). */
  update(proposalId:string,fields:Partial<Omit<ProposalRow,"proposal_id"|"created_at">>,from?:readonly ProposalState[]):boolean {
    const entries=Object.entries({...fields,updated_at:this.now()});
    const assignments=entries.map(([key])=>`${key}=?`).join(",");
    const values=entries.map(([,value])=>value as string|number|null);
    const guard=from?` AND state IN (${from.map(()=>"?").join(",")})`:"";
    const result=this.database.prepare(`UPDATE docs_proposals SET ${assignments} WHERE proposal_id=?${guard}`).run(...values,proposalId,...(from??[]));
    return Number(result.changes)===1;
  }

  event(proposalId:string,type:string,details:unknown):void {
    this.database.prepare("INSERT INTO docs_proposal_events(proposal_id,at,type,details_json) VALUES(?,?,?,?)").run(proposalId,this.now(),type,JSON.stringify(details));
  }

  events(proposalId:string):Array<{type:string;details:unknown}> {
    return (this.database.prepare("SELECT type,details_json FROM docs_proposal_events WHERE proposal_id=? ORDER BY event_id").all(proposalId) as Array<{type:string;details_json:string}>)
      .map(row=>({type:row.type,details:JSON.parse(row.details_json)}));
  }
}

export function pagesOf(row:ProposalRow):PageChange[] {
  return row.pages_json?JSON.parse(row.pages_json) as PageChange[]:[];
}
