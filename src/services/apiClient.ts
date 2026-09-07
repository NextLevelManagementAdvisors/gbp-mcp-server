/**
 * Google My Business API Client
 * Handles low-level HTTP communication with Google My Business API
 */

import { GoogleAuthService } from './googleAuth.js';
import { logger } from '../utils/logger.js';
import { GOOGLE_API, ERROR_CODES } from '../utils/constants.js';
import { buildApiUrl } from '../utils/pathHelpers.js';
import { QUOTA_AWARE_RETRY_CONFIG, describeZeroQuotaDenial } from '../utils/googleApiRetry.js';

export class GoogleMyBusinessApiClient {
    constructor(private authService: GoogleAuthService) {}
    
    private async accessToken(): Promise<string> {
        await this.authService.refreshTokenIfNeeded();
        const auth = this.authService.getAuthenticatedClient();
        return (await auth.getAccessToken()).token!;
    }

    /**
     * Makes an authenticated GET request to the API. Pass `baseUrl` to hit a
     * non-default host (e.g. GOOGLE_API.HOSTS.PERFORMANCE for daily metrics).
     */
    async get<T = any>(path: string, params?: Record<string, any>, baseUrl?: string): Promise<T> {
        const token = await this.accessToken();
        const url = buildApiUrl(baseUrl ?? GOOGLE_API.BASE_URL, path, params);
        logger.debug(`API GET Request`, { url });
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        return this.handleResponse<T>(response);
    }

    async put<T = any>(path: string, body: any, baseUrl?: string): Promise<T> {
        const token = await this.accessToken();
        const url = `${baseUrl ?? GOOGLE_API.BASE_URL}/${path}`;
        logger.debug(`API PUT Request`, { url, body });
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return this.handleResponse<T>(response);
    }

    async post<T = any>(path: string, body: any, baseUrl?: string): Promise<T> {
        const token = await this.accessToken();
        const url = `${baseUrl ?? GOOGLE_API.BASE_URL}/${path}`;
        logger.debug(`API POST Request`, { url, body });
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return this.handleResponse<T>(response);
    }

    async patch<T = any>(path: string, body: any, params?: Record<string, any>, baseUrl?: string): Promise<T> {
        const token = await this.accessToken();
        const url = buildApiUrl(baseUrl ?? GOOGLE_API.BASE_URL, path, params);
        logger.debug(`API PATCH Request`, { url, body });
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return this.handleResponse<T>(response);
    }

    async delete<T = any>(path: string, baseUrl?: string): Promise<T> {
        const token = await this.accessToken();
        const url = `${baseUrl ?? GOOGLE_API.BASE_URL}/${path}`;
        logger.debug(`API DELETE Request`, { url });
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        // DELETE often returns empty body; tolerate that
        if (response.status === 204) return {} as T;
        return this.handleResponse<T>(response);
    }
    
    /**
     * Handles API response and error processing
     */
    private async handleResponse<T>(response: any): Promise<T> {
        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`API request failed: ${response.status}`, { errorText });

            throw new Error(`API request failed: ${response.status} - ${this.describeErrorBody(response, errorText)}`);
        }

        const data = await response.json();
        logger.debug(`API Response received`, { status: response.status });

        return data as T;
    }

    /**
     * Google's frontend returns an HTML error page (not JSON) for requests to a host/API
     * that isn't enabled, rather than the JSON error body the rest of the client expects.
     * Surface a readable message instead of dumping the raw markup into an Error.
     */
    private describeErrorBody(response: any, body: string): string {
        const contentType = String(response.headers?.get?.('content-type') ?? '');
        const trimmed = body.trim();
        const looksLikeHtml = contentType.includes('text/html') || /^<(!doctype|html)/i.test(trimmed);
        if (!looksLikeHtml) return body;
        return `non-JSON (HTML) error response, ${body.length} bytes, content-type: ${contentType || 'unknown'}. ` +
            'This usually means the API for this host is not enabled on the Google Cloud project ' +
            '(each GBP API must be enabled separately) or the request hit an unexpected host. ' +
            'Enable the API in Cloud Console and retry; see LOG_LEVEL=debug for the raw body.';
    }

    /**
     * Gets the first account from the authenticated user
     */
    async getFirstAccount(): Promise<any> {
        const auth = this.authService.getAuthenticatedClient();
        const { google } = await import('googleapis');
        const mybusinessaccountmanagement = google.mybusinessaccountmanagement({
            version: 'v1',
            auth,
            ...QUOTA_AWARE_RETRY_CONFIG
        });

        let response;
        try {
            response = await mybusinessaccountmanagement.accounts.list({
                pageSize: 1
            });
        } catch (error: any) {
            const quotaError = describeZeroQuotaDenial(error);
            if (quotaError) throw quotaError;
            throw error;
        }

        const accounts = response.data.accounts || [];

        if (accounts.length === 0) {
            throw new Error('No business accounts found');
        }

        return accounts[0];
    }
}
