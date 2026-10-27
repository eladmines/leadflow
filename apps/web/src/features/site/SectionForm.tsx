import { HERO_ACTIONS, heroActionLabels, SITE_LIMITS, type Section } from '@leadflow/shared';
import { Checkbox, Field, Select, Textarea } from '../../components/ui';
import { ItemsEditor } from './ItemsEditor';

type Patch = (patch: Partial<Section>) => void;

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
          {titleField(s, onChange)}
          <Textarea
            label="משפט פתיחה"
            maxLength={SITE_LIMITS.shortText}
            value={s.subtitle}
            onChange={(e) => onChange({ subtitle: e.target.value })}
          />
          <Field
            label="טקסט הכפתור"
            maxLength={40}
            value={s.buttonLabel}
            onChange={(e) => onChange({ buttonLabel: e.target.value })}
          />
          <Select
            label="מה קורה בלחיצה על הכפתור"
            options={HERO_ACTIONS.map((a) => ({ value: a, label: heroActionLabels[a] }))}
            value={s.buttonAction}
            onChange={(e) =>
              onChange({ buttonAction: e.target.value as (typeof HERO_ACTIONS)[number] })
            }
          />
        </div>
      );
    case 'about':
      return (
        <div className="flex flex-col gap-4">
          {titleField(s, onChange)}
          <Textarea
            label="טקסט"
            rows={8}
            maxLength={SITE_LIMITS.body}
            hint="שורה ריקה יוצרת פסקה חדשה"
            value={s.body}
            onChange={(e) => onChange({ body: e.target.value })}
          />
        </div>
      );
    case 'services':
      return (
        <div className="flex flex-col gap-4">
          {titleField(s, onChange)}
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
        </div>
      );
    case 'pricing':
      return (
        <div className="flex flex-col gap-4">
          {titleField(s, onChange)}
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
          <Textarea
            label="הערה מתחת למחירון"
            maxLength={SITE_LIMITS.shortText}
            value={s.note}
            onChange={(e) => onChange({ note: e.target.value })}
          />
        </div>
      );
    case 'testimonials':
      return (
        <div className="flex flex-col gap-4">
          {titleField(s, onChange)}
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
        </div>
      );
    case 'faq':
      return (
        <div className="flex flex-col gap-4">
          {titleField(s, onChange)}
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
        </div>
      );
    case 'contact':
      return (
        <div className="flex flex-col gap-4">
          {titleField(s, onChange)}
          <Textarea
            label="משפט פתיחה"
            maxLength={SITE_LIMITS.shortText}
            value={s.subtitle}
            onChange={(e) => onChange({ subtitle: e.target.value })}
          />
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
        </div>
      );
    case 'cta':
      return (
        <div className="flex flex-col gap-4">
          {titleField(s, onChange)}
          <Textarea
            label="טקסט"
            maxLength={SITE_LIMITS.shortText}
            value={s.subtitle}
            onChange={(e) => onChange({ subtitle: e.target.value })}
          />
          <Field
            label="טקסט הכפתור"
            maxLength={40}
            value={s.buttonLabel}
            hint="הכפתור מחייג לעסק"
            onChange={(e) => onChange({ buttonLabel: e.target.value })}
          />
        </div>
      );
  }
}
