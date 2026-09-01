export const INGESTION_QUEUE_NAME = 'ingestion-queue';

export interface IngestionJobData {
  topic: string;
  payloadBase64: string;
  receivedAt: string;
  mqttQos: number;
}
