type TextFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  multiline?: boolean
  rows?: number
  type?: 'text' | 'email' | 'password' | 'number' | 'url'
  autoComplete?: string
  required?: boolean
  minLength?: number
  maxLength?: number
  inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search'
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  spellCheck?: boolean
  disabled?: boolean
  className?: string
}

/** Labelled text input / textarea. */
export function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 3,
  type = 'text',
  autoComplete,
  required = false,
  minLength,
  maxLength,
  inputMode,
  autoCapitalize,
  spellCheck,
  disabled = false,
  className = ''
}: TextFieldProps) {
  return (
    <label
      className={['nfield', className].filter(Boolean).join(' ')}
      data-appearance-hook="text-field"
      data-appearance-variant={multiline ? 'multiline' : type ?? 'text'}
    >
      <span className="nfield__label">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          rows={rows}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          inputMode={inputMode}
          autoCapitalize={autoCapitalize}
          spellCheck={spellCheck}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          maxLength={maxLength}
          inputMode={inputMode}
          autoCapitalize={autoCapitalize}
          spellCheck={spellCheck}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  )
}

export default TextField
