/**
 * AeroCap React Component Template
 * Copy for new feature components. Replace: Feature, feature, Entity, entity.
 *
 * Checklist before shipping:
 *   [ ] All 4 states: loading, error, empty, data
 *   [ ] Props interface exported and named {Component}Props
 *   [ ] No hardcoded strings — all via useTranslations()
 *   [ ] No raw fetch — typed API client used
 *   [ ] tenantId from session only (useTenant hook)
 *   [ ] Co-located .test.tsx file created
 *   [ ] Mobile responsive (check 375px, 768px, 1280px)
 */

'use client';

import { useTranslations } from 'next-intl';
import { SkeletonCard } from '@/components/shared/SkeletonCard';
import { ErrorState } from '@/components/shared/ErrorState';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils/cn';
// import { useFeatureData } from '@/lib/hooks/useFeatureData';
// import type { Entity } from '@/types/api';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FeatureComponentProps {
  entityId: string;
  className?: string;
  onAction?: (id: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function FeatureComponent({ entityId, className, onAction }: FeatureComponentProps) {
  const t = useTranslations('feature.component');

  // Replace with your actual hook:
  // const { data, isLoading, isError, error, refetch } = useFeatureData(entityId);
  const isLoading = false;
  const isError = false;
  const data = null as null; // replace with real type

  // ── 1. Loading ─────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)} aria-busy="true" aria-label={t('loading')}>
        <SkeletonCard className="h-24 w-full" />
        <SkeletonCard className="h-24 w-full" />
        <SkeletonCard className="h-24 w-full" />
      </div>
    );
  }

  // ── 2. Error ───────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <ErrorState
        title={t('errorTitle')}
        // message={error.message}
        // onRetry={refetch}
        className={className}
      />
    );
  }

  // ── 3. Empty ───────────────────────────────────────────────────────────────
  if (!data) {
    return (
      <EmptyState
        icon="inbox"
        title={t('emptyTitle')}
        description={t('emptyDescription')}
        className={className}
      />
    );
  }

  // ── 4. Data ────────────────────────────────────────────────────────────────
  return (
    <div className={cn('space-y-4', className)}>
      {/* Your data rendering here */}
    </div>
  );
}

// ─── Sub-component example ───────────────────────────────────────────────────

interface EntityCardProps {
  // entity: Entity;
  onClick?: () => void;
}

function EntityCard({ onClick }: EntityCardProps) {
  const t = useTranslations('feature.entityCard');

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      className={cn(
        'rounded-lg border bg-card p-4 transition-colors',
        onClick && 'cursor-pointer hover:border-primary hover:bg-accent',
      )}
      aria-label={onClick ? t('clickToOpen') : undefined}
    >
      {/* entity fields here */}
    </div>
  );
}
