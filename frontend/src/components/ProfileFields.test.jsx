import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { EmergencyContactsEditor, SkillsPicker, VehicleToggle } from './ProfileFields'

function ContactsHarness() {
  const [contacts, setContacts] = useState([{ name: 'Buddy', phone: '', email: '' }])
  return <EmergencyContactsEditor value={contacts} onChange={setContacts} />
}

describe('profile form controls', () => {
  it('announces selected skills and toggles the actual selection', () => {
    const onChange = vi.fn()
    render(<SkillsPicker value={['cpr']} onChange={onChange} />)

    expect(screen.getByRole('button', { name: 'CPR trained' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Medical background' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'CPR trained' }))
    expect(onChange).toHaveBeenLastCalledWith([])
    fireEvent.click(screen.getByRole('button', { name: 'Medical background' }))
    expect(onChange).toHaveBeenLastCalledWith(['cpr', 'medical'])
  })

  it('keeps the vehicle checkbox named and controllable', () => {
    const onChange = vi.fn()
    render(<VehicleToggle value={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have a vehicle I can use' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('keeps visible contact labels associated while editing', () => {
    render(<ContactsHarness />)
    const name = screen.getByLabelText('Name')
    const phone = screen.getByLabelText('Phone (optional)')
    const email = screen.getByLabelText('Email (optional)')
    fireEvent.change(name, { target: { value: 'Neighbour' } })
    fireEvent.change(phone, { target: { value: '1234567890' } })
    fireEvent.change(email, { target: { value: 'buddy@example.com' } })

    expect(name).toHaveValue('Neighbour')
    expect(phone).toHaveValue('1234567890')
    expect(email).toHaveValue('buddy@example.com')
  })

  it('names removal actions by contact and handles add/remove without submitting', () => {
    render(<ContactsHarness />)
    fireEvent.click(screen.getByRole('button', { name: '+ Add contact' }))
    expect(screen.getAllByLabelText('Name')).toHaveLength(2)
    const remove = screen.getByRole('button', { name: 'Remove contact 2' })
    expect(remove).toHaveAttribute('type', 'button')
    fireEvent.click(remove)
    expect(screen.getAllByLabelText('Name')).toHaveLength(1)
  })

  it('does not offer another contact once the configured maximum is reached', () => {
    render(<EmergencyContactsEditor value={[{ name: 'Buddy' }]} max={1} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '+ Add contact' })).not.toBeInTheDocument()
  })

  it('has no contact label or ARIA accessibility violations', async () => {
    const { container } = render(<ContactsHarness />)
    const result = await axe(container, {
      runOnly: ['label', 'label-title-only', 'form-field-multiple-labels', 'aria-valid-attr-value'],
    })
    expect(result.violations).toEqual([])
  })
})
