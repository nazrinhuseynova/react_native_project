import type { SupabaseClient } from '@supabase/supabase-js';
import type { QueryClient } from '@tanstack/react-query';

import { AnalyticsService } from '@/core/analytics/AnalyticsService';
import type { AnalyticsSink } from '@/core/analytics/AnalyticsSink';
import { ConsoleSink } from '@/core/analytics/sinks/ConsoleSink';
import { SupabaseSink } from '@/core/analytics/sinks/SupabaseSink';
import { createSupabaseClient } from '@/core/backend/supabase/createSupabaseClient';
import { env } from '@/core/config/env';
import { featureFlags } from '@/core/config/featureFlags';
import type { DeviceInfoProvider } from '@/core/device/DeviceInfoProvider';
import { ExpoDeviceInfoProvider } from '@/core/device/ExpoDeviceInfoProvider';
import type { AppEvents } from '@/core/events/AppEvents';
import { EventBus, type EventBus as EventBusType } from '@/core/events/EventBus';
import { DeepLinkRegistry } from '@/core/linking/DeepLinkRegistry';
import { ConsoleLogger } from '@/core/logging/ConsoleLogger';
import type { Logger } from '@/core/logging/Logger';
import { ExpoNetworkMonitor } from '@/core/network/ExpoNetworkMonitor';
import type { NetworkMonitor } from '@/core/network/NetworkMonitor';
import { createQueryClient } from '@/core/query/queryClient';
import type { Registry } from '@/core/registry/Registry';
import { Hasher } from '@/core/security/Hasher';
import { AsyncStorageAdapter } from '@/core/storage/AsyncStorageAdapter';
import type { KeyValueStorage } from '@/core/storage/KeyValueStorage';
import type { SecureStorage } from '@/core/storage/SecureStorage';
import { SecureStoreAdapter } from '@/core/storage/SecureStoreAdapter';
import {
  ChangeEmail,
  ChangePassword,
  DeletionGracePolicy,
  ListDevices,
  RequestAccountDeletion,
  RestoreAccount,
  RevokeDevice,
  StepUpAuthPolicy,
  SupabaseAccountRepository,
  type AccountRepository,
} from '@/features/account';
import {
  BiometricCredentialStore,
  BiometricStrategy,
  createAuthStrategyRegistry,
  EmailOtpStrategy,
  EmailPasswordStrategy,
  GoogleOAuthStrategy,
  LoginAttemptPolicy,
  OtpPolicy,
  PasswordPolicy,
  PasswordStrengthPolicy,
  RequestPasswordReset,
  ResendVerification,
  ResetPassword,
  RestoreSession,
  SignIn,
  SignOut,
  SignOutAllDevices,
  SignUp,
  SupabaseAuthRepository,
  SupabaseDeviceRepository,
  VerifyOtp,
  type AuthRepository,
  type AuthStrategy,
  type BiometricAuthStrategy,
  type DeviceRepository,
} from '@/features/auth';
import {
  BlockTitle,
  CompositePolicy,
  createContentPolicyRegistry,
  FilterTitles,
  SetMaxMaturity,
  SupabaseParentalRepository,
  UnblockTitle,
  type ContentPolicy,
  type ParentalRepository,
} from '@/features/parental';
import {
  CreateProfile,
  DeleteProfile,
  PinHasher,
  PinPolicy,
  ProfileLimitPolicy,
  SetProfilePin,
  SupabaseAvatarStorage,
  SupabaseProfileRepository,
  SwitchProfile,
  UpdateProfile,
  VerifyProfilePin,
  type AvatarStorage,
  type ProfileRepository,
} from '@/features/profiles';

export type AppEventBus = EventBusType<AppEvents>;

export type AuthServices = {
  repository: AuthRepository;
  devices: DeviceRepository;
  strategies: Registry<AuthStrategy>;
  biometric: BiometricAuthStrategy;
  signUp: SignUp;
  signIn: SignIn;
  signOut: SignOut;
  signOutAllDevices: SignOutAllDevices;
  restoreSession: RestoreSession;
  requestPasswordReset: RequestPasswordReset;
  verifyOtp: VerifyOtp;
  resetPassword: ResetPassword;
  resendVerification: ResendVerification;
  policies: {
    password: PasswordPolicy;
    strength: PasswordStrengthPolicy;
    loginAttempt: LoginAttemptPolicy;
    otp: OtpPolicy;
  };
};

export type ProfileServices = {
  repository: ProfileRepository;
  avatars: AvatarStorage;
  create: CreateProfile;
  update: UpdateProfile;
  remove: DeleteProfile;
  switch: SwitchProfile;
  setPin: SetProfilePin;
  verifyPin: VerifyProfilePin;
  policies: {
    limit: ProfileLimitPolicy;
    pin: PinPolicy;
  };
};

export type AccountServices = {
  repository: AccountRepository;
  changePassword: ChangePassword;
  changeEmail: ChangeEmail;
  requestDeletion: RequestAccountDeletion;
  restore: RestoreAccount;
  listDevices: ListDevices;
  revokeDevice: RevokeDevice;
  policies: {
    stepUp: StepUpAuthPolicy;
    grace: DeletionGracePolicy;
  };
};

export type ParentalServices = {
  repository: ParentalRepository;
  registry: Registry<ContentPolicy>;
  policy: CompositePolicy;
  filterTitles: FilterTitles;
  blockTitle: BlockTitle;
  unblockTitle: UnblockTitle;
  setMaxMaturity: SetMaxMaturity;
};

