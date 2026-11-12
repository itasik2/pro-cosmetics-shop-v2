import CatalogHubShadowClient from "./CatalogHubShadowClient";
import CatalogHubPullClient from "./CatalogHubPullClient";
import CatalogHubPilotClient from "./CatalogHubPilotClient";

export default function CatalogHubPage() {
  return <div className="space-y-5"><CatalogHubPilotClient /><CatalogHubPullClient /><CatalogHubShadowClient /></div>;
}
