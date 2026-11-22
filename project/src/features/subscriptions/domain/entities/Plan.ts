export type PlanTier = 'basic' | 'standard' | 'premium';
export type BillingInterval = 'monthly' | 'yearly';

export interface Plan {
  id: string;
  code: PlanTier;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  interval: BillingInterval;
  maxQuality: 'SD' | 'HD' | '4K';
  maxScreens: number;
  hasAds: boolean;
}
```[cite: 11, 12]

### `domain/entities/Subscription.ts`
```ts
export type SubscriptionStatus =
  | 'active'
  | 'canceled_until_period_end'
  | 'past_due'
  | 'expired';

export interface Subscription {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus;
  autoRenew: boolean;
  currentPeriodStart: string; // ISO date
  currentPeriodEnd: string; // ISO date
  canceledAt: string | null;
}
```[cite: 11, 12]

### `domain/repositories/PlanRepository.ts`
```ts
import type { Plan } from '../entities/Plan';

export interface PlanRepository {
  listPlans(): Promise<Plan[]>;
  getPlanById(planId: string): Promise<Plan | null>;
}
```[cite: 11]

### `domain/repositories/SubscriptionRepository.ts`
```ts
import type { Subscription, SubscriptionStatus } from '../entities/Subscription';

export interface CreateSubscriptionInput {
  userId: string;
  planId: string;
  autoRenew: boolean;
  currentPeriodStart: string;
  currentPeriodEnd: string;
}

export interface UpdateSubscriptionInput {
  planId?: string;
  status?: SubscriptionStatus;
  autoRenew?: boolean;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  canceledAt?: string | null;
}

export interface SubscriptionRepository {
  getByUserId(userId: string): Promise<Subscription | null>;
  create(input: CreateSubscriptionInput): Promise<Subscription>;
  update(subscriptionId: string, patch: UpdateSubscriptionInput): Promise<Subscription>;
}
```[cite: 11]

### `domain/services/CancelPolicy.ts`
```ts
import type { Subscription } from '../entities/Subscription';

export interface CancellationDecision {
  retainsAccessUntilPeriodEnd: boolean;
  effectiveEndDate: string;
  nextStatus: 'canceled_until_period_end';
}

export class CancelPolicy {
  evaluate(subscription: Subscription): CancellationDecision {
    return {
      retainsAccessUntilPeriodEnd: true,
      effectiveEndDate: subscription.currentPeriodEnd,
      nextStatus: 'canceled_until_period_end',
    };
  }

  canResume(subscription: Subscription, now: Date = new Date()): boolean {
    if (subscription.status !== 'canceled_until_period_end') {
      return false;
    }
    return new Date(subscription.currentPeriodEnd).getTime() > now.getTime();
  }
}
```[cite: 11, 12]

### `domain/services/ProrationCalculator.ts`
```ts
import type { Plan } from '../entities/Plan';
import type { Subscription } from '../entities/Subscription';

export interface ProrationResult {
  isUpgrade: boolean;
  remainingDays: number;
  creditCents: number;
  chargeDueNowCents: number;
  currency: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class ProrationCalculator {
  calculate(
    subscription: Subscription,
    currentPlan: Plan,
    targetPlan: Plan,
    now: Date = new Date(),
  ): ProrationResult {
    const startMs = new Date(subscription.currentPeriodStart).getTime();
    const endMs = new Date(subscription.currentPeriodEnd).getTime();
    const nowMs = now.getTime();

    const totalPeriodMs = Math.max(MS_PER_DAY, endMs - startMs);
    const remainingMs = Math.max(0, endMs - nowMs);
    const remainingRatio = Math.min(1, remainingMs / totalPeriodMs);
    const remainingDays = Math.max(0, Math.ceil(remainingMs / MS_PER_DAY));

    const isUpgrade = targetPlan.priceCents >= currentPlan.priceCents;
    const creditCents = isUpgrade
      ? Math.round(currentPlan.priceCents * remainingRatio)
      : 0;
    const chargeDueNowCents = isUpgrade
      ? Math.max(0, targetPlan.priceCents - creditCents)
      : 0;

    return {
      isUpgrade,
      remainingDays,
      creditCents,
      chargeDueNowCents,
      currency: targetPlan.currency,
    };
  }
}
```[cite: 11, 12]

### `domain/services/RenewalPolicy.ts`
```ts
import type { Plan } from '../entities/Plan';
import type { Subscription } from '../entities/Subscription';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export class RenewalPolicy {
  isEntitled(subscription: Subscription | null, now: Date = new Date()): boolean {
    if (!subscription) {
      return false;
    }

    const periodEndMs = new Date(subscription.currentPeriodEnd).getTime();
    const isWithinPeriod = periodEndMs > now.getTime();

    if (subscription.status === 'active') {
      return isWithinPeriod;
    }

    if (subscription.status === 'canceled_until_period_end') {
      return isWithinPeriod;
    }

    return false;
  }

  computeNextPeriodEnd(plan: Plan, fromDate: Date = new Date()): string {
    const days = plan.interval === 'yearly' ? 365 : 30;
    return new Date(fromDate.getTime() + days * MS_PER_DAY).toISOString();
  }
}
```[cite: 11, 12]

### `domain/usecases/Subscribe.ts`
```ts
import type { Subscription } from '../entities/Subscription';
import type { PlanRepository } from '../repositories/PlanRepository';
import type { SubscriptionRepository } from '../repositories/SubscriptionRepository';
import { RenewalPolicy } from '../services/RenewalPolicy';

export interface SubscribeInput {
  userId: string;
  planId: string;
  autoRenew?: boolean;
  now?: Date;
}

export class Subscribe {
  constructor(
    private readonly planRepository: PlanRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly renewalPolicy: RenewalPolicy = new RenewalPolicy(),
  ) {}

