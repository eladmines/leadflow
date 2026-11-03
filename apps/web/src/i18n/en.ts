import { enPart1 } from './en.part1';
import { enPart2 } from './en.part2';
import { enPart3 } from './en.part3';
import { enShared } from './en.shared';

/** English dictionary, keyed by the Hebrew source text (D-100). */
export const en: Record<string, string> = { ...enShared, ...enPart1, ...enPart2, ...enPart3 };
