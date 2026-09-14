// Shared GitHub review-thread boundary for review and session workflows.
export type ReviewThreadComment = {
  databaseId: number;
  authorLogin: string;
  body: string;
  url: string;
};

export type ActionableReviewThread = {
  threadId: string;
  rootCommentId: number;
  sourceKind: "ai" | "owner";
  reviewId: string | null;
  findingNumber: number | null;
  path: string;
  line: number | null;
  rootBody: string;
  ownerReplies: string[];
  url: string;
};

type GraphQlComment = {
  databaseId?: number | null;
  body?: string | null;
  url?: string | null;
  author?: { login?: string | null } | null;
};
type GraphQlThread = {
  id?: string;
  isResolved?: boolean;
  isOutdated?: boolean;
  path?: string | null;
  line?: number | null;
  comments?: {
    nodes?: GraphQlComment[] | null;
    pageInfo?: { hasNextPage?: boolean } | null;
  } | null;
};

function fail(message: string): never {
  throw new Error(message);
}

function boundedBody(value: string | null | undefined): string {
  const body = value?.trim();
  if (!body) fail("Review thread contains an empty comment");
  return body.slice(0, 4_000);
}

function findingMarker(body: string): { reviewId: string; findingNumber: number; headSha: string } | null {
  const match = /<!--\s*kurami-ai-finding:(air_[a-f0-9]+):(\d+);head=([a-f0-9]{7,64})\s*-->/iu.exec(
    body,
  );
  const findingNumber = Number(match?.[2]);
  return match && Number.isInteger(findingNumber) && findingNumber > 0
    ? { reviewId: match[1]!, findingNumber, headSha: match[3]!.toLowerCase() }
    : null;
}

function normalizedLogin(value: string): string {
  return value.trim().toLowerCase().replace(/\[bot\]$/u, "");
}

export function selectActionableReviewThreads(
  threads: GraphQlThread[],
  ownerLogin: string,
  headSha: string,
  validReviewIds: ReadonlySet<string>,
): ActionableReviewThread[] {
  const owner = normalizedLogin(ownerLogin);
  const selected: ActionableReviewThread[] = [];
  for (const thread of threads) {
    if (thread.isResolved || thread.isOutdated) continue;
    if (thread.comments?.pageInfo?.hasNextPage)
      fail("A review thread exceeds the bounded 100-comment snapshot");
    const comments = thread.comments?.nodes ?? [];
    const root = comments[0];
    const threadId = thread.id?.trim();
    const rootId = Number(root?.databaseId);
    const rootAuthor = normalizedLogin(root?.author?.login ?? "");
    const rootBody = boundedBody(root?.body);
    if (!threadId || !Number.isInteger(rootId) || rootId <= 0 || !thread.path)
      fail("GitHub returned an incomplete review thread");
    const marker = findingMarker(rootBody);
    const ai = Boolean(
      rootAuthor === "kurami-ai" &&
        marker &&
        marker.headSha === headSha.toLowerCase() &&
        validReviewIds.has(marker.reviewId),
    );
    const owned = rootAuthor === owner;
    if (!ai && !owned) continue;
    const ownerReplies = comments
      .slice(1)
      .filter((comment) => normalizedLogin(comment.author?.login ?? "") === owner)
      .map((comment) => boundedBody(comment.body));
    selected.push({
      threadId,
      rootCommentId: rootId,
      sourceKind: ai ? "ai" : "owner",
      reviewId: ai ? marker!.reviewId : null,
      findingNumber: ai ? marker!.findingNumber : null,
      path: thread.path.slice(0, 500),
      line: Number.isInteger(thread.line) && Number(thread.line) > 0 ? Number(thread.line) : null,
      rootBody,
      ownerReplies,
      url: root?.url?.trim().slice(0, 1_000) ?? "",
    });
  }
  if (selected.length > 20) fail("Review fix exceeds the 20-thread safety limit");
  return selected;
}

async function githubRequest(
  token: string,
  url: string,
  init: RequestInit,
  fetchImplementation: typeof fetch,
): Promise<unknown> {
  const response = await fetchImplementation(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "kurami-orchestrator",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const details = (await response.text()).trim().slice(0, 500);
    fail(`GitHub review-thread request failed: HTTP ${response.status}${details ? `; ${details}` : ""}`);
  }
  return response.json();
}