  async execute(input: SubscribeInput): Promise<Subscription> {
    const plan = await this.planRepository.getPlanById(input.planId);
    if (!plan) {
      throw new Error('Seçilmiş abunəlik planı tapılmadı');
    }

    const now = input.now ?? new Date();
    const periodStart = now.toISOString();
    const periodEnd = this.renewalPolicy.computeNextPeriodEnd(plan, now);
    const autoRenew = input.autoRenew ?? true;

    const existing = await this.subscriptionRepository.getByUserId(input.userId);
    if (existing) {
      return this.subscriptionRepository.update(existing.id, {
        planId: plan.id,
        status: 'active',
        autoRenew,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        canceledAt: null,
      });
    }

    return this.subscriptionRepository.create({
      userId: input.userId,
      planId: plan.id,
      autoRenew,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });
  }
}
```[cite: 11, 12]

### `domain/usecases/ChangePlan.ts`
```ts
import type { Subscription } from '../entities/Subscription';
import type { PlanRepository } from '../repositories/PlanRepository';
import type { SubscriptionRepository } from '../repositories/SubscriptionRepository';
import { ProrationCalculator, type ProrationResult } from '../services/ProrationCalculator';
import { RenewalPolicy } from '../services/RenewalPolicy';

export interface ChangePlanInput {
  userId: string;
  newPlanId: string;
  now?: Date;
}

export interface ChangePlanOutput {
  subscription: Subscription;
  proration: ProrationResult;
}

export class ChangePlan {
  constructor(
    private readonly planRepository: PlanRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly prorationCalculator: ProrationCalculator = new ProrationCalculator(),
    private readonly renewalPolicy: RenewalPolicy = new RenewalPolicy(),
  ) {}

  async execute(input: ChangePlanInput): Promise<ChangePlanOutput> {
    const now = input.now ?? new Date();
    const currentSub = await this.subscriptionRepository.getByUserId(input.userId);
    if (!currentSub) {
      throw new Error('Aktiv abunəlik tapılmadı');
    }

    const [currentPlan, targetPlan] = await Promise.all([
      this.planRepository.getPlanById(currentSub.planId),
      this.planRepository.getPlanById(input.newPlanId),
    ]);

    if (!currentPlan || !targetPlan) {
      throw new Error('Plan məlumatı tapılmadı');
    }

    const proration = this.prorationCalculator.calculate(
      currentSub,
      currentPlan,
      targetPlan,
      now,
    );

    // Upgrade dərhal tətbiq olunur, downgrade isə cari dövr bitdikdən sonra qüvvəyə minir[cite: 12]
    const updated = proration.isUpgrade
      ? await this.subscriptionRepository.update(currentSub.id, {
          planId: targetPlan.id,
          status: 'active',
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: this.renewalPolicy.computeNextPeriodEnd(targetPlan, now),
          canceledAt: null,
        })
      : await this.subscriptionRepository.update(currentSub.id, {
          planId: targetPlan.id,
        });

    return { subscription: updated, proration };
  }
}
```[cite: 11, 12]

### `domain/usecases/CancelSubscription.ts`
```ts
import type { Subscription } from '../entities/Subscription';
import type { SubscriptionRepository } from '../repositories/SubscriptionRepository';
import { CancelPolicy } from '../services/CancelPolicy';

export interface CancelSubscriptionInput {
  userId: string;
  now?: Date;
}

export class CancelSubscription {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly cancelPolicy: CancelPolicy = new CancelPolicy(),
  ) {}

