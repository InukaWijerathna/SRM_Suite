import type { ChildRecord, WeightCategory } from '../types';

export type BadgeTone = 'critical' | 'warning' | 'info';

export interface HealthBadge {
  key: string;
  label: string;
  tone: BadgeTone;
}

const CRITICAL = /heart|kidney|brain|cancer|epilep|leuk|diabet|thalass|lesion/i;
const INFO = /visual|vision|hearing|speech|impair/i;

const WEIGHT_LABEL: Record<Exclude<WeightCategory, 'healthy'>, string> = {
  underweight: 'Under Weight',
  overweight: 'Over Weight',
};

const squash = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Badges shown on cards: Heart Disease etc. render red, Under Weight orange (per the PRD).
 * A weight badge is added from `weight_category`, unless the condition list already says so.
 */
export function healthBadges(child: ChildRecord): HealthBadge[] {
  const badges: HealthBadge[] = child.conditions.map((label) => ({
    key: squash(label),
    label,
    tone: CRITICAL.test(label) ? 'critical' : INFO.test(label) ? 'info' : 'warning',
  }));

  const cat = child.weightCategory;
  if (cat && cat !== 'healthy') {
    const key = squash(WEIGHT_LABEL[cat]);
    if (!badges.some((b) => b.key === key)) {
      badges.push({ key, label: WEIGHT_LABEL[cat], tone: 'warning' });
    }
  }
  return badges;
}

export const hasMedicalAlert = (child: ChildRecord) => child.conditions.length > 0;
