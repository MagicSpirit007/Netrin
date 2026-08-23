type SwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}

/** Mechanical pixel toggle — stepped knob motion, not springy. */
export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`nswitch ${checked ? 'nswitch--on' : ''}`.trim()}
      data-appearance-hook="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="nswitch__knob" />
    </button>
  )
}

export default Switch
