import { Compass } from 'lucide-react';
import { createContext, useContext } from 'react';
import { Button } from '../../components/ui';
import { pageTours, usePageKey, type PageKey } from './pageTours';
import { tr } from '../../i18n';

interface Tours {
  startMainTour: () => void;
  startPageTour: (page: PageKey) => void;
}

const ToursContext = createContext<Tours | null>(null);

/** Provided by the business layout, which renders the tours. */
export const ToursProvider = ToursContext.Provider;

/** "סיור בעמוד": runs this screen's tour (D-096). Renders nothing on screens without one. */
export function PageTourButton() {
  const tours = useContext(ToursContext);
  const page = usePageKey();
  if (!tours || !page || pageTours[page].length === 0) return null;
  return (
    <Button variant="ghost" size="sm" onClick={() => tours.startPageTour(page)}>
      <Compass aria-hidden className="h-4 w-4" />
      {tr('סיור בעמוד')}
    </Button>
  );
}
