import type { BotTextKey } from './whatsapp';

/** English WhatsApp texts for businesses whose customer language is English (D-143). */

export const AUTO_REPLY_DEFAULT_EN =
  "Hi! Thanks for writing to {business} 🙏 We've got your message and will get back to you soon.";

export const STATUS_PRESETS_EN = [
  {
    id: 'event',
    label: 'At an event',
    text: "Hi! I'm at an event right now 🎉 I'll get back to you soon. Meanwhile, here's a taste of what's happening:",
  },
  {
    id: 'meeting',
    label: 'In a meeting',
    text: "Hi! I'm in a meeting right now, I'll get back to you shortly 🙏",
  },
  {
    id: 'vacation',
    label: 'On vacation',
    text: "Hi! We're on a short break 🌴 We'll be back to answer soon. Thanks for your patience!",
  },
  {
    id: 'closed',
    label: 'Closed now',
    text: "Hi! We're closed right now 🌙 We'll get back to you when we open.",
  },
] as const;

export const BOT_DEFAULT_TEXTS_EN: Record<BotTextKey, string> = {
  greeting:
    'Hello! This is {business} 👋\nWould you like to book an appointment? Choose a service:',
  confirmed:
    "Great! You're booked for {service} on {time} ✅\nSee you at {business}! To change or cancel, just write to us here.",
  pending: "We've received your request for {service} on {time} 🙏\nWe'll confirm here soon.",
  handoff: "Sure! We've passed the chat to the team, we'll get back to you here soon 🙂",
  noTimes:
    "Sorry, there are no free times in the next two weeks. We've passed your request to the team and will get back to you here 🙏",
  eventReceived:
    "Thank you! We've received the details for {service} on {time} 🙏\nWe'll get back to you soon with a proper offer.",
  dateTaken: 'That date is already booked 😕 Would you like to check another date?',
};

export const INDUSTRY_TEXTS_EN: Record<string, Partial<Record<BotTextKey, string>>> = {
  studio: {
    greeting: 'Hi! This is {business} 💪\nWould you like to book a class or a session? Choose:',
    confirmed:
      "Great! We've saved you {service} on {time} ✅\nSee you at {business}! To change or cancel, write to us here.",
    pending:
      "We've received your request for {service} on {time} 🙏\nWe'll confirm your place soon.",
  },
  therapy: {
    greeting:
      'Hello, this is {business}.\nWould you like to book a session? Choose the type of session:',
    confirmed:
      'Your session is booked: {service}, {time} ✅\nTo change or cancel, you can write here.',
    pending: "I've received your request for a session on {time} 🙏\nI'll confirm soon.",
    handoff: "Sure, I've passed the chat on. I'll get back to you here soon.",
  },
  tutoring: {
    greeting: 'Hi! This is {business} 📚\nWould you like to book a lesson? Choose:',
    confirmed:
      'Your lesson is booked: {service}, {time} ✅\nTo change or cancel, write to us here.',
    pending: "We've received your request for a lesson on {time} 🙏\nWe'll confirm soon.",
  },
  trades: {
    greeting:
      'Hi! This is {business} 🛠️\nWould you like to arrange a visit? Choose the type of job:',
    confirmed:
      "Great! We've arranged a visit on {time} ({service}) ✅\nTo change or cancel, write to us here.",
    pending: "We've received your request for a visit on {time} 🙏\nWe'll confirm soon.",
  },
  garage: {
    greeting: 'Hi! This is {business} 🔧\nWould you like to book your car in? Choose a service:',
  },
  events: { greeting: 'Hi! This is {business} 🎧\nHow can we help?' },
  catering: {
    greeting: 'Hi! This is {business} 🍽️\nHow can we help?',
    eventReceived:
      "Thank you! We've received the details for {service} on {time} 🙏\nWe'll get back to you soon with an offer and a tailored menu.",
  },
  photo: {
    greeting: 'Hi! This is {business} 📸\nHow can we help?',
    eventReceived:
      "Thank you! We've received the details for the shoot ({service}) on {time} 🙏\nWe'll get back to you soon with an offer.",
  },
};

export const SHOWCASE_TEXTS_EN: Record<string, string> = {
  beauty: "Meanwhile, here's a peek at our work ✂️",
  studio: "Meanwhile, here's a peek at our studio and classes 💪",
  garage: "Meanwhile, here's a little about us and our work 🔧",
  trades: 'Meanwhile, here are some of our recent jobs 🛠️',
  events: "Meanwhile, here's a peek at our events 🎧",
  catering: 'Meanwhile, here are some of our dishes and events 🍽️',
  photo: 'Meanwhile, here are some of our photos 📸',
  therapy: "Meanwhile, here's a little about me and my approach 🌿",
  tutoring: "Meanwhile, here's a little about our lessons 📚",
};
export const SHOWCASE_DEFAULT_EN = "Meanwhile, here's a peek at what we do ✨";

export function eventTypesEn(industry: string): string[] {
  if (industry === 'catering') {
    return [
      'Wedding',
      'Bar/Bat Mitzvah',
      'Company event',
      'Private dinner',
      'Holiday meal',
      'Other',
    ];
  }
  if (industry === 'photo') {
    return [
      'Wedding',
      'Family photos',
      'Maternity & newborn',
      'Company event',
      'Branding & product',
      'Other',
    ];
  }
  return ['Wedding', 'Bar/Bat Mitzvah', 'Birthday', 'Company event', 'Private party', 'Other'];
}
export const eventTypeQuestionEn = (industry: string) =>
  industry === 'photo' ? 'What are we shooting? Choose:' : 'What event are you planning? Choose:';
