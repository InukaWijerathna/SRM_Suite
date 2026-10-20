import type { SheetRow } from '../types';

/**
 * 553 deterministic mock students, emitted as raw sheet rows exactly as the Apps Script
 * endpoint returns them: Title_Case headers, one TRUE/FALSE column per medical condition.
 * MOCK mode therefore runs the same join/normalisation code as LIVE mode.
 *
 * The data is deliberately a little messy, like a real hand-edited sheet:
 *  - some phone numbers are stored as numbers with the leading zero dropped
 *  - a handful of rows have an empty Status (means "active") or "inactive"
 */

export const MOCK_STUDENT_COUNT = 553;

// Column headers, as in the Google Sheet.
export const ID_HEADER = 'Child_ID_LKA006XXXX_4_digits';

export const MASTER_HEADERS = [
  ID_HEADER, 'Name_of_Child', 'Child_Name_In_BC', 'Gender', 'Birthday', 'Office_Name',
  'Contact_Number', 'Whatsapp_Number', 'Address', 'GN_Division', 'Father_s_Name', 'Mother_s_Name',
  'School_Grade', 'Care_Giver', 'Religion', 'Picture_Ref', 'Status',
] as const;

/** One TRUE/FALSE column per condition. Add a column to the sheet to add a condition. */
export const CONDITION_HEADERS = [
  'Health_Heart_Disease', 'Health_Kidney_Failure', 'Health_Respiratory',
  'Health_Under_Weight', 'Health_Over_Weight',
  'Disability_Visual_Impairment', 'Disability_Brain_Lesion',
] as const;

export const HEALTH_HEADERS = [
  ID_HEADER, 'Weight_Kg', 'Height_cm', 'Body_Mass_Index_BMI', ...CONDITION_HEADERS,
] as const;

// mulberry32: tiny seeded PRNG so the dataset is identical on every load.
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(20260924);
const int = (min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
const chance = (p: number) => rng() < p;

function weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rng() * total;
  for (const [value, w] of entries) {
    r -= w;
    if (r < 0) return value;
  }
  return entries[entries.length - 1][0];
}

const MALE_FIRST = [
  'Kasun', 'Nimal', 'Sanjaya', 'Dilshan', 'Tharindu', 'Chamara', 'Ruwan', 'Isuru', 'Lahiru',
  'Pasindu', 'Nuwan', 'Supun', 'Hasitha', 'Malith', 'Kavindu', 'Dinuka', 'Sachith', 'Buddhika',
  'Chathura', 'Yasiru', 'Ashen', 'Rashmika', 'Sandun', 'Thisara', 'Vihanga',
];
const FEMALE_FIRST = [
  'Nethmi', 'Sanduni', 'Dilini', 'Kavya', 'Hansika', 'Ishara', 'Tharushi', 'Sewwandi', 'Chamodi',
  'Anjali', 'Piumi', 'Nimasha', 'Rashmi', 'Sachini', 'Maleesha', 'Yashodha', 'Thilini', 'Dewmi',
  'Senuri', 'Oshadi', 'Nadeesha', 'Sithumi', 'Imasha', 'Lakshi', 'Menaka',
];
const MALE_MIDDLE = ['Madushan', 'Sampath', 'Chathuranga', 'Lakshan', 'Randika', 'Pramod'];
const FEMALE_MIDDLE = ['Nirmani', 'Hasini', 'Sewmini', 'Prabodha', 'Rashmi', 'Udeshika'];
const SURNAMES = [
  'Perera', 'Silva', 'Fernando', 'Jayasinghe', 'Wickramasinghe', 'Rathnayake', 'Bandara',
  'Gunawardena', 'Dissanayake', 'Herath', 'Senanayake', 'Weerasinghe', 'Karunaratne',
  'Amarasinghe', 'Kumara', 'Peiris', 'Liyanage', 'Samarasinghe', 'Abeysekara', 'Wijesinghe',
  'Ranasinghe', 'Gamage', 'Jayawardena',
];
const GN_DIVISIONS = [
  'Aluthgama', 'Bandaragama North', 'Kalutara South', 'Panadura East', 'Horana West',
  'Matugama', 'Beruwala', 'Dodangoda', 'Ingiriya', 'Millaniya', 'Bulathsinhala', 'Agalawatta',
];
// Most real registers track one divisional office; a few have several. Demo data has 3 so
// the office field, its search and its display are exercised.
const OFFICES = ['Kalutara', 'Horana', 'Matugama'];
const STREETS = [
  'Temple Road', 'Lake Road', 'School Lane', 'Station Road', 'Main Street', 'Galle Road',
  'Kandy Road', 'Church Lane', 'Wewa Mawatha', 'Ganga Road',
];
const GRADES = [
  'preschool', 'grade_1', 'grade_2', 'grade_3', 'grade_4', 'grade_5', 'grade_6', 'grade_7',
  'grade_8', 'grade_9',
] as const;

type Condition = 'Heart Disease' | 'Kidney Failure' | 'Respiratory' | 'Visual Impairment' | 'Brain Lesion';
type Category = 'underweight' | 'overweight' | 'healthy';

const SINGLE_CONDITIONS = [
  ['Visual Impairment', 34],
  ['Respiratory', 25],
  ['Heart Disease', 15],
  ['Brain Lesion', 14],
  ['Kidney Failure', 12],
] as const;

function phone(): string | number {
  const local = `07${pick([0, 1, 2, 5, 6, 7, 8])}${String(int(0, 9999999)).padStart(7, '0')}`;
  // Sheets stores digit-only cells as numbers, which drops the leading zero.
  return chance(0.06) ? Number(local) : local;
}

