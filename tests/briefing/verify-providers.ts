import assert from "node:assert/strict";
import {
  ProviderError,
  providerIssue,
  retryOperation,
} from "../../src/briefing/providers/common.ts";
import {
  fetchGmailSnapshot,
} from "../../src/briefing/providers/composio-gmail.ts";
import {
  fetchCalendarSnapshot,
  partitionCalendarItemsByLocalDate,
  zonedDateRangeBounds,
  zonedDayBounds,
} from "../../src/briefing/providers/composio-calendar.ts";
import type {
  ComposioToolCaller,
} from "../../src/briefing/providers/composio-mcp.ts";
import {
  fetchOpenMeteo,
  mapWeatherCode,
} from "../../src/briefing/providers/open-meteo.ts";

const fixedNow = () => new Date("2026-08-31T09:00:00.000Z");

async function verifyRetryAndTimeout(): Promise<void> {
  let calls = 0;
  const retry = await retryOperation(async () => {
    calls += 1;
    if (calls < 2) throw new ProviderError("temporary", "temporary", true);
    return "ok";
  }, { attempts: 3, timeoutMs: 100, initialDelayMs: 1, maximumDelayMs: 1 });
  assert.deepEqual(retry, { ok: true, value: "ok", attempts: 2 });

  const timeout = await retryOperation(
    async () => new Promise<string>(() => undefined),
    { attempts: 1, timeoutMs: 5, initialDelayMs: 1, maximumDelayMs: 1 },
  );
  assert.equal(timeout.ok, false);
  if (!timeout.ok) assert.equal(timeout.issue.code, "provider_timeout");

  const issue = providerIssue(new Error(
    "Authorization: Bearer secret-value API_KEY=another-secret https://private.invalid/path",
  ));
  assert.equal(issue.message.includes("secret-value"), false);
  assert.equal(issue.message.includes("another-secret"), false);
  assert.equal(issue.message.includes("private.invalid"), false);
}

async function verifyGmail(): Promise<void> {
  const calls: Array<Record<string, unknown>> = [];
  const caller: ComposioToolCaller = async (name, arguments_) => {
    assert.equal(name, "GMAIL_FETCH_EMAILS");
    calls.push(arguments_);
    if (!arguments_.page_token) {
      return {
        successful: true,
        data: {
          messages: [{
            messageId: "m-1",
            threadId: "t-1",
            subject: "First message",
            sender: "Sender One <one@example.com>",
            messageText: "<b>Readable</b> summary",
            messageTimestamp: "1788166800000",
            labelIds: ["INBOX", "UNREAD"],
            display_url: "https://mail.google.com/mail/u/0/#inbox/m-1",
          }],
          nextPageToken: "page-two",
        },
      };
    }
    return {
      successful: true,
      data: {
        messages: [{
          messageId: "m-2",
          threadId: "t-2",
          subject: "Important message",
          sender: "two@example.com",
          messageText: "Needs attention",
          messageTimestamp: "2026-08-31T08:45:00Z",
          labelIds: ["IMPORTANT", "INBOX", "UNREAD"],
        }],
      },
    };
  };
  const response = await fetchGmailSnapshot(caller, {
    query: "in:inbox is:unread category:primary",
    pageSize: 25,
    retry: { attempts: 1 },
    now: fixedNow,
  });
  assert.equal(response.state, "ready");
  assert.equal(response.value?.unreadCount, 2);
  assert.equal(response.value?.pageCount, 2);
  assert.equal(
    response.value?.items.find((item) => item.providerItemId === "m-2")?.classification,
    "IMPORTANT",
  );
  assert.equal(
    response.value?.items.find((item) => item.providerItemId === "m-1")?.summary,
    "Readable summary",
  );
  assert.deepEqual(calls[0], {
    query: "in:inbox is:unread category:primary",
    user_id: "me",
    max_results: 25,
    include_payload: true,
    ids_only: false,
    verbose: true,
    include_spam_trash: false,
  });
  assert.equal(calls[1]?.page_token, "page-two");
  assert.equal("pageToken" in calls[1]!, false);

  let partialCall = 0;
  const partial = await fetchGmailSnapshot(async () => {
    partialCall += 1;
    if (partialCall === 1) {
      return {
        successful: true,
        data: {
          messages: [{
            messageId: "m-3",
            subject: "Kept",
            sender: "sender@example.com",
            messageText: "Useful result",
            messageTimestamp: "2026-08-31T08:00:00Z",
            labelIds: ["UNREAD"],
          }],
          nextPageToken: "broken-page",
        },
      };
    }
    throw new ProviderError("gmail_unavailable", "Gmail temporarily unavailable", false);
  }, {
    query: "is:unread",
    retry: { attempts: 1 },
    now: fixedNow,
  });
  assert.equal(partial.state, "partial");
  assert.equal(partial.value?.items.length, 1);
  const invalid = await fetchGmailSnapshot(caller, { query: " ", now: fixedNow });
  assert.equal(invalid.state, "failed");
  assert.equal(invalid.attempts, 0);
}

