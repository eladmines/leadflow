import type { AttributionSource, LEAD_SOURCES } from '@leadflow/shared';
import {
  CircleHelp,
  Facebook,
  Globe,
  Link2,
  Mail,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  PenLine,
} from 'lucide-react';
import { cn } from '../../lib/cn';

type IconProps = { className?: string };

/** Google's "G", in Google blue. */
const Google = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className} fill="#4285F4">
    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
  </svg>
);

const TikTok = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
  </svg>
);

/** Microsoft's four squares. */
const Microsoft = ({ className }: IconProps) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className}>
    <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
    <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
    <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
    <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
  </svg>
);

/** Where a lead came from (F26): the ad network's or site's mark, beside its written name. */
export function AttributionIcon({
  source,
  className = 'h-3.5 w-3.5',
}: {
  source: AttributionSource | 'unknown';
  className?: string;
}) {
  switch (source) {
    case 'google_ads':
    case 'google':
      return <Google className={className} />;
    case 'meta_ads':
    case 'meta':
      return <Facebook aria-hidden className={cn(className, 'text-[#1877F2]')} />;
    case 'tiktok':
      return <TikTok className={cn(className, 'text-black')} />;
    case 'microsoft_ads':
      return <Microsoft className={className} />;
    case 'utm':
      return <Megaphone aria-hidden className={cn(className, 'text-amber-600')} />;
    case 'referral':
      return <Link2 aria-hidden className={cn(className, 'text-violet-600')} />;
    case 'direct':
      return <MousePointerClick aria-hidden className={cn(className, 'text-slate-600')} />;
    default:
      return <CircleHelp aria-hidden className={cn(className, 'text-slate-400')} />;
  }
}

/** How a lead arrived: the website form, WhatsApp, Facebook, or typed in by hand. */
export function LeadSourceIcon({
  source,
  className = 'h-4 w-4',
}: {
  source: (typeof LEAD_SOURCES)[number];
  className?: string;
}) {
  switch (source) {
    case 'whatsapp':
      return <MessageCircle aria-hidden className={cn(className, 'text-[#25D366]')} />;
    case 'facebook':
      return <Facebook aria-hidden className={cn(className, 'text-[#1877F2]')} />;
    case 'website_form':
      return <Globe aria-hidden className={cn(className, 'text-sky-600')} />;
    case 'email':
      return <Mail aria-hidden className={cn(className, 'text-sky-600')} />;
    default:
      return <PenLine aria-hidden className={cn(className, 'text-slate-500')} />;
  }
}
