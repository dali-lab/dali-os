import { resetCycleStatus } from './helpers';

/**
 * Ensure the Fall 2026 cycle is in Open state before any tests run.
 * This cleans up stale state from previous test runs that may have
 * advanced the cycle to UnderReview and failed before reverting.
 */
export default async function globalSetup() {
  await resetCycleStatus('cycle-fall-2026');
}
