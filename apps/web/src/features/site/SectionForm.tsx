import type { ReactNode } from 'react';
import { HERO_ACTIONS, heroActionLabels, SITE_LIMITS, type Section } from '@leadflow/shared';
import { Checkbox, Field, Select, Textarea } from '../../components/ui';
import { GalleryEditor } from '../media/GalleryEditor';
import { ImageField } from '../media/ImageField';
import { ItemsEditor } from './ItemsEditor';

type Patch = (patch: Partial<Section>) => void;

/** Texts are typed directly on the page on desktop (D-072); phones keep them in the form. */
function Txt({ children }: { children: ReactNode }) {
  return <div className="contents lg:hidden">{children}</div>;
}

function OnPageNote() {
  return (
    <p className="hidden rounded-xl bg-brand-50 px-3 py-2.5 text-sm text-brand-800 lg:block">
      את הטקסטים והפריטים עורכים ישירות על האתר: לחצו על טקסט כדי לשנות אותו, או על ״+ הוספה״ כדי
      להוסיף פריט.
    </p>
  );
}

const titleField = (s: Section, update: Patch) => (
  <Field
    label="כותרת"
    maxLength={SITE_LIMITS.title}
    value={s.title}
    onChange={(e) => update({ title: e.target.value })}
  />
);

