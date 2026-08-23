import { PixelIcon } from '../icons/PixelIcon'

type SearchFieldProps = {
  value: string
  onChange: (value: string) => void
  onClear?: () => void
  placeholder?: string
  clearLabel?: string
}

/** Search input with leading glyph and an optional clear control. */
export function SearchField({ value, onChange, onClear, placeholder, clearLabel = 'Clear' }: SearchFieldProps) {
  return (
    <label className="nsearch" data-appearance-hook="text-field" data-appearance-slot="search-field">
      <PixelIcon name="search" size={20} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {value && onClear ? (
        <button type="button" className="nsearch__clear" aria-label={clearLabel} data-appearance-hook="icon-button" onClick={onClear}>
          <PixelIcon name="close" size={16} />
        </button>
      ) : null}
    </label>
  )
}

export default SearchField
