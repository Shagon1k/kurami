export type StatusRequestState = "checking" | "writing" | "awaiting_sync" | "synced" | "conflict" | "failed" | "uncertain";
export type StatusInput = { project: string; itemId: string; from: string | null; target: string; observedAt: string; key: string };
export type StatusResult = { state: StatusRequestState; requestId: string; target: string };
export type StatusRequestRow = { request_id: string; project: string; item_id: string; from_status: string | null; to_status: string;
  request_state: StatusRequestState; client_key: string; updated_at: string;created_at?:string };

export function observedStatusRequest(row: StatusRequestRow, status: string | null, observedAt: string): StatusRequestState {
  if (row.request_state !== "awaiting_sync") return row.request_state;
  if (status === row.to_status) return "synced";
  return Date.parse(observedAt) > Date.parse(row.updated_at) ? "conflict" : "awaiting_sync";
}