/** The fields for one section. Every change goes straight into the draft (autosaved). */
export function SectionForm({ section: s, onChange }: { section: Section; onChange: Patch }) {
  switch (s.type) {
    case 'hero':
      return (
        <div className="flex flex-col gap-4">
          <OnPageNote />
          <Txt>{titleField(s, onChange)}</Txt>
          <Txt>
            <Textarea
              label="משפט פתיחה"
              maxLength={SITE_LIMITS.shortText}
              value={s.subtitle}
              onChange={(e) => onChange({ subtitle: e.target.value })}
            />
          </Txt>
          <Txt>
            <Field
              label="טקסט הכפתור"
              maxLength={40}
              value={s.buttonLabel}
              onChange={(e) => onChange({ buttonLabel: e.target.value })}
            />
          </Txt>
          <Select
            label="מה קורה בלחיצה על הכפתור"
            options={HERO_ACTIONS.map((a) => ({ value: a, label: heroActionLabels[a] }))}
            value={s.buttonAction}
            onChange={(e) =>
              onChange({ buttonAction: e.target.value as (typeof HERO_ACTIONS)[number] })
            }
          />
          <ImageField
            label="תמונת רקע"
            hint="תמונה רחבה ואיכותית של העסק. הטקסט יוצג מעליה."
            value={s.imageAssetId}
            onChange={(imageAssetId) => onChange({ imageAssetId })}
          />
        </div>
      );
    case 'about':
      return (
        <div className="flex flex-col gap-4">
          <OnPageNote />
          <Txt>{titleField(s, onChange)}</Txt>
          <Txt>
            <Textarea
              label="טקסט"
              rows={8}
              maxLength={SITE_LIMITS.body}
              hint="שורה ריקה יוצרת פסקה חדשה"
              value={s.body}
              onChange={(e) => onChange({ body: e.target.value })}
            />
          </Txt>
          <ImageField
            label="תמונה"
            value={s.imageAssetId}
            onChange={(imageAssetId) => onChange({ imageAssetId })}
          />
          {s.imageAssetId && (
            <Field
              label="תיאור התמונה"
              hint="לנגישות ולגוגל, למשל: הצוות שלנו בסלון"
              maxLength={160}
              value={s.imageAlt}
              onChange={(e) => onChange({ imageAlt: e.target.value })}
            />
          )}
        </div>
      );
    case 'gallery':
      return (
        <div className="flex flex-col gap-4">
          <OnPageNote />
          <Txt>{titleField(s, onChange)}</Txt>
          <GalleryEditor items={s.items} onChange={(items) => onChange({ items })} />
        </div>
      );
    case 'services':
      return (
        <div className="flex flex-col gap-4">
          <OnPageNote />
          <Txt>{titleField(s, onChange)}</Txt>
          <Txt>
            <ItemsEditor
              items={s.items}
              fields={[
                { key: 'name', label: 'שם השירות' },
                { key: 'description', label: 'תיאור קצר', multiline: true },
              ]}
              onChange={(items) => onChange({ items } as Partial<Section>)}
              newItem={() => ({ name: '', description: '' })}
              itemName={(n) => `שירות ${n}`}
              addLabel="הוספת שירות"
            />
          </Txt>
        </div>
      );
    case 'pricing':
      return (
        <div className="flex flex-col gap-4">
          <OnPageNote />
          <Txt>{titleField(s, onChange)}</Txt>
          <Txt>
            <ItemsEditor
              items={s.items}
              fields={[
                { key: 'name', label: 'שירות' },
                { key: 'price', label: 'מחיר', placeholder: '₪150', maxLength: SITE_LIMITS.price },
              ]}
              onChange={(items) => onChange({ items } as Partial<Section>)}
              newItem={() => ({ name: '', price: '' })}
              itemName={(n) => `שורה ${n}`}
              addLabel="הוספת שורה"
            />
          </Txt>
          <Txt>
            <Textarea
              label="הערה מתחת למחירון"
              maxLength={SITE_LIMITS.shortText}
              value={s.note}
              onChange={(e) => onChange({ note: e.target.value })}
            />
          </Txt>
        </div>
      );
    case 'testimonials':
      return (
        <div className="flex flex-col gap-4">
          <OnPageNote />
          <Txt>{titleField(s, onChange)}</Txt>
          <Txt>
            <ItemsEditor
              items={s.items}
              fields={[
                { key: 'quote', label: 'ההמלצה', multiline: true },
                { key: 'author', label: 'שם הממליץ/ה', maxLength: 80 },
              ]}
              onChange={(items) => onChange({ items } as Partial<Section>)}
              newItem={() => ({ quote: '', author: '' })}
              itemName={(n) => `המלצה ${n}`}
              addLabel="הוספת המלצה"
            />
          </Txt>
        </div>
      );
    case 'faq':
      return (
        <div className="flex flex-col gap-4">
          <OnPageNote />
          <Txt>{titleField(s, onChange)}</Txt>
          <Txt>
            <ItemsEditor
              items={s.items}
              fields={[
                { key: 'question', label: 'שאלה' },
                { key: 'answer', label: 'תשובה', multiline: true },
              ]}
              onChange={(items) => onChange({ items } as Partial<Section>)}
              newItem={() => ({ question: '', answer: '' })}
              itemName={(n) => `שאלה ${n}`}
              addLabel="הוספת שאלה"
            />
          </Txt>
        </div>
      );
    case 'contact':
      return (
        <div className="flex flex-col gap-4">
          <OnPageNote />
          <Txt>{titleField(s, onChange)}</Txt>
          <Txt>
            <Textarea
              label="משפט פתיחה"
              maxLength={SITE_LIMITS.shortText}
              value={s.subtitle}
              onChange={(e) => onChange({ subtitle: e.target.value })}
            />
          </Txt>
          <p className="text-xs text-ink-muted">הפרטים נלקחים מהגדרות העסק ומתעדכנים אוטומטית.</p>
          <Checkbox
            label="הצגת טלפון"
            checked={s.showPhone}
            onChange={(e) => onChange({ showPhone: e.target.checked })}
          />
          <Checkbox
            label="הצגת כתובת וקישור למפה"
            checked={s.showAddress}
            onChange={(e) => onChange({ showAddress: e.target.checked })}
          />
          <Checkbox
            label="הצגת שעות פעילות"
            checked={s.showHours}
            onChange={(e) => onChange({ showHours: e.target.checked })}
          />
          <fieldset className="flex flex-col gap-3 rounded-2xl border border-surface-border p-4">
            <legend className="px-1 text-sm font-medium text-ink">טופס פנייה</legend>
            <Checkbox
              label="הצגת טופס פנייה באתר"
              checked={s.form.enabled}
              onChange={(e) => onChange({ form: { ...s.form, enabled: e.target.checked } })}
            />
            {s.form.enabled && (
              <>
                <p className="text-xs text-ink-muted">
                  שם וטלפון הם תמיד חובה. כל פנייה נכנסת כליד ומגיעה אליך באימייל.
                </p>
                <Checkbox
                  label="שדה אימייל"
                  checked={s.form.askEmail}
                  onChange={(e) => onChange({ form: { ...s.form, askEmail: e.target.checked } })}
                />
                <Checkbox
                  label="שדה הודעה חופשית"
                  checked={s.form.askMessage}
                  onChange={(e) => onChange({ form: { ...s.form, askMessage: e.target.checked } })}
                />
                <Checkbox
                  label="בקשת תור: שירות, תאריך ושעה (מגיע לאישור ביומן התורים)"
                  checked={s.form.askAppointment}
                  onChange={(e) =>
                    onChange({ form: { ...s.form, askAppointment: e.target.checked } })
                  }
                />
                <Field
                  label="טקסט כפתור השליחה"
                  maxLength={40}
                  value={s.form.buttonLabel}
                  onChange={(e) => onChange({ form: { ...s.form, buttonLabel: e.target.value } })}
                />
                <Textarea
                  label="הודעה אחרי שליחה"
                  rows={2}
                  maxLength={SITE_LIMITS.shortText}
                  value={s.form.successMessage}
                  onChange={(e) =>
                    onChange({ form: { ...s.form, successMessage: e.target.value } })
                  }
                />
              </>
            )}
          </fieldset>
        </div>
      );
    case 'cta':
      return (
        <div className="flex flex-col gap-4">
          <OnPageNote />
          <Txt>{titleField(s, onChange)}</Txt>
          <Txt>
            <Textarea
              label="טקסט"
              maxLength={SITE_LIMITS.shortText}
              value={s.subtitle}
              onChange={(e) => onChange({ subtitle: e.target.value })}
            />
          </Txt>
          <Txt>
            <Field
              label="טקסט הכפתור"
              maxLength={40}
              value={s.buttonLabel}
              hint="הכפתור מחייג לעסק"
              onChange={(e) => onChange({ buttonLabel: e.target.value })}
            />
          </Txt>
        </div>
      );
  }
}
