import type { Lead, PipelineStage } from '@leadflow/shared';

interface StageColor {
  /** Small dot by the stage name. */
  dot: string;
  /** Soft tag with the stage name. */
  tag: string;
  /** Strip on top of the board column. */
  bar: string;
}

// Open stages take a colour by their place in the pipeline (D-138); won is green, lost grey.
// The stage name is always written too, so colour is never the only signal.
const OPEN: StageColor[] = [
  { dot: 'bg-sky-500', tag: 'bg-sky-50 text-sky-700 ring-sky-100', bar: 'bg-sky-400' },
  {
    dot: 'bg-violet-500',
    tag: 'bg-violet-50 text-violet-700 ring-violet-100',
    bar: 'bg-violet-400',
  },
  { dot: 'bg-amber-500', tag: 'bg-amber-50 text-amber-800 ring-amber-100', bar: 'bg-amber-400' },
  {
    dot: 'bg-orange-500',
    tag: 'bg-orange-50 text-orange-700 ring-orange-100',
    bar: 'bg-orange-400',
  },
  { dot: 'bg-pink-500', tag: 'bg-pink-50 text-pink-700 ring-pink-100', bar: 'bg-pink-400' },
  {
    dot: 'bg-indigo-500',
    tag: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
    bar: 'bg-indigo-400',
  },
];
const WON: StageColor = {
  dot: 'bg-emerald-500',
  tag: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  bar: 'bg-emerald-400',
};
const LOST: StageColor = {
  dot: 'bg-slate-400',
  tag: 'bg-slate-100 text-slate-600 ring-slate-200',
  bar: 'bg-slate-300',
};

/** The colours of a lead's stage, given the business's pipeline (in order). */
export function stageColor(
  stage: Pick<Lead['stage'], 'id' | 'kind'>,
  stages: Pick<PipelineStage, 'id' | 'kind'>[] | undefined,
): StageColor {
  if (stage.kind === 'WON') return WON;
  if (stage.kind === 'LOST') return LOST;
  const open = (stages ?? []).filter((s) => s.kind === 'OPEN');
  const i = Math.max(
    0,
    open.findIndex((s) => s.id === stage.id),
  );
  return OPEN[i % OPEN.length]!;
}
