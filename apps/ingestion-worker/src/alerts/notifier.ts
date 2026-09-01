import { log, logError } from '../logger';

type AlertSeverity = 'warning' | 'critical';

export class AlertNotifier {
  private readonly webhookUrl = process.env.INGESTION_ALERT_WEBHOOK_URL?.trim();
  private readonly cooldownMs = Number.parseInt(
    process.env.INGESTION_ALERT_COOLDOWN_MS ?? '300000',
    10,
  );
  private readonly webhookTimeoutMs = Number.parseInt(
    process.env.INGESTION_ALERT_WEBHOOK_TIMEOUT_MS ?? '5000',
    10,
  );
  private readonly lastSentAt = new Map<string, number>();

  async send(
    event: string,
    severity: AlertSeverity,
    message: string,
    fields: Record<string, unknown> = {},
  ): Promise<void> {
    const now = Date.now();
    const lastSentAt = this.lastSentAt.get(event) ?? 0;
    if (now - lastSentAt < this.cooldownMs) return;
    this.lastSentAt.set(event, now);

    log(severity === 'critical' ? 'error' : 'warn', event, {
      alert: true,
      severity,
      message,
      ...fields,
    });

    if (!this.webhookUrl) return;

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ts: new Date().toISOString(),
          service: 'ingestion-worker',
          event,
          severity,
          message,
          ...fields,
        }),
        signal: AbortSignal.timeout(this.webhookTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Alert webhook returned HTTP ${response.status}`);
      }
    } catch (err) {
      logError('ingestion_alert_delivery_failed', err, { alertEvent: event });
    }
  }
}