  async execute(input: CancelSubscriptionInput): Promise<Subscription> {
    const now = input.now ?? new Date();
    const currentSub = await this.subscriptionRepository.getByUserId(input.userId);
    if (!currentSub) {
      throw new Error('Ləğv ediləcək abunəlik tapılmadı');
    }

    const decision = this.cancelPolicy.evaluate(currentSub);

    return this.subscriptionRepository.update(currentSub.id, {
      status: decision.nextStatus,
      autoRenew: false,
      canceledAt: now.toISOString(),
    });
  }
}
```[cite: 11, 12]

### `domain/usecases/ResumeSubscription.ts`
```ts
import type { Subscription } from '../entities/Subscription';
import type { SubscriptionRepository } from '../repositories/SubscriptionRepository';
import { CancelPolicy } from '../services/CancelPolicy';

export interface ResumeSubscriptionInput {
  userId: string;
  now?: Date;
}

export class ResumeSubscription {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly cancelPolicy: CancelPolicy = new CancelPolicy(),
  ) {}

  async execute(input: ResumeSubscriptionInput): Promise<Subscription> {
    const now = input.now ?? new Date();
    const currentSub = await this.subscriptionRepository.getByUserId(input.userId);
    if (!currentSub) {
      throw new Error('Bərpa ediləcək abunəlik tapılmadı');
    }

    if (!this.cancelPolicy.canResume(currentSub, now)) {
      throw new Error('Abunəlik müddəti bitib, yenidən abunə olun');
    }

    return this.subscriptionRepository.update(currentSub.id, {
      status: 'active',
      autoRenew: true,
      canceledAt: null,
    });
  }
}
```[cite: 11]

---

## 2. Data qatı (`src/features/subscriptions/data/`)

### `data/SupabasePlanRepository.ts`
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { BillingInterval, Plan, PlanTier } from '../domain/entities/Plan';
import type { PlanRepository } from '../domain/repositories/PlanRepository';

interface PlanRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  price_cents: number;
  currency: string;
  interval: string;
  max_quality: string;
  max_screens: number;
  has_ads: boolean;
}

function mapRowToPlan(row: PlanRow): Plan {
  const code: PlanTier =
    row.code === 'standard' || row.code === 'premium' ? row.code : 'basic';
  const interval: BillingInterval = row.interval === 'yearly' ? 'yearly' : 'monthly';
  const maxQuality: Plan['maxQuality'] =
    row.max_quality === '4K' || row.max_quality === 'HD' ? row.max_quality : 'SD';

  return {
    id: row.id,
    code,
    name: row.name,
    description: row.description ?? '',
    priceCents: row.price_cents,
    currency: row.currency,
    interval,
    maxQuality,
    maxScreens: row.max_screens,
    hasAds: row.has_ads,
  };
}

export class SupabasePlanRepository implements PlanRepository {
  constructor(private readonly client: SupabaseClient) {}

  async listPlans(): Promise<Plan[]> {
    const { data, error } = await this.client
      .from('plans')
      .select('*')
      .order('price_cents', { ascending: true });

    if (error) {
      throw error;
    }

    return ((data ?? []) as PlanRow[]).map(mapRowToPlan);
  }

  async getPlanById(planId: string): Promise<Plan | null> {
    const { data, error } = await this.client
      .from('plans')
      .select('*')
      .eq('id', planId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapRowToPlan(data as PlanRow) : null;
  }
}
```[cite: 11, 12]

