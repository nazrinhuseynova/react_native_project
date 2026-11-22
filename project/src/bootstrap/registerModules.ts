import * as Linking from 'expo-linking';

import { deepLinkRoutes } from '@/core/linking/deepLinkRoutes';
import { NotificationTapHandler } from '@/core/notifications/NotificationTapHandler';

import type { Services } from './container';

const registered = new WeakSet<Services>();

export function registerModules(services: Services): void {
  if (registered.has(services)) return;
  registered.add(services);

  services.deepLinks.registerAll(deepLinkRoutes);
 new NotificationTapHandler((url) => {
    void Linking.openURL(url);
  }).start();
}