export async function fetchActionableReviewThreads(
  token: string,
  repository: string,
  pullRequestNumber: number,
  ownerLogin: string,
  headSha: string,
  validReviewIds: ReadonlySet<string>,
  fetchImplementation: typeof fetch = fetch,
): Promise<ActionableReviewThread[]> {
  const [owner, name] = repository.split("/");
  if (!owner || !name) fail("Invalid repository name");
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{id isResolved isOutdated path line comments(first:100){nodes{databaseId body url author{login}} pageInfo{hasNextPage}}} pageInfo{hasNextPage}}}}}`;
  const result = (await githubRequest(
    token,
    "https://api.github.com/graphql",
    { method: "POST", body: JSON.stringify({ query, variables: { owner, name, number: pullRequestNumber } }) },
    fetchImplementation,
  )) as {
    errors?: unknown[];
    data?: { repository?: { pullRequest?: { reviewThreads?: { nodes?: GraphQlThread[]; pageInfo?: { hasNextPage?: boolean } } } } };
  };
  if (result.errors?.length) fail("GitHub GraphQL returned review-thread errors");
  const connection = result.data?.repository?.pullRequest?.reviewThreads;
  if (!connection) fail("Pull request review threads are unavailable");
  if (connection.pageInfo?.hasNextPage)
    fail("Pull request exceeds the bounded 100-thread snapshot");
  return selectActionableReviewThreads(
    connection.nodes ?? [],
    ownerLogin,
    headSha,
    validReviewIds,
  );
}

export async function replyAndResolveReviewThread(
  replyToken: string,
  resolveToken: string,
  repository: string,
  pullRequestNumber: number,
  threadId: string,
  rootCommentId: number,
  body: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<number | null> {
  const marker = /<!--\s*kurami-review-fix:([^\s]+)\s*-->/u.exec(body)?.[0];
  if (!marker) fail("Review fix reply is missing its idempotency marker");
  const inspectQuery = `query($threadId:ID!){node(id:$threadId){... on PullRequestReviewThread{id isResolved comments(last:100){nodes{databaseId body}}}}}`;
  const inspected = (await githubRequest(
    replyToken,
    "https://api.github.com/graphql",
    { method: "POST", body: JSON.stringify({ query: inspectQuery, variables: { threadId } }) },
    fetchImplementation,
  )) as {
    errors?: unknown[];
    data?: { node?: { isResolved?: boolean; comments?: { nodes?: Array<{ databaseId?: number; body?: string }> } } };
  };
  if (inspected.errors?.length || !inspected.data?.node)
    fail("GitHub review thread is unavailable during resolution");
  const existingReply = inspected.data.node.comments?.nodes?.find((comment) =>
    comment.body?.includes(marker),
  );
  let replyId = Number.isInteger(existingReply?.databaseId)
    ? existingReply!.databaseId!
    : null;
  if (inspected.data.node.isResolved && !existingReply) return null;
  if (!existingReply) {
    const reply = (await githubRequest(
      replyToken,
      `https://api.github.com/repos/${repository}/pulls/${pullRequestNumber}/comments/${rootCommentId}/replies`,
      { method: "POST", body: JSON.stringify({ body }) },
      fetchImplementation,
    )) as { id?: number };
    replyId = Number.isInteger(reply.id) ? reply.id! : null;
  }
  if (inspected.data.node.isResolved) return replyId;
  const mutation = `mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}}`;
  const resolved = (await githubRequest(
    resolveToken,
    "https://api.github.com/graphql",
    { method: "POST", body: JSON.stringify({ query: mutation, variables: { threadId } }) },
    fetchImplementation,
  )) as { errors?: unknown[]; data?: { resolveReviewThread?: { thread?: { isResolved?: boolean } } } };
  if (resolved.errors?.length) {
    const details = resolved.errors
      .map((error) =>
        typeof error === "object" && error && "message" in error
          ? String(error.message)
          : "unknown GraphQL error",
      )
      .join("; ")
      .slice(0, 500);
    fail(`GitHub did not resolve the review thread: ${details}`);
  }
  if (!resolved.data?.resolveReviewThread?.thread?.isResolved)
    fail("GitHub did not resolve the review thread: unresolved mutation result");
  return replyId;
}
