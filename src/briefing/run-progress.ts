import type { BriefingRunState } from "./run-attempt.ts";

export const RUN_PROGRESS: Record<BriefingRunState, { step: number; label: string }> = {
  created: { step: 1, label: "Подключаю источники" },
  "live-collected": { step: 2, label: "Почта, расписание и погода собраны" },
  "telegram-captured": { step: 3, label: "Telegram-пачка получена" },
  "capture-validated": { step: 4, label: "Проверяю и объединяю материалы" },
  editorialized: { step: 5, label: "Сюжеты подготовлены" },
  prepared: { step: 6, label: "Собираю изображения" },
  "media-ready": { step: 7, label: "Изображения готовы" },
  "commit-planned": { step: 8, label: "Завершаю Telegram-гигиену" },
  "telegram-committed": { step: 9, label: "Публикую страницу" },
  published: { step: 10, label: "Выпуск готов" },
  notified: { step: 10, label: "Выпуск готов" },
  failed: { step: 0, label: "Сборка остановлена" },
  skipped: { step: 0, label: "Запуск не потребовался" },
};

/** What Kurami is doing while the run sits in a state: the next stage, said in the first person. */
const RU_ACTIVITY: Partial<Record<BriefingRunState, string>> = {
  created: "Подключаю источники…",
  "live-collected": "Листаю Telegram…",
  "telegram-captured": "Сверяю и объединяю материалы…",
  "capture-validated": "Пишу сюжеты…",
  editorialized: "Рисую картинки…",
  prepared: "Рисую картинки…",
  "media-ready": "Навожу порядок в Telegram…",
  "commit-planned": "Навожу порядок в Telegram…",
  "telegram-committed": "Публикую страницу…",
};

const EN_ACTIVITY: Record<BriefingRunState, string> = {
  created: "Connecting sources…",
  "live-collected": "Reading Telegram…",
  "telegram-captured": "Checking and combining material…",
  "capture-validated": "Writing stories…",
  editorialized: "Drawing pictures…",
  prepared: "Drawing pictures…",
  "media-ready": "Tidying up Telegram…",
  "commit-planned": "Tidying up Telegram…",
  "telegram-committed": "Publishing the page…",
  published: "Edition ready",
  notified: "Edition ready",
  failed: "Build stopped",
  skipped: "Run not needed",
};
export const RUN_STEPS = 10;
export function runActivity(state: BriefingRunState, language: "ru" | "en"): string {
  return language === "en" ? EN_ACTIVITY[state] : RU_ACTIVITY[state] ?? RUN_PROGRESS[state].label;
}
