import { createHmac } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const WEBHOOK_TIMEOUT_MS = 5000;

export interface WebhookPayload {
  payment_id: string;
  status: string;
  amount_cents: number;
  currency: string;
  metadata: unknown;
  occurred_at: string;
}

export interface WebhookResult {
  delivered: boolean;
  statusCode?: number;
  error?: string;
}

@Injectable()
export class WebhookNotifier {
  private readonly logger = new Logger(WebhookNotifier.name);

  constructor(private readonly config: ConfigService) {}

  async notify(payload: WebhookPayload): Promise<WebhookResult> {
    const url = this.config.get<string>('PAYMENT_WEBHOOK_URL')?.trim();
    const secret = this.config.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (!url || !secret) {
      return this.fail(payload, 'webhook_not_configured');
    }

    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature': signature,
          'x-signature-timestamp': timestamp,
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        return this.fail(payload, `status_${res.status}`, res.status);
      }
      return { delivered: true, statusCode: res.status };
    } catch (err) {
      return this.fail(payload, err instanceof Error ? err.message : 'error');
    } finally {
      clearTimeout(timer);
    }
  }

  private fail(
    payload: WebhookPayload,
    error: string,
    statusCode?: number,
  ): WebhookResult {
    this.logger.warn(
      `Webhook delivery failed for payment ${payload.payment_id}: ${error}`,
    );
    return statusCode === undefined
      ? { delivered: false, error }
      : { delivered: false, statusCode, error };
  }
}
