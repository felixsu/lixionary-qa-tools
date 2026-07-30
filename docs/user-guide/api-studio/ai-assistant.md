# **AI Assistant**

Click **Assistant** (the ✦ sparkles button) in the API Studio toolbar to open a chat panel that builds flows with you. Describe what you want — *"get a UUID, wait 500 ms, then echo it"* — and the assistant proposes canvas actions using requests from your API Explorer collections.

> **Requires an AI provider**: add an API key and pick an active provider in **Settings** (bring-your-own-key; requests run through the local sidecar, your key never leaves this machine).

## **What It Can Do**

* Create a new flow, or extend the one on the canvas.
* Add **Request**, **Looper**, **Delay**, and **Verifier** nodes and connect them.
* Fill node configuration: link a saved request, set input mappings — including references to upstream outputs (`nodeName.output`) and looper `item` values.
* Answer questions about your canvas and your saved requests (their declared inputs and outputs).

It **never runs the flow** — after applying its proposal, you review the canvas, **Save**, and **Run** yourself.

## **Propose, Then Apply**

The assistant's replies that contain actions show a **Proposed actions** card — one row per action, with warnings (amber) and errors (red). Nothing touches the canvas until you click **Apply**. The proposal is re-checked against the live canvas at that moment; if you've edited the flow since (say, deleted a referenced node), nothing is applied and the card shows what broke. **Dismiss** discards a proposal.

Applied changes land as **unsaved edits** — review them, then Save. Node positions are laid out automatically, left-to-right by execution order.

## **Clarify First, and Only Real Requests**

* If information is missing — which request to use, what value an input should get, what a verifier should check — the assistant asks before proposing.
* The assistant only knows the requests in your collections. If you mention one that doesn't reasonably match any saved request, it will tell you to **build the request in API Explorer first** — it never invents requests, inputs, or outputs. This is also enforced outside the AI: proposals referencing unknown request names cannot be applied.

## **Conversation Persistence**

The chat transcript is kept **per flow, on this device** (like last-run results). Switching flows switches transcripts; reloading the app restores them. The trash icon in the panel header clears the current flow's chat. If you start a conversation before any flow exists and the assistant creates one, the transcript moves onto the new flow.

## **Limitations**

* The assistant does not (yet) diagnose or fix failing runs — run results are yours to interpret for now.
* Very large collections are summarized (first 250 requests); the assistant will ask for exact names when unsure.
* One reply per turn, no streaming — a complex proposal can take a few seconds.
