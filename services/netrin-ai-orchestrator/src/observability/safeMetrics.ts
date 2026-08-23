export type SafeMetric = {
  requestId: string
  anonymousUserId?: string
  route: 'analyze' | 'plan' | 'providers' | 'model-catalog' | 'provider-probe' | 'health'
  outcome: 'success' | 'failure'
  durationMs: number
  errorCode?: string
  providerStatus?: number
  providerFailureKind?: string
  providerId?: string
  modelId?: string
  modelTurns?: number
  toolCalls?: number
  candidateCount?: number
  ambiguityCount?: number
  budgetExhausted?: boolean
}

export interface SafeMetricSink {
  record(metric: SafeMetric): void
}

export class JsonSafeMetricSink implements SafeMetricSink {
  record(metric: SafeMetric): void {
    process.stdout.write(`${JSON.stringify(metric)}\n`)
  }
}

export class MemoryMetricSink implements SafeMetricSink {
  readonly records: SafeMetric[] = []
  record(metric: SafeMetric): void {
    this.records.push(structuredClone(metric))
  }
}
