import type { DistributionProfile } from '../shared/runtime';

export function getDistributionProfile(
  value = process.env.DESKY_DISTRIBUTION,
): DistributionProfile {
  return value === 'store' ? 'store' : 'direct';
}