### `data/SupabaseSubscriptionRepository.ts`
```ts
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Subscription, SubscriptionStatus } from '../domain/entities/Subscription';
import type {
  CreateSubscriptionInput,
  SubscriptionRepository,
  UpdateSubscriptionInput,
} from '../domain/repositories/SubscriptionRepository';

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  auto_renew: boolean;
  current_period_start: string;
  current_period_end: string;
  canceled_at: string | null;
}

const VALID_STATUSES: SubscriptionStatus[] = [
  'active',
  'canceled_until_period_end',
  'past_due',
  'expired',
];

function mapRowToSubscription(row: SubscriptionRow): Subscription {
  const status: SubscriptionStatus = VALID_STATUSES.includes(
    row.status as SubscriptionStatus,
  )
    ? (row.status as SubscriptionStatus)
    : 'expired';

  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    status,
    autoRenew: row.auto_renew,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    canceledAt: row.canceled_at,
  };
}

export class SupabaseSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getByUserId(userId: string): Promise<Subscription | null> {
    const { data, error } = await this.client
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data ? mapRowToSubscription(data as SubscriptionRow) : null;
  }

  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    const { data, error } = await this.client
      .from('subscriptions')
      .insert({
        user_id: input.userId,
        plan_id: input.planId,
        status: 'active',
        auto_renew: input.autoRenew,
        current_period_start: input.currentPeriodStart,
        current_period_end: input.currentPeriodEnd,
        canceled_at: null,
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return mapRowToSubscription(data as SubscriptionRow);
  }

  async update(
    subscriptionId: string,
    patch: UpdateSubscriptionInput,
  ): Promise<Subscription> {
    const updatePayload: Record<string, unknown> = {};
    if (patch.planId !== undefined) updatePayload.plan_id = patch.planId;
    if (patch.status !== undefined) updatePayload.status = patch.status;
    if (patch.autoRenew !== undefined) updatePayload.auto_renew = patch.autoRenew;
    if (patch.currentPeriodStart !== undefined) {
      updatePayload.current_period_start = patch.currentPeriodStart;
    }
    if (patch.currentPeriodEnd !== undefined) {
      updatePayload.current_period_end = patch.currentPeriodEnd;
    }
    if (patch.canceledAt !== undefined) updatePayload.canceled_at = patch.canceledAt;

    const { data, error } = await this.client
      .from('subscriptions')
      .update(updatePayload)
      .eq('id', subscriptionId)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return mapRowToSubscription(data as SubscriptionRow);
  }
}
```[cite: 11, 12]

---

## 3. Application qatı (`src/features/subscriptions/application/`)

### `application/PlanEntitlement.ts`
```ts
import type { SubscriptionRepository } from '../domain/repositories/SubscriptionRepository';
import { RenewalPolicy } from '../domain/services/RenewalPolicy';

export interface PlanEntitlementCheckInput {
  userId: string;
}

export class PlanEntitlement {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly renewalPolicy: RenewalPolicy = new RenewalPolicy(),
  ) {}

  async canPlay(input: PlanEntitlementCheckInput): Promise<boolean> {
    const subscription = await this.subscriptionRepository.getByUserId(input.userId);
    return this.renewalPolicy.isEntitled(subscription);
  }
}
```[cite: 11]

### `application/hooks/usePlans.ts`
```ts
import { useCallback, useEffect, useState } from 'react';

import type { Plan } from '../../domain/entities/Plan';
import type { PlanRepository } from '../../domain/repositories/PlanRepository';

export function usePlans(planRepository: PlanRepository) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const items = await planRepository.listPlans();
      setPlans(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Planlar yüklənə bilmədi');
    } finally {
      setIsLoading(false);
    }
  }, [planRepository]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  return {
    plans,
    isLoading,
    error,
    refresh: loadPlans,
  };
}
```[cite: 11]

### `application/hooks/useSubscription.ts`
```ts
import { useCallback, useEffect, useState } from 'react';

import type { Subscription } from '../../domain/entities/Subscription';
import type { SubscriptionRepository } from '../../domain/repositories/SubscriptionRepository';
import { RenewalPolicy } from '../../domain/services/RenewalPolicy';
import { Subscribe } from '../../domain/usecases/Subscribe';
import type { PlanRepository } from '../../domain/repositories/PlanRepository';

export interface UseSubscriptionParams {
  userId: string;
  subscriptionRepository: SubscriptionRepository;
  planRepository?: PlanRepository;
}

export function useSubscription({
  userId,
  subscriptionRepository,
  planRepository,
}: UseSubscriptionParams) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubscribing, setIsSubscribing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const renewalPolicy = new RenewalPolicy();

  const refresh = useCallback(async () => {
    if (!userId) {
      setSubscription(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const sub = await subscriptionRepository.getByUserId(userId);
      setSubscription(sub);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Abunəlik məlumatı alınmadı');
    } finally {
      setIsLoading(false);
    }
  }, [userId, subscriptionRepository]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const subscribe = useCallback(
    async (planId: string, autoRenew = true) => {
      if (!planRepository) {
        setError('Plan repository təyin edilməyib');
        return null;
      }

      setIsSubscribing(true);
      setError(null);
      try {
        const useCase = new Subscribe(
          planRepository,
          subscriptionRepository,
          renewalPolicy,
        );
        const created = await useCase.execute({ userId, planId, autoRenew });
        setSubscription(created);
        return created;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Abunəlik aktivləşmədi');
        return null;
      } finally {
        setIsSubscribing(false);
      }
    },
    [userId, planRepository, subscriptionRepository],
  );

  const isEntitled = renewalPolicy.isEntitled(subscription);

  return {
    subscription,
    isEntitled,
    isLoading,
    isSubscribing,
    error,
    refresh,
    subscribe,
  };
}
```[cite: 11]

