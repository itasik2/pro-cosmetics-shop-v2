import AdminExternalLinksClient from "./AdminExternalLinksClient";
import AdminSettingsClient from "./AdminSettingsClient";

export default function Page() {
  return (
    <div className="space-y-8">
      <AdminSettingsClient />
      <AdminExternalLinksClient />
    </div>
  );
}
