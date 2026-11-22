import { deepLinkRoutes } from '@/core/linking/deepLinkRoutes';

import type { Services } from './container';

const registered = new WeakSet<Services>();


export function registerModules(services: Services): void {
  if (registered.has(services)) return;
  registered.add(services);

  services.deepLinks.registerAll(deepLinkRoutes);


}