### `application/hooks/useChangePlan.ts`
```ts
import { useCallback, useState } from 'react';

import type { PlanRepository } from '../../domain/repositories/PlanRepository';
import type { SubscriptionRepository } from '../../domain/repositories/SubscriptionRepository';
import { ChangePlan, type ChangePlanOutput } from '../../domain/usecases/ChangePlan';

export interface UseChangePlanParams {
  userId: string;
  planRepository: PlanRepository;
  subscriptionRepository: SubscriptionRepository;
  onSuccess?: (result: ChangePlanOutput) => void;
}

export function useChangePlan({
  userId,
  planRepository,
  subscriptionRepository,
  onSuccess,
}: UseChangePlanParams) {
  const [isChanging, setIsChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastProration, setLastProration] = useState<ChangePlanOutput['proration'] | null>(
    null,
  );

  const changePlan = useCallback(
    async (newPlanId: string) => {
      setIsChanging(true);
      setError(null);
      try {
        const useCase = new ChangePlan(planRepository, subscriptionRepository);
        const result = await useCase.execute({ userId, newPlanId });
        setLastProration(result.proration);
        onSuccess?.(result);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Plan dəyişdirilə bilmədi');
        return null;
      } finally {
        setIsChanging(false);
      }
    },
    [userId, planRepository, subscriptionRepository, onSuccess],
  );

  return {
    changePlan,
    isChanging,
    error,
    lastProration,
  };
}
```[cite: 11]

### `application/hooks/useCancelSubscription.ts`
```ts
import { useCallback, useState } from 'react';

import type { Subscription } from '../../domain/entities/Subscription';
import type { SubscriptionRepository } from '../../domain/repositories/SubscriptionRepository';
import { CancelSubscription } from '../../domain/usecases/CancelSubscription';
import { ResumeSubscription } from '../../domain/usecases/ResumeSubscription';

export interface UseCancelSubscriptionParams {
  userId: string;
  subscriptionRepository: SubscriptionRepository;
  onUpdated?: (subscription: Subscription) => void;
}

export function useCancelSubscription({
  userId,
  subscriptionRepository,
  onUpdated,
}: UseCancelSubscriptionParams) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const useCase = new CancelSubscription(subscriptionRepository);
      const updated = await useCase.execute({ userId });
      onUpdated?.(updated);
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Abunəlik ləğv edilə bilmədi');
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, [userId, subscriptionRepository, onUpdated]);

  const resume = useCallback(async () => {
    setIsProcessing(true);
    setError(null);
    try {
      const useCase = new ResumeSubscription(subscriptionRepository);
      const updated = await useCase.execute({ userId });
      onUpdated?.(updated);
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Abunəlik bərpa edilə bilmədi');
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, [userId, subscriptionRepository, onUpdated]);

  return {
    cancel,
    resume,
    isProcessing,
    error,
  };
}
```[cite: 11]

---

## 4. Presentation qatı (`src/features/subscriptions/presentation/`)

### `presentation/components/PlanCard.tsx`
```tsx
import { View } from 'react-native';

import { AppText } from '@/shared/ui/AppText';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';

import type { Plan } from '../../domain/entities/Plan';

export interface PlanCardProps {
  plan: Plan;
  isCurrent?: boolean;
  isLoading?: boolean;
  onSelect: (plan: Plan) => void;
}

export function PlanCard({
  plan,
  isCurrent = false,
  isLoading = false,
  onSelect,
}: PlanCardProps) {
  const priceText = `${(plan.priceCents / 100).toFixed(2)} ${plan.currency}`;
  const periodLabel = plan.interval === 'yearly' ? '/ il' : '/ ay';

  return (
    <View
      style={{
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: isCurrent ? '#8B5CF6' : '#2f2f2f',
        gap: 8,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText variant="title3">{plan.name}</AppText>
        <Badge label={plan.maxQuality} />
      </View>

      <AppText variant="title2">
        {priceText} {periodLabel}
      </AppText>

      {plan.description ? (
        <AppText variant="body">{plan.description}</AppText>
      ) : null}

      <AppText variant="caption">
        Ekran sayı: {plan.maxScreens} • Reklam: {plan.hasAds ? 'Var' : 'Yoxdur'}
      </AppText>

      <Button
        label={isCurrent ? 'Aktiv plan' : 'Planı seç'}
        disabled={isCurrent || isLoading}
        loading={isLoading}
        onPress={() => onSelect(plan)}
      />
    </View>
  );
}
```[cite: 11, 12]

