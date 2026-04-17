import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import FileUploader from "@/components/uploader/FileUploader";

export const dynamic = 'force-dynamic';

export default async function UploadPage() {
  const session = await auth();
  if (!session?.user) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true, role: true },
  });
  const isAdmin = user?.role === "ADMIN";

  const rawProjects = user?.organizationId
    ? await prisma.project.findMany({
        where: {
          organizations: { some: { organizationId: user.organizationId } },
        },
        include: {
          schemas: {
            include: {
              schema: { include: { columns: { orderBy: { order: "asc" } } } },
            },
            orderBy: { assignedAt: "asc" },
          },
        },
        orderBy: { name: "asc" },
      })
    : [];

  const projects = rawProjects
    .map((p) => ({
      id: p.id,
      name: p.name,
      schemas: p.schemas.map((sp) => sp.schema),
    }))
    .filter((p) => p.schemas.length > 0);

  const recentUploads = user?.organizationId
    ? await prisma.fileUpload.findMany({
        where: { user: { organizationId: user.organizationId } },
        include: {
          schema: { select: { name: true } },
          user: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Upload File</h1>
        <p className="mt-1 text-sm text-gray-500">
          Select a project and schema, then upload a CSV or Excel file to
          validate it.
        </p>
      </div>

      <FileUploader
        directUpload={!!process.env.AZURE_DIRECT_UPLOAD_ENABLED}
        projects={projects}
        initialUploads={recentUploads.map((u) => ({
          id: u.id,
          fileName: u.fileName,
          schemaName: u.schema.name,
          status: u.status,
          errorCount: u.errorCount,
          createdAt: u.createdAt.toISOString(),
          blobUrl: isAdmin ? (u.blobUrl ?? null) : null,
          uploadedBy: u.user?.name ?? u.user?.email ?? "Unknown",
        }))}
      />
    </div>
  );
}
