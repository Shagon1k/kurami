import type { BriefingPayload, MailItem } from "../../model.ts";
import { fetchGmailSnapshot, type NormalizedGmailMessage } from "../../providers/composio-gmail.ts";
import { requireCaller, type LiveAddon } from "../live-contract.ts";
import { providerComplete } from "../provider-state.ts";

export function classifyMail(item: NormalizedGmailMessage): "ACTION" | "IMPORTANT" | "GENERAL" {
  if (item.classification === "IMPORTANT") return "IMPORTANT";
  const signal = `${item.title} ${item.summary}`.toLocaleLowerCase("ru");
  return /\b(?:action|required|deadline|confirm|approval|approve|respond|reply|payment|invoice|trial)\b|(?:нужно|требуется|подтверд|ответить|оплат|срок|заканчивается)/iu.test(signal)
    ? "ACTION"
    : "GENERAL";
}

export function mailItem(item: NormalizedGmailMessage): MailItem {
  return {
    id: item.id,
    provider: "gmail",
    providerItemId: item.providerItemId,
    threadId: item.threadId,
    class: classifyMail(item),
    subject: item.title,
    sender: item.sender,
    summary: item.summary,
    receivedAt: item.receivedAt,
    ...(item.externalUrl ? { externalUrl: item.externalUrl } : {}),
  };
}


export const mailLifecycle: LiveAddon = {
  id: "mail",
  providerKey: "gmail",
  lane: "mcp",
  collect: context => fetchGmailSnapshot(requireCaller(context), {
    query: context.gmailQuery, pageSize: context.gmailPageSize,
    maximumPages: 20, retry: context.retry, now: context.now,
  }),
  apply(payload, results, context) {
    const result = results.gmail;
    if (providerComplete(result)) {
      const { staleAt: _staleAt, ...prior } = payload.mail;
      payload.mail = {
        ...prior, state: result.state, count: result.value.unreadCount, fetchedAt: result.fetchedAt,
        items: result.value.items.map(item => {
          const normalized = mailItem(item);
          const override = context.classifications?.[item.id] ?? context.classifications?.[item.providerItemId];
          return override ? { ...normalized, class: override } : normalized;
        }),
      };
    } else if (context.initial) {
      payload.mail = { state: "failed", items: [] };
    } else {
      payload.mail = { ...payload.mail, state: "stale", staleAt: context.refreshedAt };
    }
    // Item-bound annotations cannot outlive their target after a live refresh.
    const ids = new Set(payload.mail.items.map(item => item.id));
    payload.notes = payload.notes?.filter(note => !note.target.startsWith("mail-item:") || ids.has(note.target.slice(10)));
    if (payload.notes?.length === 0) delete payload.notes;
  },
};

export function removeArchivedMail(payload: BriefingPayload, providerMessageIds: readonly string[]): boolean {
  const archived = new Set(providerMessageIds);
  const items = payload.mail.items.filter(item => typeof item.providerItemId !== "string" || !archived.has(item.providerItemId));
  const removed = payload.mail.items.length - items.length;
  if (!removed) return false;
  const priorCount = typeof payload.mail.count === "number" ? payload.mail.count : payload.mail.items.length;
  payload.mail = { ...payload.mail, items, count: Math.max(0, priorCount - removed),
    ...(items.length === 0 && priorCount <= removed ? { state: "empty" as const } : {}) };
  const ids = new Set(items.map(item => item.id));
  payload.notes = payload.notes?.filter(note => !note.target.startsWith("mail-item:") || ids.has(note.target.slice(10)));
  if (payload.notes?.length === 0) delete payload.notes;
  return true;
}
