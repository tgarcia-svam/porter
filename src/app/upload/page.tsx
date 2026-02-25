import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import FileUploader from "@/components/uploader/FileUploader";

export default async function UploadPage() {
  const session = await auth();
  if (!session?.user) return null;

  const assignments = await prisma.userSchemaAssignment.findMany({
    where: { userId: session.user.id },
    include: {
      schema: {
        include: { columns: { orderBy: { order: "asc" } } },
      },
    },
  });

  const assignedSchemas = assignments.map((a) => ({
    id: a.schema.id,
    name: a.schema.name,
    description: a.schema.description,
    columns: a.schema.columns,
  }));

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
          Select a schema and upload a CSV or Excel file to validate it.
        </p>
      </div>

      <FileUploader
        assignedSchemas={assignedSchemas}
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
