import { auth } from "@/lib/auth";
// TODO(RLS): refactor to withOrgContext once the upload pipeline is split.
import { prismaAdmin as prisma } from "@/lib/prisma-admin";
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
          deletedAt: null,
          organizations: { some: { organizationId: user.organizationId } },
        },
        include: {
          schemas: {
            where: { schema: { deletedAt: null } },
            include: {
              schema: {
                include: {
                  columns: {
                    orderBy: { order: "asc" },
                    include: {
                      classification: {
                        select: {
                          type: true,
                          description: true,
                          values: true,
                          caseSensitive: true,
                          pattern: true,
                          minNumber: true,
                          maxNumber: true,
                          minDate: true,
                          maxDate: true,
                        },
                      },
                    },
                  },
                },
              },
            },
            orderBy: { assignedAt: "asc" },
          },
        },
        orderBy: { name: "asc" },
      })
    : [];

  // Normalize each column's classification into a serializable shape — date-only
  // bounds become ISO "YYYY-MM-DD" strings so the data is plain JSON for the
  // client component.
  const projects = rawProjects
    .map((p) => ({
      id: p.id,
      name: p.name,
      schemas: p.schemas.map((sp) => ({
        ...sp.schema,
        columns: sp.schema.columns.map((col) => ({
          id: col.id,
          name: col.name,
          dataType: col.dataType,
          required: col.required,
          order: col.order,
          classification: col.classification
            ? {
                type: col.classification.type,
                description: col.classification.description,
                values: col.classification.values,
                caseSensitive: col.classification.caseSensitive,
                pattern: col.classification.pattern,
                minNumber: col.classification.minNumber,
                maxNumber: col.classification.maxNumber,
                minDate: col.classification.minDate
                  ? col.classification.minDate.toISOString().slice(0, 10)
                  : null,
                maxDate: col.classification.maxDate
                  ? col.classification.maxDate.toISOString().slice(0, 10)
                  : null,
              }
            : null,
        })),
      })),
    }))
    .filter((p) => p.schemas.length > 0);

  const recentUploads = user?.organizationId
    ? await prisma.fileUpload.findMany({
        where: { deletedAt: null, user: { organizationId: user.organizationId } },
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
