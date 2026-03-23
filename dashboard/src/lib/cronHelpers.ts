export type ScheduleFrequency = 'every_day' | 'weekdays' | 'weekends' | 'specific_days' | 'monthly' | 'hourly';

export interface ScheduleConfig {
  frequency: ScheduleFrequency;
  hour: number;
  minute: number;
  days: number[];
  monthDay: number;
  hourlyInterval: number;
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function scheduleToCron(s: ScheduleConfig): string {
  if (s.frequency === 'hourly') {
    return `0 */${s.hourlyInterval} * * *`;
  }
  const time = `${s.minute} ${s.hour}`;
  switch (s.frequency) {
    case 'every_day': return `${time} * * *`;
    case 'weekdays': return `${time} * * 1-5`;
    case 'weekends': return `${time} * * 0,6`;
    case 'specific_days': return `${time} * * ${s.days.sort((a, b) => a - b).join(',')}`;
    case 'monthly': return `${time} ${s.monthDay} * *`;
    default: return `${time} * * *`;
  }
}

export function cronToSchedule(cron: string): ScheduleConfig {
  const defaults: ScheduleConfig = {
    frequency: 'weekdays', hour: 9, minute: 0, days: [1, 2, 3, 4, 5], monthDay: 1, hourlyInterval: 1,
  };
  if (!cron) return defaults;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return defaults;
  const [minStr, hourStr, dom, , dow] = parts;

  if (hourStr.startsWith('*/')) {
    return { ...defaults, frequency: 'hourly', hourlyInterval: parseInt(hourStr.slice(2)) || 1 };
  }

  const minute = parseInt(minStr) || 0;
  const hour = parseInt(hourStr) || 9;

  if (dom !== '*') {
    return { ...defaults, frequency: 'monthly', hour, minute, monthDay: parseInt(dom) || 1 };
  }

  if (dow === '*') {
    return { ...defaults, frequency: 'every_day', hour, minute };
  }
  if (dow === '1-5') {
    return { ...defaults, frequency: 'weekdays', hour, minute, days: [1, 2, 3, 4, 5] };
  }
  if (dow === '0,6' || dow === '6,0') {
    return { ...defaults, frequency: 'weekends', hour, minute, days: [0, 6] };
  }

  const dayList = dow.split(',').map((d) => parseInt(d)).filter((d) => !isNaN(d));
  if (dayList.length > 0) {
    return { ...defaults, frequency: 'specific_days', hour, minute, days: dayList };
  }

  return { ...defaults, hour, minute };
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function describeSchedule(s: ScheduleConfig): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const ampm = s.hour >= 12 ? 'PM' : 'AM';
  const h12 = s.hour === 0 ? 12 : s.hour > 12 ? s.hour - 12 : s.hour;
  const timeStr = `${h12}:${pad(s.minute)} ${ampm}`;

  switch (s.frequency) {
    case 'hourly': return `Every ${s.hourlyInterval} hour${s.hourlyInterval > 1 ? 's' : ''}`;
    case 'every_day': return `Every day at ${timeStr}`;
    case 'weekdays': return `Weekdays at ${timeStr}`;
    case 'weekends': return `Weekends at ${timeStr}`;
    case 'monthly': return `${ordinal(s.monthDay)} of each month at ${timeStr}`;
    case 'specific_days': {
      const names = s.days.sort((a, b) => a - b).map((d) => DAY_NAMES[d]);
      return `${names.join(', ')} at ${timeStr}`;
    }
    default: return `At ${timeStr}`;
  }
}

export function describeCronHuman(cron: string): string {
  if (!cron) return '';
  return describeSchedule(cronToSchedule(cron));
}
