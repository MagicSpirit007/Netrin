import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { searchAmapCities, type AmapSearchResult } from '../../lib/amap/search'
import type { CityFilterValue } from '../../screens/routeCatalogParams'
import { Button } from '../core/Button'
import { PixelIcon } from '../icons/PixelIcon'

type CitySearchFilterProps = {
  value?: CityFilterValue
  label: string
  placeholder: string
  loadingLabel: string
  emptyLabel: string
  errorLabel: string
  selectedFallback: string
  clearLabel: string
  onChange: (value: CityFilterValue | undefined) => void
}

type SearchPhase = 'idle' | 'loading' | 'ready' | 'error'

export function CitySearchFilter({
  value,
  label,
  placeholder,
  loadingLabel,
  emptyLabel,
  errorLabel,
  selectedFallback,
  clearLabel,
  onChange
}: CitySearchFilterProps) {
  const id = useId().replace(/:/g, '')
  const inputId = `${id}-input`
  const listId = `${id}-list`
  const requestId = useRef(0)
  const [query, setQuery] = useState(value?.name ?? '')
  const [phase, setPhase] = useState<SearchPhase>('idle')
  const [results, setResults] = useState<AmapSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  useEffect(() => {
    setQuery(value?.name ?? '')
    setOpen(false)
    setResults([])
    setPhase('idle')
    setActiveIndex(-1)
  }, [value?.adcode, value?.name])

  useEffect(() => {
    const needle = query.trim()
    if (!needle || needle === value?.name) {
      setOpen(false)
      setResults([])
      setPhase('idle')
      setActiveIndex(-1)
      return
    }

    const currentRequest = ++requestId.current
    setPhase('loading')
    setOpen(true)
    const timer = window.setTimeout(() => {
      void searchAmapCities(needle).then((matches) => {
        if (requestId.current !== currentRequest) return
        setResults(matches.filter((item) => item.cityAdcode && item.cityName).slice(0, 10))
        setPhase('ready')
        setActiveIndex(-1)
      }).catch(() => {
        if (requestId.current !== currentRequest) return
        setResults([])
        setPhase('error')
        setActiveIndex(-1)
      })
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [query, value?.name])

  const selectResult = (result: AmapSearchResult) => {
    if (!result.cityAdcode || !result.cityName) return
    onChange({ adcode: result.cityAdcode, name: result.cityName })
    setQuery(result.cityName)
    setOpen(false)
    setResults([])
    setPhase('idle')
    setActiveIndex(-1)
  }

  const clear = () => {
    requestId.current += 1
    setQuery('')
    setOpen(false)
    setResults([])
    setPhase('idle')
    setActiveIndex(-1)
    onChange(undefined)
  }

  const handleQueryChange = (next: string) => {
    setQuery(next)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      if (event.key === 'Escape') setOpen(false)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current <= 0 ? results.length - 1 : current - 1))
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault()
      selectResult(results[activeIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="city-search-filter" data-appearance-hook="text-field">
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
          value={query}
          placeholder={placeholder}
          onChange={(event) => handleQueryChange(event.target.value)}
          onFocus={() => {
            if (phase !== 'idle') setOpen(true)
          }}
          onKeyDown={handleKeyDown}
        />
        {query || value ? (
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

      {value ? (
        <div className="city-search-filter__selected">
          <span><PixelIcon name="globe" size={16} />{value.name || selectedFallback}</span>
          <Button size="sm" variant="ghost" icon="close" onClick={clear}>{clearLabel}</Button>
        </div>
      ) : null}

      {open ? (
        <div className="city-search-filter__popover" id={listId} role="listbox">
          {phase === 'loading' ? <p className="quiet" role="status">{loadingLabel}</p> : null}
          {phase === 'error' ? <p className="form-error" role="status">{errorLabel}</p> : null}
          {phase === 'ready' && results.length === 0 ? <p className="quiet" role="status">{emptyLabel}</p> : null}
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
              <PixelIcon name="globe" size={18} />
              <span><b>{result.cityName}</b></span>
            </button>
          )) : null}
        </div>
      ) : null}
    </div>
  )
}

export default CitySearchFilter
