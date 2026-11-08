import type { TemplateKey } from './site';
import type { SiteBusinessInfo, SiteDraft } from './site-templates';

/** The contact form's defaults on an English site (D-142). */
export const DEFAULT_CONTACT_FORM_EN = {
  enabled: true,
  askEmail: true,
  askMessage: true,
  buttonLabel: 'Send',
  successMessage: "Thank you! We've received your details and will get back to you soon.",
  askAppointment: false,
};

/** English starting content for a new site (D-142); same sections and ids as the Hebrew one. */
export function buildTemplateDraftEn(templateKey: TemplateKey, b: SiteBusinessInfo): SiteDraft {
  const areas = b.serviceAreas.length ? b.serviceAreas.join(', ') : '';
  const theme = { language: 'en' as const, logoAssetId: null };
  const form = DEFAULT_CONTACT_FORM_EN;

  if (templateKey === 'beauty') {
    return {
      templateKey,
      theme: { ...theme, palette: 'rose', font: 'rubik' },
      seo: {
        title: b.name.slice(0, 70),
        description:
          `${b.name} — professional treatments in a relaxed setting. Book your appointment today.`.slice(
            0,
            160,
          ),
      },
      sections: [
        {
          id: 'hero',
          type: 'hero',
          visible: true,
          title: b.name,
          subtitle:
            'Professional treatments in a warm, personal setting. We look forward to seeing you!',
          buttonLabel: 'Book an appointment',
          buttonAction: b.phone ? 'call' : 'contact',
          imageAssetId: null,
        },
        {
          id: 'services',
          type: 'services',
          visible: true,
          title: 'Our treatments',
          items: [
            { name: 'Cut & style', description: 'Tailored to your face shape and personal style.' },
            {
              name: 'Colour & highlights',
              description: 'Quality colours that keep your hair healthy.',
            },
            { name: 'Facials', description: 'Cleansing, nourishing and refreshing your skin.' },
          ],
        },
        {
          id: 'pricing',
          type: 'pricing',
          visible: true,
          title: 'Prices',
          note: 'Prices vary with hair length and type of treatment.',
          items: [
            { name: "Women's haircut", price: '$45' },
            { name: "Men's haircut", price: '$25' },
            { name: 'Root colour', price: '$65' },
          ],
        },
        {
          id: 'about',
          type: 'about',
          visible: true,
          title: 'Nice to meet you',
          body: `At ${b.name} we believe every visit should be a moment of pampering. We use quality products, give every client personal attention and keep to time.`,
          imageAssetId: null,
          imageAlt: '',
        },
        {
          id: 'testimonials',
          type: 'testimonials',
          visible: true,
          title: 'What our clients say',
          items: [
            {
              quote: 'Amazing service and exactly the result I wanted. Highly recommended!',
              author: 'Emma',
            },
            {
              quote: 'Professional, patient and a lovely atmosphere. Already booked my next visit.',
              author: 'Olivia',
            },
          ],
        },
        {
          id: 'faq',
          type: 'faq',
          visible: false,
          title: 'FAQ',
          items: [
            {
              question: 'Do I need to book ahead?',
              answer:
                "We recommend booking ahead. We'll do our best to fit in walk-ins when we can.",
            },
            {
              question: 'Is there parking nearby?',
              answer: "Yes, there's public parking a short walk away.",
            },
          ],
        },
        {
          id: 'contact',
          type: 'contact',
          visible: true,
          title: 'Contact us',
          subtitle: "We'd be happy to answer any question and book your appointment.",
          showPhone: true,
          showAddress: true,
          showHours: true,
          form: { ...form, askAppointment: true },
        },
      ],
    };
  }

  if (templateKey === 'garage') {
    return {
      templateKey,
      theme: { ...theme, palette: 'graphite', font: 'heebo' },
      seo: {
        title: b.name.slice(0, 70),
        description:
          `${b.name} — servicing, repairs and MOT preparation${areas ? ` in ${areas}` : ''}. Book your service today.`.slice(
            0,
            160,
          ),
      },
      sections: [
        {
          id: 'hero',
          type: 'hero',
          visible: true,
          title: b.name,
          subtitle:
            'Regular servicing, repairs and computer diagnostics. A clear price before we start, and your car back on time.',
          buttonLabel: 'Book a service',
          buttonAction: b.phone ? 'call' : 'contact',
          imageAssetId: null,
        },
        {
          id: 'services',
          type: 'services',
          visible: true,
          title: 'What we do',
          items: [
            {
              name: 'Regular servicing',
              description: "Oil, filters and checks to the manufacturer's schedule.",
            },
            {
              name: 'Computer diagnostics',
              description: 'Finding the fault precisely before replacing parts.',
            },
            {
              name: 'Mechanics & brakes',
              description: 'Engine, suspension, brake and clutch repairs.',
            },
            {
              name: 'MOT preparation',
              description: 'A pre-check and fixing whatever is needed to pass first time.',
            },
          ],
        },
        {
          id: 'about',
          type: 'about',
          visible: true,
          title: 'Why us',
          body: `At ${b.name} we explain what needs fixing and why, give you a quote before any work, and never replace a part without your approval.`,
          imageAssetId: null,
          imageAlt: '',
        },
        {
          id: 'pricing',
          type: 'pricing',
          visible: false,
          title: 'Sample prices',
          note: "The final price depends on your car's model. We're happy to quote over the phone.",
          items: [
            { name: 'Oil & filter service', price: 'From $95' },
            { name: 'MOT preparation', price: 'From $70' },
          ],
        },
        {
          id: 'testimonials',
          type: 'testimonials',
          visible: true,
          title: 'Our customers say',
          items: [
            {
              quote:
                "They explained exactly what was needed and didn't try to sell me anything else.",
              author: 'James',
            },
            { quote: 'The car was ready the same day, at the price we agreed.', author: 'Sarah' },
          ],
        },
        {
          id: 'faq',
          type: 'faq',
          visible: true,
          title: 'FAQ',
          items: [
            {
              question: 'Do I need to book ahead?',
              answer: 'We recommend booking so we can start on your car as soon as you arrive.',
            },
            {
              question: 'Can I get a quote before the repair?',
              answer:
                "Yes. After the diagnosis we'll tell you the price and only start once you approve.",
            },
          ],
        },
        {
          id: 'cta',
          type: 'cta',
          visible: true,
          title: 'Does your car need a service?',
          subtitle: "Call us and we'll find you an early slot.",
          buttonLabel: 'Talk to us',
        },
        {
          id: 'contact',
          type: 'contact',
          visible: true,
          title: 'Find us',
          subtitle: "Leave your details and we'll get back to you to arrange a time.",
          showPhone: true,
          showAddress: true,
          showHours: true,
          form: { ...form, askAppointment: true },
        },
      ],
    };
  }

  if (templateKey === 'clinic') {
    return {
      templateKey,
      theme: { ...theme, palette: 'teal', font: 'assistant' },
      seo: {
        title: b.name.slice(0, 70),
        description:
          `${b.name} — professional, personal care in a calm setting. Book an introductory session.`.slice(
            0,
            160,
          ),
      },
      sections: [
        {
          id: 'hero',
          type: 'hero',
          visible: true,
          title: b.name,
          subtitle:
            "Professional, personal care at your own pace in a calm setting. We'll start with an introductory session and plan the way together.",
          buttonLabel: 'Book a session',
          buttonAction: 'contact',
          imageAssetId: null,
        },
        {
          id: 'services',
          type: 'services',
          visible: true,
          title: 'How I can help',
          items: [
            {
              name: 'Introductory session',
              description: 'A first conversation to understand your needs and goals.',
            },
            {
              name: 'Personal care plan',
              description: 'A process tailored to you, with clear goals.',
            },
            {
              name: 'Ongoing support',
              description: 'Checking progress and updating the plan along the way.',
            },
          ],
        },
        {
          id: 'about',
          type: 'about',
          visible: true,
          title: 'Nice to meet you',
          body: 'Tell visitors about your training, experience and approach, and who your care is for.',
          imageAssetId: null,
          imageAlt: '',
        },
        {
          id: 'testimonials',
          type: 'testimonials',
          visible: true,
          title: 'What clients say',
          items: [
            {
              quote: 'I felt truly listened to. The process changed my daily routine.',
              author: 'Hannah',
            },
            {
              quote: 'Professional, patient and personal from the very first session.',
              author: 'Daniel',
            },
          ],
        },
        {
          id: 'faq',
          type: 'faq',
          visible: true,
          title: 'FAQ',
          items: [
            {
              question: 'How long is a session?',
              answer: 'A regular session lasts about an hour. The introductory session is shorter.',
            },
            {
              question: 'Is it covered by insurance?',
              answer:
                "Some health insurance plans cover part of the cost. We'll gladly give you a proper receipt.",
            },
            {
              question: 'How do I book a first session?',
              answer:
                "Leave your details in the form or call, and we'll find a time that suits you.",
            },
          ],
        },
        {
          id: 'contact',
          type: 'contact',
          visible: true,
          title: 'Book a session',
          subtitle:
            "Leave your details and I'll get back to you to arrange a time. Your details are kept private.",
          showPhone: true,
          showAddress: true,
          showHours: true,
          form: { ...form, askAppointment: true },
        },
      ],
    };
  }

  if (templateKey === 'food') {
    return {
      templateKey,
      theme: { ...theme, palette: 'forest', font: 'frank' },
      seo: {
        title: b.name.slice(0, 70),
        description:
          `${b.name} — fresh food, good coffee and a warm atmosphere. Book a table or an event.`.slice(
            0,
            160,
          ),
      },
      sections: [
        {
          id: 'hero',
          type: 'hero',
          visible: true,
          title: b.name,
          subtitle:
            'Fresh food made on site, good coffee and an atmosphere that makes you want to stay. See you soon.',
          buttonLabel: 'Book a table',
          buttonAction: b.phone ? 'call' : 'contact',
          imageAssetId: null,
        },
        {
          id: 'services',
          type: 'services',
          visible: true,
          title: 'What we offer',
          items: [
            {
              name: 'Breakfast',
              description: 'Every morning, with fresh bread and local produce.',
            },
            {
              name: 'Lunch & dinner',
              description: "Seasonal dishes that change with what's fresh at the market.",
            },
            { name: 'Small events', description: 'Birthdays, meetings and family celebrations.' },
          ],
        },
        {
          id: 'pricing',
          type: 'pricing',
          visible: true,
          title: 'From the menu',
          note: 'The full menu and current prices are available on site.',
          items: [
            { name: 'Breakfast for two', price: '$38' },
            { name: 'House salad', price: '$15' },
            { name: 'Coffee & pastry', price: '$8' },
          ],
        },
        {
          id: 'about',
          type: 'about',
          visible: true,
          title: 'Our story',
          body: `${b.name} was born from a love of simple, good food. We make everything on site, work with local suppliers and love seeing familiar faces.`,
          imageAssetId: null,
          imageAlt: '',
        },
        {
          id: 'testimonials',
          type: 'testimonials',
          visible: true,
          title: 'What people say',
          items: [
            {
              quote: 'The best breakfast in the area, with warm and quick service.',
              author: 'Tom',
            },
            { quote: 'We celebrated a birthday here and everything was perfect.', author: 'Lucy' },
          ],
        },
        {
          id: 'faq',
          type: 'faq',
          visible: false,
          title: 'FAQ',
          items: [
            {
              question: 'Do you have vegan dishes?',
              answer: 'Yes, the menu has several vegan and vegetarian dishes.',
            },
            {
              question: 'Can I book for an event?',
              answer: "Of course. Leave your details and we'll get back to you with an offer.",
            },
          ],
        },
        {
          id: 'contact',
          type: 'contact',
          visible: true,
          title: 'Bookings & events',
          subtitle: 'Want to reserve a table or celebrate with us? Leave your details.',
          showPhone: true,
          showAddress: true,
          showHours: true,
          form: { ...form },
        },
      ],
    };
  }

  return {
    templateKey,
    theme: { ...theme, palette: 'navy', font: 'heebo' },
    seo: {
      title: b.name.slice(0, 70),
      description:
        `${b.name} — professional, reliable and fast service${areas ? ` in ${areas}` : ''}. Call now.`.slice(
          0,
          160,
        ),
    },
    sections: [
      {
        id: 'hero',
        type: 'hero',
        visible: true,
        title: b.name,
        subtitle: `Professional, reliable and fast service${areas ? ` in ${areas}` : ''}. Clean work, always on time.`,
        buttonLabel: 'Call now',
        buttonAction: b.phone ? 'call' : 'contact',
        imageAssetId: null,
      },
      {
        id: 'services',
        type: 'services',
        visible: true,
        title: 'Our services',
        items: [
          {
            name: 'Repairs & faults',
            description: 'Quick diagnosis, and fixed on the spot in most cases.',
          },
          {
            name: 'Installations',
            description: 'Professional installation to standard, with a warranty.',
          },
          { name: 'Emergency service', description: 'Available for urgent calls too.' },
        ],
      },
      {
        id: 'about',
        type: 'about',
        visible: true,
        title: 'Why choose us',
        body: 'Years of experience, a fair price agreed in advance and a warranty on our work. We arrive on time, leave the place clean and answer the phone.',
        imageAssetId: null,
        imageAlt: '',
      },
      {
        id: 'testimonials',
        type: 'testimonials',
        visible: true,
        title: 'Customers recommend us',
        items: [
          {
            quote: 'They came the same day, fixed the problem and charged a fair price.',
            author: 'Mark',
          },
          {
            quote: 'Clean, professional work. We will definitely call them again.',
            author: 'Rachel',
          },
        ],
      },
      {
        id: 'faq',
        type: 'faq',
        visible: true,
        title: 'FAQ',
        items: [
          {
            question: 'How much does a call-out cost?',
            answer:
              'The price is agreed in advance over the phone, based on the job. No surprises.',
          },
          { question: 'Is the work guaranteed?', answer: 'Yes, every job comes with a warranty.' },
        ],
      },
      {
        id: 'cta',
        type: 'cta',
        visible: true,
        title: 'Need help now?',
        subtitle: "Call us and we'll get back to you soon.",
        buttonLabel: 'Talk to us',
      },
      {
        id: 'contact',
        type: 'contact',
        visible: true,
        title: 'Contact us',
        subtitle: areas ? `We serve ${areas}.` : "We'd be happy to help.",
        showPhone: true,
        showAddress: true,
        showHours: true,
        form: { ...form },
      },
    ],
  };
}

/** What each bundled sample photo shows, in English. */
export const STOCK_ABOUT_ALT_EN: Record<TemplateKey, string> = {
  beauty: 'Hair styling stations in a salon',
  trades: 'Work on an electrical panel',
  garage: "A mechanic checking a car's engine",
  clinic: 'A bright treatment room',
  food: 'A table set for breakfast',
};

/** Starting text for sections and pages the owner adds on an English site. */
export const NEW_SECTION_EN = {
  heroTitle: 'New title',
  contactButton: 'Contact us',
  about: 'About',
  gallery: 'Gallery',
  services: 'Our services',
  service: 'Service',
  pricing: 'Prices',
  testimonials: 'Reviews',
  faq: 'FAQ',
  contact: 'Contact us',
  cta: 'Ready to start?',
} as const;

export const PAGE_TITLES_EN = {
  about: 'About',
  services: 'Services',
  gallery: 'Gallery',
  faq: 'FAQ',
  contact: 'Contact',
  landing: 'Landing page',
  blank: 'Blank page',
} as const;
