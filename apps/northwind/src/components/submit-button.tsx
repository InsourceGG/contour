'use client';
import { useFormStatus } from 'react-dom';
export function SubmitButton({ children, pendingText = 'Saving…' }: { children: React.ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return <button className="button button-primary" type="submit" disabled={pending} aria-busy={pending}>{pending ? pendingText : children}</button>;
}
