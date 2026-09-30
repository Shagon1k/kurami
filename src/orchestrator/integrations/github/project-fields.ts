import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type ProjectFieldSnapshot = {
  projectId: string; fieldId: string; itemId: string; itemProjectId: string;
  archived: boolean; kind: string; repository: string | null;
  status: string | null; optionId: string | null; updatedAt: string;
  options: { id: string; name: string }[];
};
export type ProjectFieldRead = { owner: string; number: number; fieldName: string; itemId: string };
export type ProjectFieldWrite = { projectId: string; fieldId: string; itemId: string; optionId: string; mutationId: string };
export type ProjectFieldClient = { read: (input: ProjectFieldRead) => Promise<ProjectFieldSnapshot>; write: (input: ProjectFieldWrite) => Promise<void> };
const exec = promisify(execFile);

async function graphql(query: string, variables: Record<string,string|number>): Promise<unknown> {
  const args = ["api","graphql","-f",`query=${query}`];
  for (const [name,value] of Object.entries(variables)) args.push(typeof value === "number" ? "-F" : "-f",`${name}=${value}`);
  const { stdout } = await exec(process.env.KURAMI_GH_BIN ?? "gh",args,{ encoding: "utf8", env: process.env, timeout: 8_000, maxBuffer: 1_048_576 });
  const response = JSON.parse(stdout) as { errors?: unknown[]; data?: unknown };
  if (response.errors?.length || !response.data) throw new Error("GitHub Projects response unavailable");
  return response.data;
}

export const READ_PROJECT_FIELD = `query ProjectsStatus($owner:String!,$number:Int!,$fieldName:String!,$item:ID!) {
  user(login:$owner) { projectV2(number:$number) { id field(name:$fieldName) {
    ... on ProjectV2SingleSelectField { id options { id name } }
  } } }
  node(id:$item) { ... on ProjectV2Item {
    id isArchived updatedAt project { id }
    content { __typename ... on Issue { repository { nameWithOwner } } ... on PullRequest { repository { nameWithOwner } } }
    fieldValueByName(name:$fieldName) { ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2SingleSelectField { id } } } }
  } }
}`;
export const WRITE_PROJECT_FIELD = `mutation ProjectsStatus($project:ID!,$item:ID!,$field:ID!,$option:String!,$mutationId:String!) {
  updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option},clientMutationId:$mutationId}) {
    clientMutationId projectV2Item { id }
  }
}`;

export const githubProjectFields: ProjectFieldClient = {
  async read(input) {
    const data = await graphql(READ_PROJECT_FIELD,{ owner:input.owner,number:input.number,fieldName:input.fieldName,item:input.itemId }) as {
      user?: { projectV2?: { id?: string; field?: { id?: string; options?: {id:string;name:string}[] } } };
      node?: { id?: string; isArchived?: boolean; updatedAt?: string; project?: {id?:string}; content?: {__typename?:string;repository?:{nameWithOwner?:string}};
        fieldValueByName?: {name?:string;optionId?:string;field?:{id?:string}} | null };
    };
    const project = data.user?.projectV2; const field = project?.field; const item = data.node; const value = item?.fieldValueByName;
    if (!project?.id || !field?.id || !Array.isArray(field.options) || !item?.id || !item.project?.id || typeof item.isArchived !== "boolean" ||
      !item.updatedAt || !Number.isFinite(Date.parse(item.updatedAt)) || !item.content?.__typename ||
      field.options.some(option => typeof option.id !== "string" || !option.id || typeof option.name !== "string" || !option.name) ||
      value && (value.field?.id !== field.id || typeof value.name !== "string" || typeof value.optionId !== "string" ||
        field.options.filter(option => option.id === value.optionId && option.name === value.name).length !== 1))
      throw new Error("GitHub Project field identity unavailable");
    return { projectId:project.id,fieldId:field.id,itemId:item.id,itemProjectId:item.project.id,archived:item.isArchived,
      kind:item.content.__typename,repository:item.content.repository?.nameWithOwner ?? null,status:value?.name ?? null,
      optionId:value?.optionId ?? null,updatedAt:item.updatedAt,options:field.options };
  },
  async write(input) {
    const data = await graphql(WRITE_PROJECT_FIELD,{ project:input.projectId,item:input.itemId,field:input.fieldId,option:input.optionId,mutationId:input.mutationId }) as
      { updateProjectV2ItemFieldValue?: {clientMutationId?:string;projectV2Item?:{id?:string}} };
    if (data.updateProjectV2ItemFieldValue?.projectV2Item?.id !== input.itemId || data.updateProjectV2ItemFieldValue.clientMutationId !== input.mutationId)
      throw new Error("GitHub status mutation could not be confirmed");
  },
};
