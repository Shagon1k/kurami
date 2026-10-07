// Creates a backlog issue from the phone: the issue in the project's repository, then (for a managed
// project) its card on the GitHub Project in the Backlog column, so the poller picks it up like any other.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type BacklogTarget = { repository: string; board?: { owner: string; number: number; statusField: string; backlog: string } };
export type BacklogIssue = { number: number; url: string; onBoard: boolean };
export type BacklogClient = { create(target: BacklogTarget, title: string, body: string, labels?: string[]): Promise<BacklogIssue> };
const exec = promisify(execFile);

async function gh(args: string[], input?: unknown): Promise<any> {
  const child = exec(process.env.KURAMI_GH_BIN ?? "gh", args, { env: process.env, timeout: 10_000, maxBuffer: 1_048_576, encoding: "utf8" });
  if (input !== undefined) child.child.stdin!.end(JSON.stringify(input));
  const value = JSON.parse((await child).stdout);
  if (value?.errors?.length) throw new Error("GitHub rejected the request");
  return value;
}

const BOARD = `query Board($owner:String!,$number:Int!,$field:String!) { user(login:$owner) { projectV2(number:$number) { id
  field(name:$field) { ... on ProjectV2SingleSelectField { id options { id name } } } } } }`;
const ADD = `mutation Add($project:ID!,$content:ID!) { addProjectV2ItemById(input:{projectId:$project,contentId:$content}) { item { id } } }`;
const SET = `mutation Set($project:ID!,$item:ID!,$field:ID!,$option:String!) { updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}) { projectV2Item { id } } }`;

export const githubBacklog: BacklogClient = {
  async create(target, title, body, labels = []) {
    const issue = await gh(["api", `repos/${target.repository}/issues`, "--method", "POST", "--input", "-"], labels.length ? { title, body, labels } : { title, body }) as { number?: number; html_url?: string; node_id?: string };
    if (!Number.isInteger(issue.number) || typeof issue.html_url !== "string" || typeof issue.node_id !== "string") throw new Error("GitHub issue response unavailable");
    if (!target.board) return { number: issue.number!, url: issue.html_url, onBoard: false };
    // The issue exists either way; a board failure is reported, not retried, so it is never created twice.
    try {
      const { owner, number, statusField, backlog } = target.board;
      const board = (await gh(["api", "graphql", "-f", `query=${BOARD}`, "-f", `owner=${owner}`, "-F", `number=${number}`, "-f", `field=${statusField}`])).data?.user?.projectV2;
      const option = board?.field?.options?.find((entry: { name: string }) => entry.name === backlog);
      if (!board?.id || !board.field?.id || !option) throw new Error("board");
      const item = (await gh(["api", "graphql", "-f", `query=${ADD}`, "-f", `project=${board.id}`, "-f", `content=${issue.node_id}`])).data?.addProjectV2ItemById?.item?.id;
      if (!item) throw new Error("board");
      await gh(["api", "graphql", "-f", `query=${SET}`, "-f", `project=${board.id}`, "-f", `item=${item}`, "-f", `field=${board.field.id}`, "-f", `option=${option.id}`]);
      return { number: issue.number!, url: issue.html_url, onBoard: true };
    } catch { return { number: issue.number!, url: issue.html_url, onBoard: false }; }
  },
};