### `presentation/components/PlanComparison.tsx`
```tsx
import { View } from 'react-native';

import { AppText } from '@/shared/ui/AppText';

import type { Plan } from '../../domain/entities/Plan';

export interface PlanComparisonProps {
  plans: Plan[];
}

export function PlanComparison({ plans }: PlanComparisonProps) {
  if (plans.length === 0) {
    return null;
  }

  return (
    <View style={{ gap: 10, paddingVertical: 8 }}>
      <AppText variant="subtitle">Plan müqayisəsi</AppText>

      {plans.map((plan) => (
        <View
          key={plan.id}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: '#242424',
          }}
        >
          <AppText variant="bodyStrong">{plan.name}</AppText>
          <AppText variant="caption">
            {plan.maxQuality} • {plan.maxScreens} ekran •{' '}
            {plan.hasAds ? 'Reklamlı' : 'Reklamsız'}
          </AppText>
        </View>
      ))}
    </View>
  );
}
```[cite: 11, 12]

### `presentation/components/CancelFlowSheet.tsx`
```tsx
import { View } from 'react-native';

import { AppText } from '@/shared/ui/AppText';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { Button } from '@/shared/ui/Button';

export interface CancelFlowSheetProps {
  visible: boolean;
  onClose: () => void;
  periodEndDate: string;
  isSubmitting?: boolean;
  onConfirmCancel: () => Promise<void> | void;
}

export function CancelFlowSheet({
  visible,
  onClose,
  periodEndDate,
  isSubmitting = false,
  onConfirmCancel,
}: CancelFlowSheetProps) {
  const formattedEnd = new Date(periodEndDate).toLocaleDateString();

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ padding: 16, gap: 12 }}>
        <AppText variant="title2">Abunəliyi ləğv et?</AppText>
        <AppText variant="body">
          Ləğv etsəniz belə, ödənilmiş müddətin sonuna kimi ({formattedEnd}) izləməyə
          davam edə biləcəksiniz.
        </AppText>

        <Button
          label="Abunəliyi saxla"
          variant="secondary"
          disabled={isSubmitting}
          onPress={onClose}
        />

        <Button
          label="Ləğvi təsdiqlə"
          disabled={isSubmitting}
          loading={isSubmitting}
          onPress={onConfirmCancel}
        />
      </View>
    </BottomSheet>
  );
}
```[cite: 11, 12]

### `presentation/components/PaywallSheet.tsx`
```tsx
import { View } from 'react-native';

import { AppText } from '@/shared/ui/AppText';
import { BottomSheet } from '@/shared/ui/BottomSheet';
import { Button } from '@/shared/ui/Button';

export interface PaywallSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  onViewPlans: () => void;
}

export function PaywallSheet({
  visible,
  onClose,
  title = 'Abunəlik tələb olunur',
  message = 'Bu məzmunu tam izləmək üçün uyğun abunəlik planı seçin.',
  onViewPlans,
}: PaywallSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ padding: 16, gap: 12 }}>
        <AppText variant="title2">{title}</AppText>
        <AppText variant="body">{message}</AppText>

        <Button label="Planlara bax" onPress={onViewPlans} />
        <Button label="Bağla" variant="secondary" onPress={onClose} />
      </View>
    </BottomSheet>
  );
}
```[cite: 11]

