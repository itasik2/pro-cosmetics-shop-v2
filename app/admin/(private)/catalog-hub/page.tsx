import CatalogHubShadowClient from "./CatalogHubShadowClient";
import CatalogHubPullClient from "./CatalogHubPullClient";

export default function CatalogHubPage() {
  return <div className="space-y-5"><CatalogHubPullClient /><CatalogHubShadowClient /></div>;
}
