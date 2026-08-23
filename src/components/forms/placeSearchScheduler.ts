export const PLACE_SEARCH_DEBOUNCE_MS = 300

type TimerHandle = ReturnType<typeof setTimeout>
type ScheduleTimer = (callback: () => void, delayMs: number) => TimerHandle
type CancelTimer = (handle: TimerHandle) => void

export type DebouncedLatestTaskScheduler<T> = {
  schedule: (
    task: () => Promise<T>,
    onFulfilled: (value: T) => void,
    onRejected: () => void
  ) => void
  cancel: () => void
}

export function createDebouncedLatestTaskScheduler<T>(
  delayMs = PLACE_SEARCH_DEBOUNCE_MS,
  scheduleTimer: ScheduleTimer = (callback, delay) => setTimeout(callback, delay),
  cancelTimer: CancelTimer = (handle) => clearTimeout(handle)
): DebouncedLatestTaskScheduler<T> {
  let revision = 0
  let timer: TimerHandle | undefined

  const cancel = () => {
    revision += 1
    if (timer !== undefined) {
      cancelTimer(timer)
      timer = undefined
    }
  }

  return {
    schedule(task, onFulfilled, onRejected) {
      cancel()
      const requestRevision = revision
      timer = scheduleTimer(() => {
        timer = undefined
        void task().then(
          (value) => {
            if (requestRevision === revision) onFulfilled(value)
          },
          () => {
            if (requestRevision === revision) onRejected()
          }
        )
      }, delayMs)
    },
    cancel
  }
}
