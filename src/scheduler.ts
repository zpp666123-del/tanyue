namespace TanYue {
  export interface ActiveReminderPause {
    kind: "snoozed" | "today";
    until: Date;
  }

  function dateAtMinutes(base: Date, minutes: number): Date {
    const date = new Date(base);
    date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return date;
  }

  export function isScheduleDay(date: Date, schedule: ReadingSchedule): boolean {
    return schedule.weekdays.includes(date.getDay());
  }

  export function isQuietTime(date: Date, schedule: ReadingSchedule): boolean {
    const now = date.getHours() * 60 + date.getMinutes();
    const start = toMinutes(schedule.quietStart);
    const end = toMinutes(schedule.quietEnd);
    if (start === end) return false;
    if (start < end) return now >= start && now < end;
    return now >= start || now < end;
  }

  export function popupDisplaySeconds(segment: Segment, schedule: ReadingSchedule): number {
    if (schedule.displayMode === "fixed") {
      return Math.max(10, Math.min(300, Math.round(schedule.displaySeconds)));
    }
    return Math.max(12, Math.min(120, Math.round(segment.estimatedSeconds + 6)));
  }

  export function activeReminderPause(schedule: ReadingSchedule, now = new Date()): ActiveReminderPause | null {
    const candidates: ActiveReminderPause[] = [];
    const snoozedUntil = schedule.snoozeUntil ? new Date(schedule.snoozeUntil) : null;
    const pausedUntil = schedule.pausedUntil ? new Date(schedule.pausedUntil) : null;
    if (snoozedUntil && !Number.isNaN(snoozedUntil.getTime()) && snoozedUntil > now) {
      candidates.push({ kind: "snoozed", until: snoozedUntil });
    }
    if (pausedUntil && !Number.isNaN(pausedUntil.getTime()) && pausedUntil > now) {
      candidates.push({ kind: "today", until: pausedUntil });
    }
    return candidates.sort((left, right) => right.until.getTime() - left.until.getTime())[0] || null;
  }

  export function pauseUntilTomorrow(now = new Date()): string {
    const until = new Date(now);
    until.setDate(until.getDate() + 1);
    until.setHours(0, 0, 0, 0);
    return until.toISOString();
  }

  export function generateDailySlots(date: Date, schedule: ReadingSchedule): UpcomingSlot[] {
    if (!schedule.enabled || !isScheduleDay(date, schedule) || schedule.dailyCount <= 0) return [];
    const windows = schedule.windows
      .filter((windowItem) => windowItem.enabled && toMinutes(windowItem.end) > toMinutes(windowItem.start))
      .map((windowItem) => ({
        ...windowItem,
        startMinutes: toMinutes(windowItem.start),
        endMinutes: toMinutes(windowItem.end),
        duration: toMinutes(windowItem.end) - toMinutes(windowItem.start)
      }));

    const totalDuration = windows.reduce((sum, item) => sum + item.duration, 0);
    if (totalDuration <= 0) return [];

    const interval = totalDuration / schedule.dailyCount;
    return Array.from({ length: schedule.dailyCount }, (_, index) => {
      let offset = interval * (index + 0.5);
      let selected = windows[windows.length - 1];
      let minute = selected.startMinutes;
      for (const windowItem of windows) {
        if (offset <= windowItem.duration) {
          selected = windowItem;
          minute = Math.round(windowItem.startMinutes + offset);
          break;
        }
        offset -= windowItem.duration;
      }
      minute = Math.min(selected.endMinutes - 1, Math.max(selected.startMinutes, minute));
      return {
        at: dateAtMinutes(date, minute),
        windowId: selected.id,
        label: selected.label,
        ordinal: index + 1
      };
    });
  }

  export function getUpcomingSlots(schedule: ReadingSchedule, now = new Date(), count = 8): UpcomingSlot[] {
    if (!schedule.enabled) return [];
    const blockedUntil = activeReminderPause(schedule, now)?.until;

    const slots: UpcomingSlot[] = [];
    for (let dayOffset = 0; dayOffset < 14 && slots.length < count; dayOffset += 1) {
      const date = new Date(now);
      date.setDate(now.getDate() + dayOffset);
      date.setHours(0, 0, 0, 0);
      generateDailySlots(date, schedule).forEach((slot) => {
        if (isQuietTime(slot.at, schedule)) return;
        if (slot.at.getTime() <= now.getTime()) return;
        if (blockedUntil && slot.at.getTime() < blockedUntil.getTime()) return;
        slots.push(slot);
      });
    }
    return slots.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, count);
  }

  export function computeNextDue(schedule: ReadingSchedule, now = new Date()): Date | null {
    return getUpcomingSlots(schedule, now, 1)[0]?.at || null;
  }

  export function dueReminderSlot(schedule: ReadingSchedule, now: Date, previousTick: number): UpcomingSlot | null {
    const elapsed = now.getTime() - previousTick;
    if (!schedule.enabled || elapsed < 0 || elapsed > 60_000 || activeReminderPause(schedule, now) || isQuietTime(now, schedule)) return null;
    return generateDailySlots(now, schedule).find((slot) => {
      const age = now.getTime() - slot.at.getTime();
      return age >= 0 && age < 30_000 && !isQuietTime(slot.at, schedule) && slot.at.toISOString() !== schedule.lastTriggeredSlot;
    }) || null;
  }

  export function dailySummary(state: AppState, date = new Date()): DailySummary {
    const key = localDateKey(date);
    const events = state.events.filter((event) => localDateKey(new Date(event.createdAt)) === key);
    const shown = events.filter((event) => event.type === "shown").length;
    const confirmedEvents = events.filter((event) => event.type === "confirmed");
    const confirmed = confirmedEvents.length;
    const minutes = Math.max(
      0,
      Math.round(
        confirmedEvents.reduce((sum, event) => {
          const segment = state.segments.find((item) => item.id === event.segmentId);
          return sum + (segment?.estimatedSeconds || state.schedule.targetSeconds);
        }, 0) / 60
      )
    );
    const favorites = events.filter((event) => event.type === "favorite").length;
    return { shown, confirmed, minutes, favorites };
  }

  export function scheduleHealth(schedule: ReadingSchedule): { tone: "good" | "warning"; message: string } {
    if (!schedule.enabled) return { tone: "warning", message: "阅读计划已暂停" };
    const pause = activeReminderPause(schedule);
    if (pause) return { tone: "warning", message: pause.kind === "today" ? "今天已暂停自动提醒" : `已延后至 ${formatTime(pause.until)}` };
    if (schedule.windows.filter((windowItem) => windowItem.enabled).length === 0) {
      return { tone: "warning", message: "至少需要一个有效提醒时段" };
    }
    if (schedule.dailyCount > 8) return { tone: "warning", message: "提醒较密集，建议先从每天 3—6 段开始" };
    return { tone: "good", message: "节奏温和，适合工作日使用" };
  }
}
