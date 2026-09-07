/**
 * Handling for GBP API calls made via `googleapis` (gaxios under the hood).
 *
 * A GCP project that has the GBP APIs enabled but hasn't been allowlisted for
 * access gets `quota_limit_value: "0"`. Google returns that as HTTP 429 /
 * RESOURCE_EXHAUSTED, which gaxios's default retry treats as a transient rate
 * limit: 3 retries with exponential backoff, ~9s wasted, and it can never
 * succeed because the quota is permanently zero until access is granted
 * (see https://googleapis.dev/nodejs/googleapis/latest/Mybusinessaccountmanagement.html
 * and https://developers.google.com/my-business/content/limits, which
 * documents a 300 QPM default — so 0 is unambiguously the pre-approval state).
 */

import { logger } from './logger.js';

function getErrorInfoDetail(err: any): { metadata?: Record<string, string> } | undefined {
    const details = err?.response?.data?.error?.details;
    if (!Array.isArray(details)) return undefined;
    return details.find((d: any) => d?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo');
}

/** True when a 429 is a permanent zero-quota denial rather than a transient rate limit. */
export function isZeroQuotaDenial(err: any): boolean {
    if (err?.response?.status !== 429) return false;
    return getErrorInfoDetail(err)?.metadata?.quota_limit_value === '0';
}

/**
 * Reimplementation of gaxios's default retry predicate (gaxios/src/retry.js
 * `shouldRetryRequest`), which isn't exported. Supplying a custom
 * `shouldRetry` fully replaces the built-in one rather than composing with
 * it, so genuine rate-limit / transient-error retries need this to keep
 * working unchanged.
 */
function defaultGaxiosShouldRetry(err: any): boolean {
    const config = err?.config?.retryConfig;
    if (err?.name === 'AbortError' || err?.error?.name === 'AbortError') return false;
    if (!config || config.retry === 0) return false;
    if (!err.response && (config.currentRetryAttempt || 0) >= config.noResponseRetries) return false;
    if (!err.config?.method || !config.httpMethodsToRetry?.includes(err.config.method.toUpperCase())) {
        return false;
    }
    if (err.response?.status) {
        const inRange = (config.statusCodesToRetry || []).some(
            ([min, max]: [number, number]) => err.response.status >= min && err.response.status <= max
        );
        if (!inRange) return false;
    }
    if ((config.currentRetryAttempt || 0) >= config.retry) return false;
    return true;
}

/**
 * Spread into `google.<api>({ version, auth, ... })` constructor options to
 * short-circuit zero-quota 429s while preserving default retry behavior
 * (including real rate-limit 429s) for everything else.
 */
export const QUOTA_AWARE_RETRY_CONFIG = {
    retryConfig: {
        shouldRetry: async (err: any) => {
            if (isZeroQuotaDenial(err)) return false;
            return defaultGaxiosShouldRetry(err);
        }
    }
};

/**
 * Maps a zero-quota denial to an actionable error naming the consumer
 * project, or returns null if `err` isn't one. Logs the raw gaxios error at
 * debug so the actionable message — not a multi-KB object dump — is what an
 * operator sees at the default `info` log level.
 */
export function describeZeroQuotaDenial(err: any): Error | null {
    if (!isZeroQuotaDenial(err)) return null;

    logger.debug('Zero-quota API denial (raw gaxios error)', { error: err });

    const metadata = getErrorInfoDetail(err)?.metadata || {};
    const consumer = (metadata.consumer || '').replace(/^projects\//, '') || 'this GCP project';
    const service = metadata.service || 'the Business Profile API';

    return new Error(
        `GBP API access not provisioned for project ${consumer}. Quota for ${service} is 0, ` +
        `meaning the Business Profile API access request has not been approved for this ` +
        `project yet. Request access via the GBP API contact form ` +
        `(https://support.google.com/business/contact/api_default), then retry.`
    );
}