async function verifyCalendar(): Promise<void> {
  assert.deepEqual(zonedDayBounds("2026-03-29", "Europe/Vilnius"), {
    timeMin: "2026-03-29T00:00:00+02:00",
    timeMax: "2026-03-30T00:00:00+03:00",
  });
  assert.deepEqual(zonedDateRangeBounds("2026-08-27", "2026-09-01", "Europe/Vilnius"), {
    timeMin: "2026-08-27T00:00:00+03:00",
    timeMax: "2026-09-01T00:00:00+03:00",
  });
  const calls: Array<Record<string, unknown>> = [];
  const caller: ComposioToolCaller = async (name, arguments_) => {
    assert.equal(name, "GOOGLECALENDAR_EVENTS_LIST");
    calls.push(arguments_);
    if (arguments_.calendarId === "primary" && !arguments_.pageToken) {
      return {
        successful: true,
        data: {
          items: [{
            id: "event-1",
            summary: "Morning sync",
            description: "Bring notes.<br>&nbsp; __________________________________ Microsoft Teams meeting Join: https://teams.microsoft.com/example",
            location: "Microsoft Teams Meeting",
            start: { dateTime: "2026-03-29T09:00:00+03:00", timeZone: "Europe/Vilnius" },
            end: { dateTime: "2026-03-29T09:30:00+03:00", timeZone: "Europe/Vilnius" },
            status: "confirmed",
            htmlLink: "https://calendar.google.com/calendar/event?eid=one",
          }],
          nextPageToken: "calendar-two",
        },
      };
    }
    if (arguments_.calendarId === "primary") {
      return {
        successful: true,
        data: {
          items: [
            {
              id: "cancelled",
              summary: "Cancelled",
              status: "cancelled",
              start: { dateTime: "2026-03-29T10:00:00+03:00" },
              end: { dateTime: "2026-03-29T11:00:00+03:00" },
            },
            {
              id: "declined",
              summary: "Declined",
              status: "confirmed",
              attendees: [{ self: true, responseStatus: "declined" }],
              start: { dateTime: "2026-03-29T11:00:00+03:00" },
              end: { dateTime: "2026-03-29T12:00:00+03:00" },
            },
          ],
        },
      };
    }
    return {
      successful: true,
      data: {
        items: [{
          id: "all-day",
          summary: "Family day",
          status: "tentative",
          start: { date: "2026-03-29" },
          end: { date: "2026-03-30" },
        }],
      },
    };
  };
  const response = await fetchCalendarSnapshot(caller, {
    localDate: "2026-03-29",
    timeZone: "Europe/Vilnius",
    sources: [
      { key: "primary", id: "primary", label: "Aliaksei Hurynovich", role: "personal" },
      { key: "family", id: "family-id", label: "G-Fam", role: "family" },
    ],
    pageSize: 50,
    retry: { attempts: 1 },
    now: fixedNow,
  });
  assert.equal(response.state, "ready");
  assert.equal(response.value?.items.length, 2);
  const meeting = response.value?.items.find((item) => item.providerItemId.includes("event-1"));
  assert.equal(meeting?.description, "Bring notes.");
  assert.equal(meeting?.location, "Microsoft Teams Meeting");
  const allDay = response.value?.items.find((item) => item.providerItemId.includes("all-day"));
  assert.equal(allDay?.allDay, true);
  assert.equal(allDay?.tentative, true);
  assert.equal(allDay?.sourceLabel, "G-Fam");
  const partitions = partitionCalendarItemsByLocalDate(response.value?.items ?? [], "Europe/Vilnius");
  assert.equal(partitions.get("2026-03-29")?.length, 2);
  assert.deepEqual(calls[0], {
    calendarId: "primary",
    timeMin: "2026-03-29T00:00:00+02:00",
    timeMax: "2026-03-30T00:00:00+03:00",
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 50,
  });
  assert.equal(calls[1]?.pageToken, "calendar-two");
  assert.equal("page_token" in calls[1]!, false);
  const invalid = await fetchCalendarSnapshot(caller, {
    localDate: "2026-03-29",
    timeZone: "Europe/Vilnius",
    sources: [],
    now: fixedNow,
  });
  assert.equal(invalid.state, "failed");
  assert.equal(invalid.attempts, 0);
}

async function verifyOpenMeteo(): Promise<void> {
  assert.deepEqual(mapWeatherCode(61), { code: 61, label: "Дождь", emoji: "🌧️" });
  let fetchCalls = 0;
  const requested: URL[] = [];
  const response = await fetchOpenMeteo({
    location: {
      name: "Vilnius",
      latitude: 54.6872,
      longitude: 25.2797,
      timeZone: "Europe/Vilnius",
    },
    fetchImpl: async (input) => {
      fetchCalls += 1;
      requested.push(new URL(String(input)));
      if (fetchCalls === 1) return new Response("temporary", { status: 503 });
      return new Response(JSON.stringify({
        latitude: 54.69,
        longitude: 25.28,
        timezone: "Europe/Vilnius",
        current: {
          time: "2026-08-31T12:00",
          temperature_2m: 17.4,
          apparent_temperature: 16.8,
          relative_humidity_2m: 75,
          precipitation: 0.2,
          weather_code: 61,
          wind_speed_10m: 12.1,
        },
        daily: {
          time: ["2026-08-31"],
          weather_code: [61],
          temperature_2m_max: [19.5],
          temperature_2m_min: [11.2],
          precipitation_probability_max: [70],
          sunrise: ["2026-08-31T06:18"],
          sunset: ["2026-08-31T20:14"],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    retry: { attempts: 2, timeoutMs: 100, initialDelayMs: 1, maximumDelayMs: 1 },
    now: fixedNow,
  });
  assert.equal(response.state, "ready");
  assert.equal(response.attempts, 2);
  assert.equal(response.value?.condition.label, "Дождь");
  assert.equal(response.value?.precipitationProbabilityPercent, 70);
  const lastRequest = requested.at(-1);
  assert.ok(lastRequest);
  assert.equal(lastRequest.hostname, "api.open-meteo.com");
  assert.equal(lastRequest.searchParams.get("timezone"), "Europe/Vilnius");
  assert.match(lastRequest.searchParams.get("current") ?? "", /weather_code/u);
}

await verifyRetryAndTimeout();
await verifyGmail();
await verifyCalendar();
await verifyOpenMeteo();
process.stdout.write("briefing providers verified\n");
