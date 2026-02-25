import SchemaEditor from "@/components/admin/SchemaEditor";

export default function NewSchemaPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Schema</h1>
        <p className="mt-1 text-sm text-gray-500">
          Define column names and required data types.
        </p>
      </div>
      <SchemaEditor />
    </div>
  );
}
