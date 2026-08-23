import { describe, expect, it, vi } from 'vitest'
import {
  createDebouncedLatestTaskScheduler,
  PLACE_SEARCH_DEBOUNCE_MS
} from './placeSearchScheduler'

describe('place search scheduler', () => {
  it('waits 300 ms before starting a search', async () => {
    let scheduled: (() => void) | undefined
    const task = vi.fn(async () => ['result'])
    const onFulfilled = vi.fn()
    const scheduler = createDebouncedLatestTaskScheduler<string[]>(
      PLACE_SEARCH_DEBOUNCE_MS,
      (callback, delay) => {
        expect(delay).toBe(300)
        scheduled = callback
        return 1 as ReturnType<typeof setTimeout>
      },
      vi.fn()
    )

    scheduler.schedule(task, onFulfilled, vi.fn())

    expect(task).not.toHaveBeenCalled()
    scheduled?.()
    await Promise.resolve()
    expect(task).toHaveBeenCalledOnce()
    expect(onFulfilled).toHaveBeenCalledWith(['result'])
  })

  it('ignores an older response after a newer request starts', async () => {
    const timers: Array<() => void> = []
    let resolveFirst: ((value: string) => void) | undefined
    let resolveSecond: ((value: string) => void) | undefined
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<string>((resolve) => {
      resolveSecond = resolve
    })
    const onFulfilled = vi.fn()
    const scheduler = createDebouncedLatestTaskScheduler<string>(
      300,
      (callback) => {
        timers.push(callback)
        return timers.length as ReturnType<typeof setTimeout>
      },
      vi.fn()
    )

    scheduler.schedule(() => first, onFulfilled, vi.fn())
    timers[0]()
    scheduler.schedule(() => second, onFulfilled, vi.fn())
    timers[1]()
    resolveSecond?.('new')
    await Promise.resolve()
    resolveFirst?.('old')
    await Promise.resolve()

    expect(onFulfilled).toHaveBeenCalledTimes(1)
    expect(onFulfilled).toHaveBeenCalledWith('new')
  })
})
