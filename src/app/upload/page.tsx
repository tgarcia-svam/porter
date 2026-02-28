import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import FileUploader from "@/components/uploader/FileUploader";

export default async function UploadPage() {
  const session = await auth();
  if (!session?.user) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

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

  const recentUploads = await prisma.fileUpload.findMany({
    where: { userId: session.user.id! },
    include: {
      schema: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

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
        projects={projects}
        initialUploads={recentUploads.map((u) => ({
          id: u.id,
          fileName: u.fileName,
          schemaName: u.schema.name,
          status: u.status,
          errorCount: u.errorCount,
          createdAt: u.createdAt.toISOString(),
          blobUrl: u.blobUrl ?? null,
        }))}
      />
    </div>
  );
}
