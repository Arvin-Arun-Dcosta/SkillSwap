import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Avatar,
  ChoiceChips,
  ConfirmDialog,
  Dialog,
  Input,
  Pagination,
  Rating,
  Tabs,
  tabPanelProps,
} from '.';

describe('Input', () => {
  it('links the label, hint and error to the control', () => {
    const { rerender } = render(<Input label="Email" hint="We never share it." />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAccessibleDescription('We never share it.');
    expect(input).not.toHaveAttribute('aria-invalid');

    rerender(<Input label="Email" hint="We never share it." error="Enter a valid email address" />);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid email address');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address');
  });

  it('marks optional fields in the label', () => {
    render(<Input label="Location" optional />);
    expect(screen.getByLabelText(/Location/)).toBeInTheDocument();
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('is labelled by its title and closes from the close button', async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Schedule a session" description="Pick a time.">
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Schedule a session' });
    expect(dialog).toHaveAccessibleDescription('Pick a time.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders nothing while closed', () => {
    render(<Dialog open={false} onClose={() => undefined} title="Hidden" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('gives focus back to the control that opened it (regression: focus was lost on close)', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <Dialog open onClose={() => setOpen(false)} title="Details">
              <button type="button">Inside</button>
            </Dialog>
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('confirm dialogs say what will happen and block double submission', async () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open
        onClose={() => undefined}
        onConfirm={onConfirm}
        title="Cancel this session?"
        description="Your partner will be notified."
        confirmLabel="Cancel session"
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel session' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    rerender(
      <ConfirmDialog
        open
        loading
        onClose={() => undefined}
        onConfirm={onConfirm}
        title="Cancel this session?"
        description="Your partner will be notified."
        confirmLabel="Cancel session"
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel session' })).toBeDisabled();
  });
});

describe('Tabs', () => {
  function Harness() {
    const [tab, setTab] = useState<'a' | 'b' | 'c'>('a');
    return (
      <>
        <Tabs
          label="Sections"
          idBase="t"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'a', label: 'First' },
            { id: 'b', label: 'Second', count: 3 },
            { id: 'c', label: 'Third' },
          ]}
        />
        <div {...tabPanelProps('t', tab)}>Panel {tab}</div>
      </>
    );
  }

  it('follows the tabs keyboard pattern and links panels to tabs', async () => {
    render(<Harness />);
    const first = screen.getByRole('tab', { name: 'First' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'First' })).toHaveTextContent('Panel a');

    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    const second = screen.getByRole('tab', { name: /Second/ });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(second).toHaveFocus();
    expect(first).toHaveAttribute('tabindex', '-1');

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Third' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(first).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel a');
  });
});

describe('ChoiceChips', () => {
  it('behaves as checkboxes or radios depending on the mode', async () => {
    const onChange = vi.fn();
    const options = [
      { value: 'Monday', label: 'Monday' },
      { value: 'Tuesday', label: 'Tuesday' },
    ];
    const { rerender } = render(
      <ChoiceChips legend="Days" options={options} value={['Monday']} onChange={onChange} />,
    );
    expect(screen.getByRole('group', { name: 'Days' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Monday' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }));
    expect(onChange).toHaveBeenLastCalledWith(['Monday', 'Tuesday']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Monday' }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    rerender(
      <ChoiceChips
        legend="Days"
        mode="single"
        options={options}
        value={['Monday']}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Tuesday' }));
    expect(onChange).toHaveBeenLastCalledWith(['Tuesday']);
  });
});

describe('Rating and Avatar', () => {
  it('says "No reviews yet" instead of inventing a score', () => {
    const { rerender } = render(<Rating value={null} count={0} />);
    expect(screen.getByText('No reviews yet')).toBeInTheDocument();
    rerender(<Rating value={4.5} count={2} />);
    expect(screen.getByText('4.5')).toBeInTheDocument();
    expect(screen.getByText('(2 reviews)')).toBeInTheDocument();
  });

  it('falls back to initials and announces presence in words', () => {
    render(<Avatar user={{ id: 'u1', name: 'Rahul Verma', avatar: '' }} online />);
    expect(screen.getByText('RV')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    // No stranger's stock photo is ever used as a default.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('hides for a single page and disables the ends', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pagination page={1} totalPages={1} onChange={onChange} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    rerender(<Pagination page={1} totalPages={3} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
