
# **Collections Management**

## **Overview**

Collections organize related API requests into structured groups. API Explorer supports two distinct collection modes: **Connected (Shared) Collections** and **Local / Cloned Collections**.

> **Note**: The sidebar shows no visual badge distinguishing connected collections from local ones — both render identically in the tree. The difference is purely in how they behave (synced vs. detached).

## **Collection Types**

### **1. Connected Collections (Background Sync)**

* **Purpose**: Best suited for team environments where endpoint definitions, standard payloads, and environment configurations must remain synchronized across all team members.
* **How it works**: Connecting to a collection using its unique **Collection ID** links your workspace to the shared cloud copy. Changes are synced in the background — your edits are pushed shortly after you save, and teammates receive them the next time their client syncs.
* **Sync triggers**: A sync runs automatically on app load, on window focus (skipped if a sync ran within the last 60 seconds), and on a 5-minute background interval. You can also trigger one manually via the **Sync now** control in the left navigation rail, which shows the current sync state (e.g., "Synced 2m ago", "Syncing…", "Offline").
* **Conflicts**: If you and a teammate edit the same collection concurrently, a conflict dialog appears letting you choose to keep your local version or the cloud version — conflicting edits are never silently merged.
* **Best Practice**: Use environment variables (e.g., {{env.BASE_URL}}) within connected collections so team members can run identical requests against different target environments (QA, Staging, Local) without modifying endpoint definitions.

### **2. Local / Cloned Collections**

* **Purpose**: Ideal for isolated testing, experimental payload modifications, or offline work without risking shared team configurations.
* **How it works**: Importing a collection via JSON creates a local clone completely detached from the origin collection. Every request and sub-collection receives fresh IDs, so no changes flow back to the source.

## **Operations**

### **Sharing & Connecting to a Collection**

To share a collection, hover over its row in the sidebar (top-level collections only) and click the **Copy collection ID** icon, then send the ID to your teammate. If the collection hasn't finished its first sync yet, you'll be asked to try again in a moment.

To connect:

1. Locate the **Connect collection by ID…** input in the left sidebar (it is hidden while the search box has text or the sidebar is collapsed).
2. Paste the target Collection ID.
3. Click **Connect**. The collection and its sub-collection hierarchy will appear in your tree view.

> **Caveat**: There is currently no "disconnect" or "leave collection" action. Avoid deleting a connected collection you don't own — it disappears locally but the deletion is rejected by the cloud, leaving your sync in an error state.

### **Importing a Collection**

1. Click the **Import from JSON file** button in the sidebar.
2. Select a valid API Explorer collection JSON file via the file picker (drag-and-drop is not supported).
3. An isolated clone will be instantiated in your collection tree and auto-selected.

> Only files exported by API Explorer itself are accepted (Postman, Insomnia, or OpenAPI files are rejected with "Not a recognized collection export file"). Collections deeper than 5 nesting levels cannot be imported.

### **Exporting a Collection**

1. Hover over the target top-level collection in the sidebar (sub-collections cannot be exported individually).
2. Click the share icon with the tooltip **Export collection as JSON**.
3. A `<collection-name>.collection.json` definition file downloads immediately — use it for backups or offline sharing.

### **Organizing the Tree**

* **New collection**: Click the **+** button in the sidebar header, then name the collection.
* **Add request / sub-collection**: Expand a collection and use the dashed **+ Request** and **+ Collection** buttons inside it. Sub-collections can be nested up to 5 levels deep.
* **Rename / Delete**: Hover over any collection or request row to reveal the pencil (rename inline) and trash (delete, with a confirmation dialog that warns how many requests will be removed) icons.
* **Duplicate request**: Hover over a request and click the copy icon — a clone named "*name* copy" is created alongside it. (Collections cannot be duplicated.)
* **Move via drag-and-drop**: Drag a request or a nested sub-collection and drop it onto any collection row, including rows in a different root collection. Moved items are appended at the end of the target — there is no sibling reordering, and top-level collections themselves cannot be dragged.
* **Collapse sidebar**: The sidebar can be collapsed to a thin rail via the **Collapse sidebar** toggle to maximize workbench space.

### **Searching**

The search box (placeholder: **Search name, endpoint, description…**) requires at least 2 characters. While active, it replaces the tree with a ranked list of matching **requests** (collections themselves are not search hits), each showing its method chip and breadcrumb path. Matching covers the request **name** (fuzzy), **URL** (substring), and **description** (semantic similarity). While the description index is still building, an **Indexing requests…** indicator appears above the box.