function build() {
  const master: SheetRow[] = [];
  const health: SheetRow[] = [];

  // Fixed spots that guarantee every alert type shows up in the demo.
  const forced: Record<number, { conditions: Condition[]; category?: Category }> = {
    1: { conditions: ['Heart Disease'] },
    2: { conditions: ['Kidney Failure'], category: 'underweight' },
    3: { conditions: ['Visual Impairment'] },
    4: { conditions: ['Brain Lesion'] },
    5: { conditions: ['Respiratory'], category: 'overweight' },
    6: { conditions: ['Heart Disease'], category: 'underweight' },
    // A child can have several conditions: each is its own TRUE column.
    7: { conditions: ['Heart Disease', 'Respiratory'] },
    8: { conditions: ['Visual Impairment', 'Brain Lesion'] },
  };

  let idNumber = 60000;
  for (let i = 0; i < MOCK_STUDENT_COUNT; i++) {
    idNumber += int(1, 40);
    const childId = `LKA${String(idNumber).padStart(7, '0')}`;

    const gender = chance(0.5) ? 'male' : 'female';
    const first = pick(gender === 'male' ? MALE_FIRST : FEMALE_FIRST);
    const middle = chance(0.6) ? ` ${pick(gender === 'male' ? MALE_MIDDLE : FEMALE_MIDDLE)}` : '';
    const surname = pick(SURNAMES);
    const grade = pick(GRADES);
    const gn = pick(GN_DIVISIONS);

    const careGiver = weighted([
      ['both_parents', 70],
      ['single_parent__mother', 20],
      ['single_parent__father', 4],
      ['guardian__grandparents', 6],
    ] as const);
    const primary = phone();

    // Rough age: preschool ~5, grade_n ~5+n. Birthday is back-dated from today by that
    // many years, plus a random day within the year, so ages stay roughly grade-appropriate.
    const age = 5 + GRADES.indexOf(grade);
    const birthday = new Date();
    birthday.setFullYear(birthday.getFullYear() - age, int(0, 11), int(1, 28));
    const birthdayIso = birthday.toISOString().slice(0, 10);

    master.push({
      [ID_HEADER]: childId,
      Name_of_Child: `${first}${middle} ${surname}`,
      // Not a real translation (demo data has no Sinhala/Tamil generator) — just a stand-in
      // so the column isn't always empty. Real registers leave this blank ~64% of the time too.
      Child_Name_In_BC: chance(0.36) ? `${first}${middle} ${surname}` : '',
      Gender: gender,
      Birthday: chance(0.98) ? birthdayIso : '', // the odd record is missing its birthday too
      Office_Name: pick(OFFICES),
      Contact_Number: primary,
      Whatsapp_Number: chance(0.1) ? '' : chance(0.7) ? primary : phone(),
      Address: `No. ${int(1, 240)}, ${pick(STREETS)}, ${gn}`,
      GN_Division: gn,
      Father_s_Name:
        careGiver === 'single_parent__mother' || careGiver === 'guardian__grandparents'
          ? ''
          : `${pick(MALE_FIRST)} ${chance(0.5) ? pick(MALE_MIDDLE) + ' ' : ''}${surname}`,
      Mother_s_Name:
        careGiver === 'single_parent__father' || careGiver === 'guardian__grandparents'
          ? ''
          : `${pick(FEMALE_FIRST)} ${pick(SURNAMES)}`,
      School_Grade: grade,
      Care_Giver: careGiver,
      Religion: weighted([
        ['buddhism', 76],
        ['catholicism', 8],
        ['islam', 8],
        ['hinduism', 8],
      ] as const),
      Picture_Ref: `${childId}.jpg`,
      Status: chance(0.04) ? 'inactive' : chance(0.03) ? '' : 'active',
    });

    const heightCm = Math.round((100 + (age - 5) * 6.2 + (rng() - 0.5) * 12) * 10) / 10;

    const fixed = forced[i];
    const category: Category =
      fixed?.category ??
      weighted([
        ['underweight', 14],
        ['overweight', 10],
        ['healthy', 76],
      ] as const);
    const bmi =
      category === 'underweight'
        ? 11.8 + rng() * 1.6
        : category === 'overweight'
          ? 19.2 + rng() * 4.3
          : 14.2 + rng() * 3.8;
    const weightKg = Math.round(bmi * (heightCm / 100) ** 2 * 10) / 10;

    let conditions: Condition[] = [];
    if (fixed) {
      conditions = fixed.conditions;
    } else if (chance(0.08)) {
      const options = SINGLE_CONDITIONS.map(([c, w]) => [c as Condition, w] as const);
      conditions = [weighted(options)];
      if (chance(0.25)) {
        const second = weighted(options);
        if (second !== conditions[0]) conditions.push(second);
      }
    }
    const has = (c: Condition) => conditions.includes(c);

    health.push({
      [ID_HEADER]: childId,
      Weight_Kg: weightKg,
      Height_cm: heightCm,
      Body_Mass_Index_BMI: Math.round(bmi * 10) / 10,
      Health_Heart_Disease: has('Heart Disease'),
      Health_Kidney_Failure: has('Kidney Failure'),
      Health_Respiratory: has('Respiratory'),
      Health_Under_Weight: category === 'underweight',
      Health_Over_Weight: category === 'overweight',
      Disability_Visual_Impairment: has('Visual Impairment'),
      Disability_Brain_Lesion: has('Brain Lesion'),
    });
  }

  return { master, health };
}

const built = build();

/** Roster tab rows (demographics, contacts, family). */
export const mockMasterRows: SheetRow[] = built.master;
/** Health tab rows (measurements + one TRUE/FALSE column per condition). */
export const mockHealthRows: SheetRow[] = built.health;