### `presentation/screens/PlansScreen.tsx`
```tsx
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Screen } from '@/shared/ui/Screen';
import { AppText } from '@/shared/ui/AppText';
import { EmptyState } from '@/shared/ui/EmptyState';
import { ErrorState } from '@/shared/ui/ErrorState';
import { Skeleton } from '@/shared/ui/Skeleton';

import type { Plan } from '../../domain/entities/Plan';
import type { PlanRepository } from '../../domain/repositories/PlanRepository';
import type { SubscriptionRepository } from '../../domain/repositories/SubscriptionRepository';
import { useChangePlan } from '../../application/hooks/useChangePlan';
import { usePlans } from '../../application/hooks/usePlans';
import { useSubscription } from '../../application/hooks/useSubscription';
import { PlanCard } from '../components/PlanCard';
import { PlanComparison } from '../components/PlanComparison';

export interface PlansScreenProps {
  userId: string;
  planRepository: PlanRepository;
  subscriptionRepository: SubscriptionRepository;
  onSubscribed?: () => void;
}

export function PlansScreen({
  userId,
  planRepository,
  subscriptionRepository,
  onSubscribed,
}: PlansScreenProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const {
    plans,
    isLoading: plansLoading,
    error: plansError,
    refresh: refreshPlans,
  } = usePlans(planRepository);

  const {
    subscription,
    isSubscribing,
    error: subError,
    subscribe,
    refresh: refreshSubscription,
  } = useSubscription({
    userId,
    planRepository,
    subscriptionRepository,
  });

  const {
    changePlan,
    isChanging,
    error: changeError,
  } = useChangePlan({
    userId,
    planRepository,
    subscriptionRepository,
    onSuccess: async () => {
      await refreshSubscription();
      onSubscribed?.();
    },
  });

  const handleSelectPlan = async (plan: Plan) => {
    setSelectedPlanId(plan.id);
    try {
      if (subscription) {
        await changePlan(plan.id);
      } else {
        await subscribe(plan.id, true);
        onSubscribed?.();
      }
    } finally {
      setSelectedPlanId(null);
    }
  };

  const errorMessage = plansError ?? subError ?? changeError;
  const busy = isSubscribing || isChanging;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <AppText variant="title2">Abunəlik planları</AppText>

        {errorMessage ? (
          <ErrorState message={errorMessage} onRetry={refreshPlans} />
        ) : null}

        {plansLoading ? (
          <View style={{ gap: 12 }}>
            <Skeleton height={130} />
            <Skeleton height={130} />
            <Skeleton height={130} />
          </View>
        ) : plans.length === 0 ? (
          <EmptyState
            title="Plan tapılmadı"
            description="Hazırda aktiv abunəlik planı mövcud deyil."
          />
        ) : (
          <>
            <View style={{ gap: 12 }}>
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  isCurrent={subscription?.planId === plan.id}
                  isLoading={busy && selectedPlanId === plan.id}
                  onSelect={handleSelectPlan}
                />
              ))}
            </View>

            <PlanComparison plans={plans} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
```[cite: 11, 12]

### `presentation/screens/SubscriptionScreen.tsx`
```tsx
import { useState } from 'react';
import { View } from 'react-native';

import { Screen } from '@/shared/ui/Screen';
import { AppText } from '@/shared/ui/AppText';
import { Badge } from '@/shared/ui/Badge';
import { Button } from '@/shared/ui/Button';
import { EmptyState } from '@/shared/ui/EmptyState';
import { Skeleton } from '@/shared/ui/Skeleton';

import type { PlanRepository } from '../../domain/repositories/PlanRepository';
import type { SubscriptionRepository } from '../../domain/repositories/SubscriptionRepository';
import { useCancelSubscription } from '../../application/hooks/useCancelSubscription';
import { useSubscription } from '../../application/hooks/useSubscription';
import { CancelFlowSheet } from '../components/CancelFlowSheet';

export interface SubscriptionScreenProps {
  userId: string;
  planRepository: PlanRepository;
  subscriptionRepository: SubscriptionRepository;
  onNavigateToPlans?: () => void;
}

export function SubscriptionScreen({
  userId,
  planRepository,
  subscriptionRepository,
  onNavigateToPlans,
}: SubscriptionScreenProps) {
  const [cancelSheetVisible, setCancelSheetVisible] = useState(false);

  const {
    subscription,
    isEntitled,
    isLoading,
    error,
    refresh,
  } = useSubscription({
    userId,
    planRepository,
    subscriptionRepository,
  });

  const {
    cancel,
    resume,
    isProcessing,
    error: cancelError,
  } = useCancelSubscription({
    userId,
    subscriptionRepository,
    onUpdated: async () => {
      setCancelSheetVisible(false);
      await refresh();
    },
  });

  const displayError = error ?? cancelError;

  return (
    <Screen>
      <View style={{ flex: 1, padding: 16, gap: 16 }}>
        <AppText variant="title2">Abunəliyim</AppText>

        {displayError ? <AppText variant="caption">{displayError}</AppText> : null}

        {isLoading ? (
          <Skeleton height={120} />
        ) : !subscription ? (
          <EmptyState
            title="Aktiv abunəlik yoxdur"
            description="Filmləri və serialları izləmək üçün plan seçin."
          />
        ) : (
          <View style={{ gap: 12 }}>
            <Badge label={subscription.status} />
            <AppText variant="bodyStrong">Plan ID: {subscription.planId}</AppText>
            <AppText variant="body">
              Giriş vəziyyəti: {isEntitled ? 'Aktivdir' : 'Aktiv deyil'}
            </AppText>
            <AppText variant="caption">
              Cari dövrün bitmə tarixi:{' '}
              {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
            </AppText>
            <AppText variant="caption">
              Avtomatik yenilənmə: {subscription.autoRenew ? 'Açıq' : 'Bağlı'}
            </AppText>

            {subscription.status === 'canceled_until_period_end' ? (
              <Button
                label="Abunəliyi bərpa et"
                loading={isProcessing}
                disabled={isProcessing}
                onPress={resume}
              />
            ) : (
              <Button
                label="Abunəliyi ləğv et"
                variant="secondary"
                disabled={isProcessing}
                onPress={() => setCancelSheetVisible(true)}
              />
            )}
          </View>
        )}

        <Button
          label="Planları dəyiş / gör"
          onPress={() => onNavigateToPlans?.()}
        />

        {subscription ? (
          <CancelFlowSheet
            visible={cancelSheetVisible}
            onClose={() => setCancelSheetVisible(false)}
            periodEndDate={subscription.currentPeriodEnd}
            isSubmitting={isProcessing}
            onConfirmCancel={cancel}
          />
        ) : null}
      </View>
    </Screen>
  );
}
```[cite: 11, 12]

