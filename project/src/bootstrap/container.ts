import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseClient } from '@/core/backend/supabase/createSupabaseClient';
import { env } from '@/core/config/env';
import type { DeviceInfoProvider } from '@/core/device/DeviceInfoProvider';
import { ExpoDeviceInfoProvider } from '@/core/device/ExpoDeviceInfoProvider';
import { AppEvents } from '@/core/events/AppEvents';
import { EventBus } from '@/core/events/EventBus';
import { FetchHttpClient } from '@/core/http/FetchHttpClient';
import { AuthInterceptor } from '@/core/http/interceptors/AuthInterceptor';
import { ErrorMappingInterceptor } from '@/core/http/interceptors/ErrorMappingInterceptor';
import { LoggingInterceptor } from '@/core/http/interceptors/LoggingInterceptor';
import { RetryInterceptor } from '@/core/http/interceptors/RetryInterceptor';
import { i18n } from '@/core/i18n/i18n';
import { ConsoleLogger } from '@/core/logging/ConsoleLogger';
import type { Logger } from '@/core/logging/Logger';
import { ExpoNotificationScheduler } from '@/core/notifications/ExpoNotificationScheduler';
import type { NotificationScheduler } from '@/core/notifications/NotificationScheduler';
import { queryClient } from '@/core/query/queryClient';
import type { Registry } from '@/core/registry/Registry';
import { AsyncStorageAdapter } from '@/core/storage/AsyncStorageAdapter';
import type { KeyValueStorage } from '@/core/storage/KeyValueStorage';
import { SecureStoreAdapter } from '@/core/storage/SecureStoreAdapter';
import type { SecureStorage } from '@/core/storage/SecureStorage';
import {
  OmdbImdbRatingSource,
  TmdbClient,
  TmdbDiscoverRepository,
  TmdbGenreRepository,
  TmdbImageUrlBuilder,
  TmdbPersonRepository,
  TmdbRatingSource,
  TmdbTitleRepository,
  GetRecommendations,
  GetSeason,
  GetTitleDetails,
  type DiscoverRepository,
  type GenreRepository,
  type PersonRepository,
  type RatingSource,
  type TitleRepository,
} from '@/features/catalog';
import {
  createHomeRowRegistry,
  emptyHomeSources,
  type HomeRow,
  type HomeSources,
} from '@/features/home';
import {
  CancelReminder,
  ScheduleReminder,
  SupabaseReminderRepository,
  type ReminderRepository,
} from '@/features/newhot';
import {
  AsyncOnboardingRepository,
  createOnboardingStepRegistry,
  type OnboardingRepository,
  type OnboardingStep,
} from '@/features/onboarding';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const OMDB_BASE_URL = 'https://www.omdbapi.com';

function toTmdbLanguage(language: string): string {
  const normalized = language.toLowerCase();
  if (normalized.startsWith('az')) return 'az-AZ';
  if (normalized.startsWith('ru')) return 'ru-RU';
  return 'en-US';
}

export type OnboardingServices = {
  repository: OnboardingRepository;
  steps: Registry<OnboardingStep>;
};

export type CatalogServices = {
  client: TmdbClient;
  discover: DiscoverRepository;
  titles: TitleRepository;
  genres: GenreRepository;
  people: PersonRepository;
  ratingSources: RatingSource[];
  getTitleDetails: GetTitleDetails;
  getSeason: GetSeason;
  getRecommendations: GetRecommendations;
};

export type HomeServices = {
  rows: Registry<HomeRow>;
  sources: HomeSources;
};

export type NewHotServices = {
  repository: ReminderRepository;
  schedule: ScheduleReminder;
  cancel: CancelReminder;
};

export type Services = {
  supabase: SupabaseClient;
  storage: KeyValueStorage;
  secureStorage: SecureStorage;
  logger: Logger;
  events: EventBus<AppEvents>;
  deviceInfo: DeviceInfoProvider;
  queryClient: typeof queryClient;
  notifications: NotificationScheduler;
  onboarding: OnboardingServices;
  catalog: CatalogServices;
  home: HomeServices;
  newHot: NewHotServices;
};

function createOnboardingServices({ storage }: { storage: KeyValueStorage }): OnboardingServices {
  return {
    repository: new AsyncOnboardingRepository(storage),
    steps: createOnboardingStepRegistry(),
  };
}

function createCatalogServices({ logger }: { logger: Logger }): CatalogServices {
 const tmdbHttp = new FetchHttpClient({
    baseUrl: TMDB_BASE_URL,
    interceptors: [
      new LoggingInterceptor(logger),
      new ErrorMappingInterceptor(),
      new RetryInterceptor(),
      new AuthInterceptor(() => env.tmdbToken),
    ],
  });
  const omdbHttp = new FetchHttpClient({
    baseUrl: OMDB_BASE_URL,
    interceptors: [new ErrorMappingInterceptor(), new RetryInterceptor()],
  });

  const client = new TmdbClient({
    http: tmdbHttp,
    getLanguage: () => toTmdbLanguage(i18n.language),
  });
  const images = new TmdbImageUrlBuilder();
  const titles = new TmdbTitleRepository(client, images);

  return {
    client,
    discover: new TmdbDiscoverRepository(client, images),
    titles,
    genres: new TmdbGenreRepository(client),
    people: new TmdbPersonRepository(client, images),
    ratingSources: [new TmdbRatingSource(), new OmdbImdbRatingSource(omdbHttp, env.omdbKey)],
    getTitleDetails: new GetTitleDetails(titles),
    getSeason: new GetSeason(titles),
    getRecommendations: new GetRecommendations(titles),
  };
}

function createHomeServices(): HomeServices {
  return {
    rows: createHomeRowRegistry(),
    sources: emptyHomeSources,
  };
}

function createNewHotServices({
  supabase,
  notifications,
}: {
  supabase: SupabaseClient;
  notifications: NotificationScheduler;
}): NewHotServices {
  const repository = new SupabaseReminderRepository(supabase);
  return {
    repository,
    schedule: new ScheduleReminder(repository, notifications),
    cancel: new CancelReminder(repository, notifications),
  };
}

export function createServices(): Services {
  const supabase = createSupabaseClient();
  const storage = new AsyncStorageAdapter();
  const secureStorage = new SecureStoreAdapter();
  const logger = new ConsoleLogger();
  const events = new EventBus<AppEvents>();
  const deviceInfo = new ExpoDeviceInfoProvider();
  const notifications = new ExpoNotificationScheduler();

  return {
    supabase,
    storage,
    secureStorage,
    logger,
    events,
    deviceInfo,
    queryClient,
    notifications,
    onboarding: createOnboardingServices({ storage }),
    catalog: createCatalogServices({ logger }),
    home: createHomeServices(),
    newHot: createNewHotServices({ supabase, notifications }),
  };
}