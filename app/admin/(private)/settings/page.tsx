import AdminExternalLinksClient from "./AdminExternalLinksClient";
import AdminNotificationsClient from "./AdminNotificationsClient";
import AdminSettingsClient from "./AdminSettingsClient";

export default function Page() {
  return (
    <div className="space-y-8">
      <AdminSettingsClient />
      <AdminNotificationsClient />
      <AdminExternalLinksClient />
    </div>
  );
}