export type Services = {
  logger: Logger;
  eventBus: AppEventBus;
  analytics: AnalyticsService;
  networkMonitor: NetworkMonitor;
  storage: KeyValueStorage;
  secureStorage: SecureStorage;
  deviceInfo: DeviceInfoProvider;
  supabase: SupabaseClient;
  queryClient: QueryClient;
  deepLinks: DeepLinkRegistry;
  auth: AuthServices;
  profiles: ProfileServices;
  account: AccountServices;
  parental: ParentalServices;
};

type AuthDeps = {
  supabase: SupabaseClient;
  secureStorage: SecureStorage;
};

function createAuthServices({ supabase, secureStorage }: AuthDeps): AuthServices {
  const repository = new SupabaseAuthRepository(supabase);
  const devices = new SupabaseDeviceRepository(supabase);
  const biometricStore = new BiometricCredentialStore(secureStorage);
  const biometric = new BiometricStrategy(supabase, biometricStore);


  const strategies = createAuthStrategyRegistry([
    new EmailPasswordStrategy(supabase),
    new GoogleOAuthStrategy(supabase),
    new EmailOtpStrategy(supabase),
    biometric,
  ]);

  const password = new PasswordPolicy();
  const otp = new OtpPolicy();

  return {
    repository,
    devices,
    strategies,
    biometric,
    signUp: new SignUp(strategies, password),
    signIn: new SignIn(strategies),
    signOut: new SignOut(repository),
    signOutAllDevices: new SignOutAllDevices(repository),
    restoreSession: new RestoreSession(repository),
    requestPasswordReset: new RequestPasswordReset(repository),
    verifyOtp: new VerifyOtp(repository, strategies, otp),
    resetPassword: new ResetPassword(repository, password),
    resendVerification: new ResendVerification(repository),
    policies: {
      password,
      strength: new PasswordStrengthPolicy(),
      loginAttempt: new LoginAttemptPolicy(),
      otp,
    },
  };
}

type ProfileDeps = {
  supabase: SupabaseClient;
  storage: KeyValueStorage;
  eventBus: AppEventBus;
};

function createProfileServices({ supabase, storage, eventBus }: ProfileDeps): ProfileServices {
  const repository = new SupabaseProfileRepository(supabase);
  const avatars = new SupabaseAvatarStorage(supabase);
  const crypto = new PinHasher(new Hasher());
  const limit = new ProfileLimitPolicy();
  const pin = new PinPolicy();

  return {
    repository,
    avatars,
    create: new CreateProfile(repository, limit, avatars),
    update: new UpdateProfile(repository, avatars),
    remove: new DeleteProfile(repository, avatars),
    switch: new SwitchProfile(repository, storage, eventBus),
    setPin: new SetProfilePin(repository, crypto, pin, storage),
    verifyPin: new VerifyProfilePin(repository, crypto, pin, storage),
    policies: { limit, pin },
  };
}

type AccountDeps = {
  supabase: SupabaseClient;
  auth: AuthServices;
  deviceInfo: DeviceInfoProvider;
};

function createAccountServices({ supabase, auth, deviceInfo }: AccountDeps): AccountServices {
  const repository = new SupabaseAccountRepository(supabase);
  const grace = new DeletionGracePolicy();

  return {
    repository,
    changePassword: new ChangePassword(repository, auth.policies.password),
    changeEmail: new ChangeEmail(repository),
    requestDeletion: new RequestAccountDeletion(repository, grace),
    restore: new RestoreAccount(repository, grace),
    listDevices: new ListDevices(auth.devices, deviceInfo),
    revokeDevice: new RevokeDevice(auth.devices, deviceInfo),
    policies: { stepUp: new StepUpAuthPolicy(), grace },
  };
}

function createParentalServices({ supabase }: { supabase: SupabaseClient }): ParentalServices {
  const repository = new SupabaseParentalRepository(supabase);
  const registry = createContentPolicyRegistry();
  const policy = new CompositePolicy(registry.all());

  return {
    repository,
    registry,
    policy,
    filterTitles: new FilterTitles(policy),
    blockTitle: new BlockTitle(repository),
    unblockTitle: new UnblockTitle(repository),
    setMaxMaturity: new SetMaxMaturity(repository),
  };
}

export function createServices(): Services {
  const logger = new ConsoleLogger();
  const storage = new AsyncStorageAdapter();
  const secureStorage = new SecureStoreAdapter();
  const networkMonitor = new ExpoNetworkMonitor();
  const supabase = createSupabaseClient({
    url: env.supabaseUrl,
    anonKey: env.supabaseAnonKey,
  });

  const eventBus: AppEventBus = new EventBus<AppEvents>({
    onHandlerError: (error, event) =>
      logger.error('eventbus.handler_failed', { event, error: String(error) }),
  });

  const sinks: AnalyticsSink[] = [new ConsoleSink(logger)];
  if (featureFlags.analytics) sinks.push(new SupabaseSink(supabase));

  const deviceInfo = new ExpoDeviceInfoProvider(secureStorage);
  const auth = createAuthServices({ supabase, secureStorage });

  return {
    logger,
    eventBus,
    analytics: new AnalyticsService(sinks, logger),
    networkMonitor,
    storage,
    secureStorage,
    deviceInfo,
    supabase,
    queryClient: createQueryClient(networkMonitor),
    deepLinks: new DeepLinkRegistry(),
    auth,
    profiles: createProfileServices({ supabase, storage, eventBus }),
    account: createAccountServices({ supabase, auth, deviceInfo }),
    parental: createParentalServices({ supabase }),
  };
}