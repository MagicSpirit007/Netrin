import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import {
  searchAmap,
  type AmapSearchResult
} from '../../lib/amap/search'
import type { RouteBounds } from '../../data/types'
import { Button } from '../core/Button'
import { PixelIcon } from '../icons/PixelIcon'
import {
  createDebouncedLatestTaskScheduler
} from './placeSearchScheduler'
import '../../screens/createMapPlanning.css'

export type PlaceSearchPhase = 'idle' | 'loading' | 'ready' | 'error'

type PlaceSearchPickerProps = {
  value: string
  city?: string
  bounds?: RouteBounds
  label: string
  placeholder: string
  loadingLabel: string
  emptyLabel: string
  errorLabel: string
  retryLabel: string
  clearLabel: string
  cityResultLabel: string
  onChange: (value: string) => void
  onSelect: (result: AmapSearchResult) => void
  onPhaseChange?: (phase: PlaceSearchPhase) => void
}

const PLACE_SEARCH_RESULT_LIMIT = 8

export function PlaceSearchPicker({
  value,
  city,
  bounds,
  label,
  placeholder,
  loadingLabel,
  emptyLabel,
  errorLabel,
  retryLabel,
  clearLabel,
  cityResultLabel,
  onChange,
  onSelect,
  onPhaseChange
}: PlaceSearchPickerProps) {
  const id = useId().replace(/:/g, '')
  const inputId = `${id}-input`
  const listId = `${id}-list`
  const searchScheduler = useRef(
    createDebouncedLatestTaskScheduler<AmapSearchResult[]>()
  )
  const [phase, setPhase] = useState<PlaceSearchPhase>('idle')
  const [results, setResults] = useState<AmapSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [retryToken, setRetryToken] = useState(0)

  const commitPhase = (next: PlaceSearchPhase) => {
    setPhase(next)
    onPhaseChange?.(next)
  }

  useEffect(() => {
    const query = value.trim()
    if (!query) {
      searchScheduler.current.cancel()
      setResults([])
      setOpen(false)
      setActiveIndex(-1)
      commitPhase('idle')
      return
    }

    setOpen(true)
    setResults([])
    setActiveIndex(-1)
    commitPhase('loading')
    searchScheduler.current.schedule(
      () => searchAmap(query, { city, bounds }),
      (matches) => {
        setResults(
          matches
            .filter((item) => (
              item.kind === 'city'
                ? Boolean(item.coordinate || item.bounds)
                : Boolean(item.coordinate)
            ))
            .slice(0, PLACE_SEARCH_RESULT_LIMIT)
        )
        setActiveIndex(-1)
        commitPhase('ready')
      },
      () => {
        setResults([])
        setActiveIndex(-1)
        commitPhase('error')
      }
    )

    return () => {
      searchScheduler.current.cancel()
    }
    // onPhaseChange is intentionally treated as an event callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bounds?.maxLat,
    bounds?.maxLng,
    bounds?.minLat,
    bounds?.minLng,
    city,
    retryToken,
    value
  ])

  const selectResult = (result: AmapSearchResult) => {
    setOpen(false)
    setActiveIndex(-1)
    onSelect(result)
  }

  const clear = () => {
    searchScheduler.current.cancel()
    setResults([])
    setOpen(false)
    setActiveIndex(-1)
    commitPhase('idle')
    onChange('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setActiveIndex(-1)
      return
    }
    if (!open || results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1))
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      selectResult(results[activeIndex])
    }
  }

  return (
    <div className="place-search-picker" data-appearance-hook="text-field">
      <label className="nfield__label" htmlFor={inputId}>{label}</label>
      <div className="nsearch">
        <PixelIcon name="search" size={20} />
        <input
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => {
            if (phase !== 'idle') setOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />
        {value ? (
          <button
            type="button"
            className="nsearch__clear"
            aria-label={clearLabel}
            data-appearance-hook="icon-button"
            onClick={clear}
          >
            <PixelIcon name="close" size={16} />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="place-search-picker__popover" id={listId} role="listbox">
          {phase === 'loading' ? (
            <p className="quiet" role="status">{loadingLabel}</p>
          ) : null}
          {phase === 'error' ? (
            <div className="place-search-picker__error" role="alert">
              <p>{errorLabel}</p>
              <Button
                size="sm"
                variant="dark"
                icon="reload"
                onClick={() => setRetryToken((current) => current + 1)}
              >
                {retryLabel}
              </Button>
            </div>
          ) : null}
          {phase === 'ready' && results.length === 0 ? (
            <p className="quiet" role="status">{emptyLabel}</p>
          ) : null}
          {phase === 'ready' ? results.map((result, index) => (
            <button
              id={`${id}-option-${index}`}
              key={result.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : ''}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectResult(result)}
            >
              <PixelIcon name={result.kind === 'city' ? 'compass' : 'search'} size={18} />
              <span>
                <b>{result.label}</b>
                <small>
                  {[
                    result.kind === 'city' ? cityResultLabel : undefined,
                    result.address,
                    result.kind === 'place' ? result.cityName : undefined
                  ].filter(Boolean).join(' · ')}
                </small>
              </span>
            </button>
          )) : null}
        </div>
      ) : null}
    </div>
  )
}

export default PlaceSearchPicker