---

## 5. Public API (`src/features/subscriptions/index.ts`)

```ts
export type {
  Plan,
  PlanTier,
  BillingInterval,
} from './domain/entities/Plan';
export type {
  Subscription,
  SubscriptionStatus,
} from './domain/entities/Subscription';
export type { PlanRepository } from './domain/repositories/PlanRepository';
export type {
  SubscriptionRepository,
  CreateSubscriptionInput,
  UpdateSubscriptionInput,
} from './domain/repositories/SubscriptionRepository';

export {
  CancelPolicy,
  type CancellationDecision,
} from './domain/services/CancelPolicy';
export {
  ProrationCalculator,
  type ProrationResult,
} from './domain/services/ProrationCalculator';
export { RenewalPolicy } from './domain/services/RenewalPolicy';

export { Subscribe, type SubscribeInput } from './domain/usecases/Subscribe';
export {
  ChangePlan,
  type ChangePlanInput,
  type ChangePlanOutput,
} from './domain/usecases/ChangePlan';
export {
  CancelSubscription,
  type CancelSubscriptionInput,
} from './domain/usecases/CancelSubscription';
export {
  ResumeSubscription,
  type ResumeSubscriptionInput,
} from './domain/usecases/ResumeSubscription';

export { SupabasePlanRepository } from './data/SupabasePlanRepository';
export { SupabaseSubscriptionRepository } from './data/SupabaseSubscriptionRepository';

export {
  PlanEntitlement,
  type PlanEntitlementCheckInput,
} from './application/PlanEntitlement';
export { usePlans } from './application/hooks/usePlans';
export {
  useSubscription,
  type UseSubscriptionParams,
} from './application/hooks/useSubscription';
export {
  useChangePlan,
  type UseChangePlanParams,
} from './application/hooks/useChangePlan';
export {
  useCancelSubscription,
  type UseCancelSubscriptionParams,
} from './application/hooks/useCancelSubscription';

export { PlanCard, type PlanCardProps } from './presentation/components/PlanCard';
export {
  PlanComparison,
  type PlanComparisonProps,
} from './presentation/components/PlanComparison';
export {
  CancelFlowSheet,
  type CancelFlowSheetProps,
} from './presentation/components/CancelFlowSheet';
export {
  PaywallSheet,
  type PaywallSheetProps,
} from './presentation/components/PaywallSheet';
export {
  PlansScreen,
  type PlansScreenProps,
} from './presentation/screens/PlansScreen';
export {
  SubscriptionScreen,
  type SubscriptionScreenProps,
} from './presentation/screens/SubscriptionScreen';
```[cite: 11]

Qalan 3-cü boş modulun da qovluq/fayl strukturunu göndərsən, eyni şəkildə yazıb verim[cite: 9, 10, 11].