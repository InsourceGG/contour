export function Brand({ compact = false }: { compact?: boolean }) {
  return <span className="brand"><span aria-hidden="true" className="brand-mark">N<span>↗</span></span><span>Northwind{!compact && <span className="brand-product">Support</span>}</span></span>;
}
