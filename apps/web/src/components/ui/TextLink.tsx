import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '../../lib/cn';

export const textLinkClasses =
  'font-medium text-brand-600 underline-offset-4 hover:text-brand-700 hover:underline rounded-sm';

/** In-app link with the brand link style. */
export function TextLink({ className, ...rest }: LinkProps) {
  return <Link className={cn(textLinkClasses, className)} {...rest} />;
}
