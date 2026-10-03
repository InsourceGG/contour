import { notFound, redirect } from 'next/navigation';
// The SDK broker still emits previewUrl as /preview/:id. Forward to Northwind's
// preview page on the same origin until the SDK emits /contour/preview/:id.
export default async function PreviewCompatibility({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  redirect(`/contour/preview/${id}`);
}
