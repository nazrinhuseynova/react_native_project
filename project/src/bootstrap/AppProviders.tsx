import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { type PropsWithChildren, useEffect, useState } from 'react';

import { createPersistOptions, createQueryPersister } from '@/core/query/asyncPersister';
import { AuthProvider } from '@/features/auth';

import { createServices } from './container';
import { ServicesProvider } from './ServicesProvider';
import { startup } from './startup';

const services = createServices();
const persistOptions = createPersistOptions(createQueryPersister(services.storage));

export function AppProviders({ children }: PropsWithChildren) {
  const [isStarted, setIsStarted] = useState(false);

  useEffect(() => {
    let active = true;

    startup(services)
      .catch((error: unknown) => {
        services.logger.error('startup.failed', { error: String(error) });
      })
      .finally(() => {
        if (active) setIsStarted(true);
      });

    return () => {
      active = false;
    };
  }, []);

  if (!isStarted) return null;

  return (
    <PersistQueryClientProvider client={services.queryClient} persistOptions={persistOptions}>
      <ServicesProvider services={services}>
      
        <AuthProvider>{children}</AuthProvider>
      </ServicesProvider>
    </PersistQueryClientProvider>
  );
}