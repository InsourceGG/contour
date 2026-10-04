import { requireSession } from '@/lib/session';
import { WorkspaceNav } from '@/components/workspace-nav';
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return <><WorkspaceNav session={session} /><main id="main" className="workspace-main">{children}</main><footer className="workspace-footer"><span>Northwind Support</span><span>Customer care, together.</span></footer></>;
}
