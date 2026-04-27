import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface CurrencyInputProps {
  value: number;
  onChange: (val: number) => void;
  className?: string;
  placeholder?: string;
  allowNegative?: boolean;
  disabled?: boolean;
  decimals?: number;
}

export function CurrencyInput({ value, onChange, className, placeholder = '0.00', allowNegative, disabled, decimals = 2 }: CurrencyInputProps) {
   const formatWithCommas = (num: number) =>
     new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(num);
  const roundFactor = Math.pow(10, decimals);

  const [display, setDisplay] = useState(value === 0 ? '' : formatWithCommas(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDisplay(value === 0 ? '' : formatWithCommas(value));
    }
  }, [value, isFocused]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => {
        setIsFocused(true);
        setDisplay(value === 0 ? '' : String(value));
      }}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.\-]/g, '');
        setDisplay(raw);
        const v = parseFloat(raw);
        onChange(isNaN(v) ? 0 : Math.round(v * roundFactor) / roundFactor);
      }}
      onBlur={() => {
        setIsFocused(false);
        const v = parseFloat(display.replace(/[^0-9.\-]/g, ''));
        const final = isNaN(v) ? 0 : Math.round(v * roundFactor) / roundFactor;
        onChange(final);
        setDisplay(final === 0 ? '' : formatWithCommas(final));
      }}
      className={cn('input-cell text-[#020508] bg-[#e4ebf2]', disabled && 'opacity-50 cursor-not-allowed', className)}
    />
  );
}

interface CurrencyDisplayProps {
  value: number;
  className?: string;
  highlight?: boolean;
}

export function CurrencyDisplay({ value, className, highlight }: CurrencyDisplayProps) {
   const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const isNeg = value < 0;
  return (
    <span className={cn('font-mono text-sm tabular-nums', isNeg && 'text-destructive', highlight && 'font-bold', className)}>
       {isNeg ? `-${formatted.replace('-', '')}` : formatted}
    </span>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  color?: 'blue' | 'red' | 'green' | 'purple' | 'orange' | 'default';
}

const colorMap = {
  blue: 'bg-blue-600 text-white',
  red: 'bg-red-600 text-white',
  green: 'bg-green-700 text-white',
  purple: 'bg-purple-700 text-white',
  orange: 'bg-orange-600 text-white',
  default: 'bg-primary text-primary-foreground',
};

export function Section({ title, children, color = 'default' }: SectionProps) {
  return (
    <div className="mb-3">
      <div className={cn('px-3 py-2 rounded-t-md font-semibold text-sm', colorMap[color])}>{title}</div>
      <div className="border border-t-0 rounded-b-md">{children}</div>
    </div>
  );
}

interface DataRowProps {
  label: string;
  children: React.ReactNode;
  total?: boolean;
  className?: string;
}

export function DataRow({ label, children, total, className }: DataRowProps) {
  return (
    <div className={cn(
      'flex items-center justify-between px-3 py-1.5 border-b last:border-b-0 text-sm',
      total && 'bg-secondary font-semibold',
      className,
    )}>
      <span className="text-muted-foreground shrink-0 mr-2">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
